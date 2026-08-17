import React, { useState, useEffect } from 'react';
import { Driver, AssignmentType, RideStudent, Waypoint, Vehicle } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { AssignmentPreview } from './AssignmentPreview';
import { ActiveRide } from './ActiveRide';
import { DriverShift } from './DriverShift';
import { CompletionScreen } from './CompletionScreen';
import { releaseVehicle, setDriverAvailability, useAvailableVehicles, assignVehicleToDriver } from '../../hooks/useFirestore';
import { collection, doc, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
    globalAssignDriver,
    driverDoneForToday,
    AssignStudentsResult,
    GlobalAssignResult,
    CompleteRideResult
} from '../../src/utils/cloudFunctions';
import { buildGoogleMapsNavigationUrl } from '../../src/utils/googleMaps';
import { endShiftWithWarning } from '../../src/utils/endShift';
import { useConfirm } from '../shared/useConfirm';
import { useToast } from '../../contexts/ToastContext';

// Driver workflow states
type DriverViewState =
    | 'dashboard'           // Show dashboard with "Assign Me" button
    | 'preview'             // Show AssignmentPreview before accepting
    | 'active'              // Show ActiveRide during the ride
    | 'completed';          // Show CompletionScreen after ride

export const DriverDashboard: React.FC = () => {
    const { userProfile, currentUser, refreshProfile, activeRole } = useAuth();
    const [isAssigning, setIsAssigning] = useState(false);
    const [rideContext, setRideContext] = useState<{ rideType: 'home-to-sabha' | 'sabha-to-home' | null; displayText: string } | null>(null);
    const [viewState, setViewState] = useState<DriverViewState>('dashboard');
    const [pendingAssignment, setPendingAssignment] = useState<AssignStudentsResult | null>(null);
    const [activeRide, setActiveRide] = useState<{
        id: string;
        rideType: 'home-to-sabha' | 'sabha-to-home';
        students: RideStudent[];
        route: Waypoint[];
        googleMapsUrl: string;
        estimatedDistance: number;
        estimatedTime: number;
    } | null>(null);
    const [completedRideStats, setCompletedRideStats] = useState<{
        rideId: string;
        stats: { students: number; distance: number; time: number };
        driverStats: { ridesCompletedToday: number; totalStudentsToday: number; totalDistanceToday: number };
    } | null>(null);
    const [startingShift, setStartingShift] = useState(false);
    const [showVehicleSelector, setShowVehicleSelector] = useState(false);
    const [selectingVehicle, setSelectingVehicle] = useState(false);
    const { ask, confirmDialog } = useConfirm();
    const toast = useToast();

    // Available vehicles hook for real-time updates
    const { vehicles: availableVehicles, loading: vehiclesLoading } = useAvailableVehicles();

    // Cast userProfile to Driver to safely access driver-specific properties
    const driverProfile = activeRole === 'driver' ? (userProfile as Driver) : null;
    const isAvailable = userProfile?.status === 'available';

    // Subscribe to driver's active ride in Firestore (preserves state across role switches)
    useEffect(() => {
        if (!currentUser) return;

        const q = query(
            collection(db, 'rides'),
            where('driverId', '==', currentUser.uid),
            where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                // No active ride assigned in Firestore
                setActiveRide(prev => {
                    if (prev) return null;
                    return prev;
                });
                setViewState(prev => (prev === 'active' || prev === 'preview' ? 'dashboard' : prev));
                return;
            }

            const rideDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
            const primaryDoc = rideDocs[0];

            // Reconstruct all assigned students across grouped ride documents
            const students: RideStudent[] = [];
            rideDocs.forEach(r => {
                if (r.students && Array.isArray(r.students) && r.students.length > 0) {
                    r.students.forEach((st: any) => {
                        if (!students.some(s => s.id === st.id)) {
                            students.push(st);
                        }
                    });
                } else if (r.studentId) {
                    if (!students.some(s => s.id === r.studentId)) {
                        students.push({
                            id: r.studentId,
                            name: r.studentName || 'Student',
                            phone: r.studentPhone || '',
                            location: {
                                lat: r.pickupLat || (r.location?.lat ?? r.location?.latitude ?? 0),
                                lng: r.pickupLng || (r.location?.lng ?? r.location?.longitude ?? 0),
                                address: r.pickupAddress || r.address || ''
                            },
                            picked: false
                        });
                    }
                }
            });

            const route = primaryDoc.route || [];
            const reconstructedActiveRide = {
                id: primaryDoc.id,
                rideType: (primaryDoc.rideType || rideContext?.rideType || 'home-to-sabha') as 'home-to-sabha' | 'sabha-to-home',
                students: students.length > 0 ? students : (primaryDoc.students || []),
                route,
                // Rides assigned before globalAssignDriver persisted this field
                // have no googleMapsUrl. Rebuilding from `route` keeps their
                // navigation working instead of handing ActiveRide an '' that
                // made the button a silent no-op.
                googleMapsUrl: primaryDoc.googleMapsUrl || buildGoogleMapsNavigationUrl(route),
                estimatedDistance: primaryDoc.estimatedDistance || 0,
                estimatedTime: primaryDoc.estimatedTime || 0,
            };

            setActiveRide(reconstructedActiveRide);
            // Don't yank the driver out of the preview they are reading. This
            // snapshot fires as soon as globalAssignDriver commits, so forcing
            // 'active' here meant AssignmentPreview flashed and vanished — and
            // it is the one screen with an Accept/Release choice. Rehydration
            // after a reload or a role switch still lands on 'active', which is
            // correct: pendingAssignment only exists in the tab that tapped
            // Assign Me, so 'preview' would render nothing.
            setViewState(prev => (prev === 'preview' ? prev : 'active'));
        }, (error) => {
            console.error('[DriverDashboard] Error listening to active driver ride:', error);
        });

        return unsubscribe;
    }, [currentUser, rideContext?.rideType]);

    // Subscribe to the ride context published by the scheduler.
    //
    // This used to call manuallyUpdateRideContext(), which is a WRITE: with no
    // arguments the callable recomputes the context server-side and sets
    // testMode back to false. So every driver opening their dashboard silently
    // cleared a manager's test-mode override and raced the every-minute
    // scheduler, and a read cost a Firestore write.
    //
    // Reading the document is also fresher — it stays subscribed rather than
    // sampling once on mount, so a window opening mid-session arrives on its
    // own.
    useEffect(() => {
        const unsubscribe = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (snap) => {
                if (!snap.exists()) {
                    setRideContext(null);
                    return;
                }
                const data = snap.data();
                const next = {
                    rideType: (data.rideType ?? null) as 'home-to-sabha' | 'sabha-to-home' | null,
                    displayText: data.displayText ?? ''
                };
                // The scheduler rewrites this document every minute, changing
                // only lastUpdated. Keep the previous object when nothing we
                // render has changed, so drivers holding the screen open don't
                // re-render once a minute.
                setRideContext((prev) =>
                    prev && prev.rideType === next.rideType && prev.displayText === next.displayText
                        ? prev
                        : next
                );
            },
            (error) => console.error('Error subscribing to ride context:', error)
        );
        return unsubscribe;
    }, []);

    /**
     * Going on shift and choosing a car are one flow, not two.
     *
     * They used to be independent, which is what produced the dead end: online
     * with no car meant a permanently grey "Assign Me" whose only explanation
     * lived in an unreachable alert.
     */
    const handleGoOnShift = async () => {
        if (!currentUser) return;
        setStartingShift(true);
        try {
            await setDriverAvailability(currentUser.uid, 'available');
            await refreshProfile();
            if (!userProfile?.currentVehicleId) setShowVehicleSelector(true);
        } catch (error) {
            console.error('Failed to go on shift:', error);
            toast.error('Could not start your shift. Please try again.');
        } finally {
            setStartingShift(false);
        }
    };

    /**
     * Shared by both exits (the shift card and the completion screen) so the
     * "riders are still waiting" warning cannot be live on one route and missing
     * on the other. The sequence itself is tested in src/utils/endShift.ts.
     */
    const endShift = async (): Promise<boolean> =>
        !!currentUser && endShiftWithWarning(currentUser.uid, driverDoneForToday, ask);

    const handleEndShift = async () => {
        if (!currentUser) return;
        const ok = await ask({
            title: 'End your shift?',
            message: 'Your car goes back to the fleet and today\'s tally resets.',
            confirmLabel: 'End shift',
            cancelLabel: 'Keep driving',
            destructive: true,
        });
        if (!ok) return;

        try {
            if (!await endShift()) return;
            await refreshProfile();
            toast.success('Shift ended. Thank you for driving.');
        } catch (error: unknown) {
            console.error('Failed to end shift:', error);
            toast.error(error instanceof Error ? error.message : 'Could not end your shift.');
        }
    };

    const handleSelectVehicle = async (vehicle: any) => {
        if (!currentUser) return;
        setSelectingVehicle(true);
        try {
            // First release current vehicle if any
            if (userProfile?.currentVehicleId) {
                await releaseVehicle(userProfile.currentVehicleId, currentUser.uid);
            }
            // Assign new vehicle
            await assignVehicleToDriver(vehicle, currentUser.uid, userProfile?.name || 'Driver');
            await refreshProfile();
            setShowVehicleSelector(false);
        } catch (error) {
            console.error('Error selecting vehicle:', error);
            toast.error('Could not take that car. Someone may have just claimed it.');
        } finally {
            setSelectingVehicle(false);
        }
    };

    // Handle "Assign Me" — calls global assignment with retry-on-lock
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;

    const handleAssignMe = async () => {
        if (!currentUser || !userProfile?.currentVehicleId) {
            // ponytail: unreachable today — the button is `disabled` without a
            // vehicle, so this click handler never runs and the driver is left
            // with a grey button and no reason. Phase 4 replaces the disabled
            // state with a button that says "Pick a car to start" and does it.
            // Until then the guard stays, but it now reports rather than
            // relying on a dialog nobody can trigger.
            toast.error('Pick a car before finding riders.');
            return;
        }

        setIsAssigning(true);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result: GlobalAssignResult = await globalAssignDriver(
                    currentUser.uid,
                    userProfile.currentVehicleId
                );
                console.log(`[Assign attempt ${attempt}] result:`, result);

                if (result.status === 'locked') {
                    // Another driver is being assigned — retry
                    if (attempt < MAX_RETRIES) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        continue;
                    }
                    toast.error('Another driver is being assigned right now. Try again in a moment.');
                    setIsAssigning(false);
                    return;
                }

                if (result.status === 'no_students') {
                    // Information, not a failure — everyone waiting already has
                    // a car. The button stays available for when that changes.
                    toast.info('Nobody is waiting right now. Check back in a few minutes.');
                    setIsAssigning(false);
                    return;
                }

                // status === 'success' — map to AssignStudentsResult shape
                const assignment: AssignStudentsResult = {
                    rideId: result.rideId!,
                    students: result.students!,
                    route: result.route!,
                    estimatedDistance: result.estimatedDistance!,
                    estimatedTime: result.estimatedTime!,
                    googleMapsUrl: result.googleMapsUrl!,
                    car: result.car!
                };

                setPendingAssignment(assignment);
                setViewState('preview');
                setIsAssigning(false);
                return;

            } catch (error: unknown) {
                console.error('Error getting assignment:', error);
                toast.error(error instanceof Error ? error.message : 'Could not find riders. Please try again.');
                setIsAssigning(false);
                return;
            }
        }

        setIsAssigning(false);
    };

    // Handle Accept & Start from AssignmentPreview
    const handleAcceptAssignment = () => {
        if (!pendingAssignment) return;

        // Refuse rather than assume. This was `rideContext?.rideType ||
        // 'home-to-sabha'`, which silently turned a closed window into a pickup
        // run — the driver would set off towards the venue on a drop-off night.
        if (!rideContext?.rideType) {
            toast.error('The ride window has closed. Refresh before starting a run.');
            return;
        }

        // Activate the ride and transition to ActiveRide screen
        setActiveRide({
            id: pendingAssignment.rideId,
            rideType: rideContext.rideType,
            students: pendingAssignment.students,
            route: pendingAssignment.route,
            googleMapsUrl: pendingAssignment.googleMapsUrl,
            estimatedDistance: pendingAssignment.estimatedDistance,
            estimatedTime: pendingAssignment.estimatedTime,
        });
        setViewState('active');
    };

    // Handle Release Assignment from AssignmentPreview
    const handleReleaseAssignment = () => {
        setPendingAssignment(null);
        setViewState('dashboard');
        refreshProfile();
    };

    // Handle Complete Ride from ActiveRide
    const handleRideComplete = (result: { students: number; distance: number; time: number }, driverStats: { ridesCompletedToday: number; totalStudentsToday: number; totalDistanceToday: number }) => {
        setCompletedRideStats({
            rideId: activeRide?.id || '',
            stats: result,
            driverStats,
        });
        setActiveRide(null);
        setViewState('completed');
    };

    // Handle Assign Next Ride from CompletionScreen
    const handleAssignNext = () => {
        setCompletedRideStats(null);
        setViewState('dashboard');
        // Called straight away. There used to be a 100ms setTimeout here "to allow
        // state update", and what it was really racing was the Firestore snapshot
        // that cleared currentVehicleId — completeRide released the car on every
        // run, and handleAssignMe guards on that field. Whichever won decided
        // whether the driver got riders or "Pick a car before finding riders".
        //
        // The driver keeps their car now, so there is nothing to wait for. A timer
        // that guesses at a round trip was the bug, not the fix.
        handleAssignMe();
    };

    // Handle Done for Today from CompletionScreen
    const handleDoneForTodayFromCompletion = async () => {
        if (!currentUser) return;

        try {
            // Declining the warning leaves them on the completion screen with
            // their car — which is exactly the state they need to be in to tap
            // "Find my next riders" instead.
            if (!await endShift()) return;
            await refreshProfile();
            setCompletedRideStats(null);
            setViewState('dashboard');
        } catch (error: unknown) {
            console.error('Error marking done:', error);
            toast.error(error instanceof Error ? error.message : 'Could not finish your shift.');
        }
    };

    /**
     * The shift card — and the fallback for every other view.
     *
     * NEVER RENDER NOTHING.
     *
     * Each case below needs data that `viewState` alone does not guarantee, and
     * all three used to `return null` when it was missing. A driver then got a
     * blank page with no nav (ActiveRide puts the app in focus mode) and no
     * control of any kind — no way back, nothing to tap, no explanation. The only
     * escape was force-quitting the app.
     *
     * One of the three is demonstrably reachable, and it is the reason this was
     * worth fixing rather than tidying:
     *
     *  - **`preview` without `rideContext.rideType`.** The ride window closes on
     *    its own — at midnight, or when a manager resets the override — and the
     *    context subscription then publishes `rideType: null`. A driver reading a
     *    proposed carload at that moment lost the screen. There is a test for
     *    exactly this.
     *
     * The other two are defensive, and honestly so. Today `activeRide`/`viewState`
     * and `completedRideStats`/`viewState` are always set and cleared together, so
     * those branches should be unreachable. Nothing enforces it — they are four
     * separate `useState` calls updated from five places — and the cost of being
     * wrong once is a driver mid-shift with no screen and no way back. A fallback
     * that is never hit costs one line.
     *
     * Falling back to the shift card is right in every case: it is a working
     * screen with their car, their tally and "Find my riders". The stored
     * `viewState` is deliberately NOT reset, so a value that was merely late —
     * a snapshot round-trip — restores the real view when it arrives instead of
     * dropping the driver out for good.
     */
    const shiftCard = (
        <DriverShift
            driverName={userProfile?.name || 'Driver'}
            avatarUrl={userProfile?.avatarUrl}
            onShift={isAvailable}
            vehicleName={isAvailable ? userProfile?.currentVehicleName : undefined}
            vehiclePlate={isAvailable ? userProfile?.currentVehiclePlate : undefined}
            rideContextText={rideContext?.displayText}
            ridesToday={(userProfile as any)?.ridesCompletedToday || 0}
            peopleToday={(userProfile as any)?.totalStudentsToday || 0}
            milesToday={(userProfile as any)?.totalDistanceToday || 0}
            isAssigning={isAssigning}
            isStartingShift={startingShift}
            vehicles={availableVehicles}
            vehiclesLoading={vehiclesLoading}
            vehiclePickerOpen={showVehicleSelector}
            selectingVehicle={selectingVehicle}
            onGoOnShift={handleGoOnShift}
            onEndShift={handleEndShift}
            onFindRiders={handleAssignMe}
            onOpenVehiclePicker={() => setShowVehicleSelector(true)}
            onCloseVehiclePicker={() => setShowVehicleSelector(false)}
            onSelectVehicle={handleSelectVehicle}
        />
    );

    /** Log which guard fired, so a recurrence is diagnosable rather than a mystery. */
    const fallback = (missing: string) => {
        console.warn(
            `[DriverDashboard] viewState '${viewState}' without ${missing} — `
            + 'showing the shift card instead of a blank screen',
        );
        return shiftCard;
    };

    // Render the appropriate view based on state
    const renderContent = () => {
        switch (viewState) {
            case 'preview':
                if (!pendingAssignment || !rideContext?.rideType) {
                    return fallback(pendingAssignment ? 'an open ride window' : 'an assignment');
                }
                return (
                    <AssignmentPreview
                        assignment={pendingAssignment}
                        rideType={rideContext.rideType}
                        onAccept={handleAcceptAssignment}
                        onRelease={handleReleaseAssignment}
                        onBack={handleReleaseAssignment}
                    />
                );

            case 'active':
                if (!activeRide) return fallback('an active ride');
                return (
                    <ActiveRide
                        ride={activeRide}
                        onComplete={handleRideComplete}
                        onBack={() => {
                            // Go back to dashboard
                            setActiveRide(null);
                            setViewState('dashboard');
                            refreshProfile();
                        }}
                    />
                );

            case 'completed':
                if (!completedRideStats) return fallback('completion stats');
                return (
                    <CompletionScreen
                        rideId={completedRideStats.rideId}
                        rideNumber={completedRideStats.rideId.slice(-6)}
                        stats={completedRideStats.stats}
                        driverStats={completedRideStats.driverStats}
                        onAssignNext={handleAssignNext}
                        onDoneForToday={handleDoneForTodayFromCompletion}
                    />
                );

            case 'dashboard':
            default:
                return shiftCard;
        }
    };

    return (
        <>
            {renderContent()}
            {confirmDialog}
        </>
    );
};
