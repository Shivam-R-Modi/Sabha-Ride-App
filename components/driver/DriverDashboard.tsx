import React, { useState, useEffect } from 'react';
import { Driver, AssignmentType, RideStudent, Waypoint, Vehicle } from '../../types';
import { MapPin, Users, ChevronRight, ToggleLeft, ToggleRight, Navigation, Car, RefreshCw, LogOut, Loader2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { AssignmentPreview } from './AssignmentPreview';
import { ActiveRide } from './ActiveRide';
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

// Driver workflow states
type DriverViewState =
    | 'dashboard'           // Show dashboard with "Assign Me" button
    | 'preview'             // Show AssignmentPreview before accepting
    | 'active'              // Show ActiveRide during the ride
    | 'completed';          // Show CompletionScreen after ride

export const DriverDashboard: React.FC = () => {
    const { userProfile, currentUser, refreshProfile, activeRole } = useAuth();
    const [switchingCar, setSwitchingCar] = useState(false);
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
    const [error, setError] = useState<string | null>(null);
    const [showVehicleSelector, setShowVehicleSelector] = useState(false);
    const [selectingVehicle, setSelectingVehicle] = useState(false);

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

    const toggleAvailability = async () => {
        if (!currentUser) return;

        const newStatus = isAvailable ? 'offline' : 'available';
        console.log(`Toggling availability to ${newStatus} for user ${currentUser.uid}`);
        try {
            if (newStatus === 'offline') {
                if (!confirm('Going offline will release your assigned vehicle back to the fleet and reset your daily stats. Are you sure?')) {
                    return;
                }
                await driverDoneForToday(currentUser.uid);
            } else {
                await setDriverAvailability(currentUser.uid, 'available');
                if (!userProfile?.currentVehicleId) {
                    setShowVehicleSelector(true);
                }
            }
        } catch (error) {
            console.error("Failed to toggle availability:", error);
            alert("Failed to update availability. Please try again.");
        }
        await refreshProfile();
    };

    const handleReleaseVehicle = async () => {
        // Show vehicle selector instead of just releasing
        setShowVehicleSelector(true);
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
            alert('Failed to select vehicle. Please try again.');
        } finally {
            setSelectingVehicle(false);
        }
    };

    // Handle "Assign Me" — calls global assignment with retry-on-lock
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;

    const handleAssignMe = async () => {
        if (!currentUser || !userProfile?.currentVehicleId) {
            alert('Please select a vehicle first');
            return;
        }

        setIsAssigning(true);
        setError(null);

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
                        setError('Another driver is being assigned, retrying...');
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        continue;
                    }
                    setError('System is busy. Please tap Assign Me again in a few seconds.');
                    setIsAssigning(false);
                    return;
                }

                if (result.status === 'no_students') {
                    setError('All students have already been assigned. Check back later.');
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
                setError(error.message || 'Failed to get assignment. Please try again.');
                setIsAssigning(false);
                return;
            }
        }

        setIsAssigning(false);
    };

    // Handle Accept & Start from AssignmentPreview
    const handleAcceptAssignment = () => {
        if (!pendingAssignment) return;

        // Activate the ride and transition to ActiveRide screen
        setActiveRide({
            id: pendingAssignment.rideId,
            rideType: rideContext?.rideType || 'home-to-sabha',
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
        // Small delay to allow state update before fetching new assignment
        setTimeout(() => {
            handleAssignMe();
        }, 100);
    };

    // Handle Done for Today from CompletionScreen
    const handleDoneForTodayFromCompletion = async () => {
        if (!currentUser) return;

        try {
            await driverDoneForToday(currentUser.uid);
            await refreshProfile();
            setCompletedRideStats(null);
            setViewState('dashboard');
        } catch (error: unknown) {
            console.error('Error marking done:', error);
            alert(error.message || 'Failed to finish. Please try again.');
        }
    };

    // Render the appropriate view based on state
    const renderContent = () => {
        switch (viewState) {
            case 'preview':
                if (!pendingAssignment || !rideContext?.rideType) return null;
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
                if (!activeRide) return null;
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
                if (!completedRideStats) return null;
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
                return (
                    <div className="pb-6 px-4 pt-6 space-y-6">
                        {/* Driver Status Header */}
                        <div className="clay-card space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-orange-100">
                                        <img src={userProfile?.avatarUrl} alt="Driver" className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <h2 className="font-header font-bold text-coffee leading-tight">{userProfile?.name}</h2>
                                        <p className={`text-xs font-medium ${isAvailable ? 'text-green-700' : 'text-gray-500'}`}>
                                            {isAvailable ? '● Online' : '○ Offline'}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={toggleAvailability} className="clay-toggle">
                                    {isAvailable ? <ToggleRight size={32} className="fill-saffron/20" /> : <ToggleLeft size={32} className="text-gray-300" />}
                                </button>
                            </div>

                            <div className="bg-gray-50 p-3 rounded-lg flex items-center justify-between gap-3 border border-gray-100">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="bg-white p-2 rounded-md text-coffee shadow-sm shrink-0">
                                        <Car size={18} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-gray-500 uppercase">Current Vehicle</p>
                                        <p className="text-sm font-bold text-coffee truncate">
                                            {isAvailable ? (userProfile?.currentVehicleName || "No Vehicle Selected") : "No Vehicle Selected"}
                                        </p>
                                        {isAvailable && userProfile?.currentVehiclePlate && (
                                            <p className="text-[10px] text-gray-500 font-mono">{userProfile.currentVehiclePlate}</p>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={handleReleaseVehicle}
                                    disabled={switchingCar}
                                    className="clay-button-secondary text-xs shrink-0 whitespace-nowrap"
                                >
                                    {switchingCar ? <RefreshCw className="animate-spin" size={14} /> : (isAvailable && userProfile?.currentVehicleId ? 'Change Car' : 'Select Car')}
                                </button>
                            </div>
                        </div>

                        {/* Stats Summary */}
                        <div className="flex justify-between items-center px-2">
                            <div>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Today's Seva</p>
                                <p className="text-sm font-medium text-coffee">
                                    {(userProfile as any)?.totalStudentsToday || 0} Students • {((userProfile as any)?.totalDistanceToday || 0).toFixed(0)} mi
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Assignments</p>
                                <p className="text-sm font-medium text-coffee">{(userProfile as any)?.ridesCompletedToday || 0} Rides Completed</p>
                            </div>
                        </div>

                        {/* Ride Type Context Display */}
                        {rideContext && (
                            <div className="clay-card bg-gradient-to-r from-orange-50 to-amber-50 border-orange-100">
                                <p className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-1">Current Ride Type</p>
                                <p className="text-lg font-bold text-coffee">{rideContext.displayText}</p>
                            </div>
                        )}

                        {/* Error Display */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <p className="text-red-600 text-sm">{error}</p>
                            </div>
                        )}

                        {/* Assign Me Button */}
                        {isAvailable && (
                            <button
                                onClick={handleAssignMe}
                                disabled={isAssigning || !userProfile?.currentVehicleId}
                                className={`w-full py-4 text-lg ${userProfile?.currentVehicleId ? 'clay-btn-cta-large' : 'bg-gray-200 text-gray-500 rounded-2xl cursor-not-allowed'}`}
                            >
                                {isAssigning ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="animate-spin" size={20} />
                                        Finding Students...
                                    </span>
                                ) : (
                                    'Assign Me'
                                )}
                            </button>
                        )}

                        {/* Empty State */}
                        <div className="clay-card text-center py-12">
                            <p className="text-muted font-medium text-sm">No assignments yet.</p>
                            <p className="text-xs text-muted mt-1">
                                {isAvailable
                                    ? 'Click "Assign Me" to get students assigned to you.'
                                    : 'Go online to receive assignments.'}
                            </p>
                        </div>

                        {/* Done for Today Button */}
                        {isAvailable && (
                            <button
                                onClick={async () => {
                                    if (!currentUser) return;
                                    if (!confirm('Are you sure you want to finish for today? Your vehicle will be released.')) return;
                                    try {
                                        await driverDoneForToday(currentUser.uid);
                                        await refreshProfile();
                                    } catch (error: unknown) {
                                        alert(error.message || 'Failed to finish.');
                                    }
                                }}
                                className="w-full clay-button-secondary py-3 mt-4"
                            >
                                I'm Done for Today
                            </button>
                        )}

                        {!isAvailable && (
                            <div className="clay-card text-center p-6 mt-8">
                                <p className="text-muted text-sm">You are currently offline.</p>
                                <p className="text-xs text-muted mt-2">Toggle online to receive assignments.</p>
                            </div>
                        )}
                    </div>
                );
        }
    };

    return (
        <>
            {renderContent()}

            {/* Vehicle Selector Modal */}
            {showVehicleSelector && (
                <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
                    <div className="bg-white sm:rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
                        {/* Header */}
                        <div className="sticky top-0 bg-white border-b border-cream-dark p-4 flex items-center justify-between">
                            <h3 className="font-header font-bold text-lg text-coffee">Select Vehicle</h3>
                            <button
                                onClick={() => setShowVehicleSelector(false)}
                                className="p-2 hover:bg-cream rounded-full transition-colors"
                            >
                                <X size={20} className="text-mocha" />
                            </button>
                        </div>

                        {/* Vehicle List */}
                        <div className="p-4 space-y-3">
                            {vehiclesLoading ? (
                                <div className="flex flex-col items-center justify-center py-8">
                                    <Loader2 className="animate-spin w-8 h-8 text-saffron" />
                                    <p className="text-sm text-coffee-500 mt-2">Loading vehicles...</p>
                                </div>
                            ) : availableVehicles.length === 0 ? (
                                <div className="text-center py-8">
                                    <Car size={40} className="mx-auto text-coffee-500 mb-3" />
                                    <p className="text-coffee-500">No vehicles available</p>
                                    <p className="text-xs text-coffee-500 mt-1">Contact a manager to add vehicles</p>
                                </div>
                            ) : (
                                availableVehicles.map((vehicle) => (
                                    <button
                                        key={vehicle.id}
                                        onClick={() => handleSelectVehicle(vehicle)}
                                        disabled={selectingVehicle}
                                        className="w-full clay-card p-4 flex items-center gap-4 hover:shadow-md transition-all disabled:opacity-50"
                                    >
                                        <div
                                            className="w-12 h-12 rounded-xl flex items-center justify-center text-white"
                                            style={{ backgroundColor: vehicle.color || '#888' }}
                                        >
                                            <Car size={22} className="text-white/90" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <p className="font-bold text-coffee">
                                                {vehicle.name}
                                            </p>
                                            <p className="text-sm text-coffee-500 font-mono">{vehicle.licensePlate}</p>
                                            <p className="text-xs text-coffee-500 flex items-center gap-1 mt-1">
                                                <Users size={12} />
                                                {vehicle.capacity} seats
                                            </p>
                                        </div>
                                        {selectingVehicle ? (
                                            <Loader2 className="animate-spin text-saffron" size={20} />
                                        ) : (
                                            <ChevronRight size={20} className="text-coffee-500" />
                                        )}
                                    </button>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-white border-t border-cream-dark p-4">
                            <p className="text-xs text-coffee-500 text-center">
                                {availableVehicles.length} vehicle{availableVehicles.length !== 1 ? 's' : ''} available
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
