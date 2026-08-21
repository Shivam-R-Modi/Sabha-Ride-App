import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Navigation, Users, Clock, MapPin, Phone, CheckCircle2, Circle, Loader2, AlertCircle, Bell } from 'lucide-react';
import { completeRide, sarthiArrived, CompleteRideResult } from '../../src/utils/cloudFunctions';
import { buildGoogleMapsNavigationUrl, openGoogleMaps } from '../../src/utils/googleMaps';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { Sheet } from '../shared/Sheet';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { seatsOnRide } from '../../src/constants/seats';
import { messageOf } from '../../src/utils/errorText';
import { advanceVisits, hasReachedEnd } from '../../src/utils/rideProgress';
import type { Fix } from '../../src/utils/presence';

interface ActiveRideProps {
    ride: {
        id: string;
        rideType: 'home-to-sabha' | 'sabha-to-home';
        students: Array<{
            id: string;
            name: string;
            phone?: string;
            location: { lat: number; lng: number; address?: string };
            picked: boolean;
        }>;
        route: Array<{
            lat: number;
            lng: number;
            name: string;
            type: 'start' | 'pickup' | 'dropoff' | 'end';
            studentId?: string;
            visited: boolean;
        }>;
        googleMapsUrl: string;
        estimatedDistance: number;
        estimatedTime: number;
    };
    onComplete: (result: { students: number; distance: number; time: number }, driverStats: { ridesCompletedToday: number; totalStudentsToday: number; totalDistanceToday: number }) => void;
    onBack: () => void;
}

export const ActiveRide: React.FC<ActiveRideProps> = ({ ride, onComplete, onBack }) => {
    const { currentUser } = useAuth();
    const { setFocusMode } = useNavigation();

    /**
     * This screen owns the viewport while a run is in progress.
     *
     * Two reasons. It drew its own sticky header directly underneath the
     * shell's, so the driver lost ~120px to two stacked bars — on a list of
     * stops read at arm's length in a car. And the bottom nav sat there
     * offering "History" and "Profile" mid-run, one thumb-width from the
     * tick-off buttons.
     */
    useEffect(() => {
        setFocusMode(true);
        return () => setFocusMode(false);
    }, [setFocusMode]);

    /**
     * The route, ticks and all — ONE representation.
     *
     * This used to be a `Set` of `"${type}-${idx}"` keys derived from the route
     * and mapped back on every write, which meant two models of the same fact and
     * an `indexOf` lookup that picks the wrong stop whenever two stops share
     * coordinates. Holding the waypoints themselves is both smaller and the shape
     * `advanceVisits` and Firestore already want.
     *
     * Seeded from the document, which is what makes progress survive the trip out
     * to Google Maps: iOS discards suspended pages, so the Sarthi comes back to a
     * fresh mount and reads their ticks back off the ride.
     */
    const [route, setRoute] = useState(() => ride.route.map(wp => ({ ...wp })));
    const [isCompleting, setIsCompleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showBackConfirm, setShowBackConfirm] = useState(false);

    const stops = route.filter(wp => wp.type === 'pickup' || wp.type === 'dropoff');
    const visitedCount = stops.filter(wp => wp.visited).length;
    const totalCount = stops.length;
    const allVisited = visitedCount >= totalCount;

    /**
     * Save the ticks where they will outlive this screen.
     *
     * The local state moves first and the write follows: a Sarthi who tapped a
     * stop must see it tick even on a dead signal outside somebody's house. A
     * failed write costs the round trip to Maps, not the tap.
     */
    const persistRoute = useCallback(async (next: typeof route) => {
        setRoute(next);
        try {
            await updateDoc(doc(db, 'rides', ride.id), { route: next });
        } catch (err) {
            console.error('[ActiveRide] Failed to save stop progress:', err);
        }
    }, [ride.id]);

    const handleToggleWaypoint = (index: number) => {
        persistRoute(route.map((wp, idx) => (idx === index ? { ...wp, visited: !wp.visited } : wp)));
    };

    /** Opened once by the geofence; after that only by hand. */
    const [rosterOpen, setRosterOpen] = useState(false);
    const venuePromptedRef = useRef(false);
    const [travelled, setTravelled] = useState<Set<string>>(
        () => new Set(ride.students.map(s => s.id)));

    /**
     * One location fix, arriving whenever the Sarthi glances back at the app.
     *
     * Display only. It ticks stops the car has reached so the screen looks like
     * the evening actually went, and it raises the roster once at the venue. It
     * decides nothing: reaching a house is not proof anyone boarded, and the
     * record is the roster the Sarthi confirms.
     */
    const handleFix = useCallback((fix: Fix) => {
        const advanced = advanceVisits(route, fix);
        if (advanced.changed) persistRoute(advanced.waypoints);

        // Only once, and only after the run has actually started — a Sarthi whose
        // own home sits near the venue must not be asked to confirm a roster
        // before they have driven anywhere.
        if (!venuePromptedRef.current && visitedCount > 0 && hasReachedEnd(route, fix)) {
            venuePromptedRef.current = true;
            setRosterOpen(true);
        }
    }, [route, visitedCount, persistRoute]);

    // Real-time GPS during the run: one watch, shared. It writes the driver's
    // position for the riders' tracking screen and hands the same fix here.
    useDriverLocation({
        driverId: currentUser?.uid || '',
        rideId: ride?.id || null,
        isRideActive: true,
        onFix: handleFix,
    });

    // Prefer the URL the assignment persisted; rebuild it from `route` for rides
    // assigned before that field was written, so an in-flight ride still
    // navigates. '' means neither source was usable — the button says so rather
    // than looking tappable and doing nothing.
    const mapsUrl = useMemo(
        () => ride.googleMapsUrl || buildGoogleMapsNavigationUrl(ride.route || []),
        [ride.googleMapsUrl, ride.route]
    );

    const arrivalWord = ride.rideType === 'home-to-sabha' ? 'at the sabha' : 'home safe';

    const handleOpenMaps = () => {
        // Opened synchronously from the click. This used to run inside the
        // navigator.geolocation.getCurrentPosition callback, by which point the
        // user activation was spent and iOS Safari and Chrome Android blocked
        // window.open outright. The URL carries no origin, so Maps routes from
        // the device's live location anyway — better than one stale GPS fix.
        openGoogleMaps(mapsUrl);
    };

    const [isArriving, setIsArriving] = useState(false);
    const [hasArrived, setHasArrived] = useState(false);

    const handleArrived = async () => {
        setIsArriving(true);
        try {
            await sarthiArrived(ride.id);
            setHasArrived(true);
        } catch (err) {
            // Best-effort: the Sarthi is outside either way, and the rider can
            // still be phoned. A failure here must not block Complete.
            setError(messageOf(err, 'Could not send the arrival message.'));
        } finally {
            setIsArriving(false);
        }
    };

    /**
     * Close the run against the roster the Sarthi just confirmed.
     *
     * Anyone unticked did not travel, and is reported as such: their ride is
     * cancelled rather than completed, and nobody is told they arrived somewhere
     * they never reached.
     *
     * This replaces a warning that could never be read. "Complete Ride" was
     * `disabled` until every stop was ticked, so the `!allVisited` confirmation
     * behind it was unreachable — and a single Bhulku who did not come out left
     * the Sarthi with no way to end the run at all except to tick a child off as
     * collected. The dead button and the lie were the same bug.
     */
    const handleCompleteRide = async () => {
        const absentStudentIds = ride.students
            .filter(s => !travelled.has(s.id))
            .map(s => s.id);

        setRosterOpen(false);
        setIsCompleting(true);
        setError(null);
        try {
            const result: CompleteRideResult = await completeRide(ride.id, absentStudentIds);
            onComplete(
                {
                    students: seatsOnRide({
                        ...ride,
                        students: ride.students.filter(s => travelled.has(s.id)),
                    }),
                    distance: ride.estimatedDistance,
                    time: ride.estimatedTime,
                },
                result.driverStats
            );
        } catch (err: unknown) {
            console.error('Error completing ride:', err);
            setError(messageOf(err, 'Failed to complete ride. Please try again.'));
        } finally {
            setIsCompleting(false);
        }
    };

    const handleBack = () => {
        if (visitedCount > 0) {
            setShowBackConfirm(true);
        } else {
            onBack();
        }
    };

    return (
        <div className="min-h-dvh pb-safe bg-cream">
            {/* Header */}
            <div className="glass-chrome border-b border-hairline/10 sticky top-0 z-sticky pt-safe">
                <div className="p-4">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={handleBack}
                            className="text-coffee font-medium flex items-center gap-1 hover:bg-cream-300/60 min-h-11 p-2 rounded-xl transition-colors"
                        >
                            <ArrowLeft size={20} /> Back
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-[rgb(var(--success))]"></div>
                            <span className="text-sm font-medium text-[rgb(var(--success-text))]">Ride in progress</span>
                        </div>
                    </div>

                    {/* Ride Info Card */}
                    <div className="bg-cream-300/50 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-2xl font-bold text-coffee">
                                Ride #{ride.id.slice(-6)}
                            </h2>
                            <div className="flex items-center gap-1 text-saffron">
                                {ride.rideType === 'home-to-sabha' ? (
                                    <><Navigation size={16} /> <span className="text-xs font-medium">Home → Sabha</span></>
                                ) : (
                                    <><Navigation size={16} className="rotate-180" /> <span className="text-xs font-medium">Sabha → Home</span></>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-coffee-700 mb-3">
                            <div className="flex items-center gap-1">
                                <Users size={14} />
                                <span>{seatsOnRide(ride)} {seatsOnRide(ride) === 1 ? 'person' : 'people'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Navigation size={14} />
                                <span>{(ride.estimatedDistance || 0).toFixed(1)} mi</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Clock size={14} />
                                <span>{Math.round(ride.estimatedTime || 0)} min</span>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1">
                            <div className="flex justify-between text-xs text-coffee-500">
                                <span>Progress</span>
                                <span>{visitedCount}/{totalCount} stops</span>
                            </div>
                            <div className="h-2 bg-cream-400 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-saffron to-saffron-light transition-all duration-300"
                                    style={{ width: `${totalCount > 0 ? (visitedCount / totalCount) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="px-4 mt-4">
                    <div className="bg-[rgb(var(--danger-bg))] rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="text-[rgb(var(--danger-text))] shrink-0 mt-0.5" size={18} />
                        <p className="text-[rgb(var(--danger-text))] text-sm">{error}</p>
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="px-4 mt-4 space-y-3">
                <button
                    onClick={handleOpenMaps}
                    disabled={!mapsUrl}
                    className={`w-full py-3 flex items-center justify-center gap-2 rounded-2xl ${mapsUrl
                        ? 'clay-button-secondary'
                        : 'bg-cream-400 text-coffee-500 cursor-not-allowed'
                        }`}
                >
                    <Navigation size={18} />
                    Open in Google Maps
                </button>

                {!mapsUrl && (
                    <p className="text-center text-xs text-coffee-500">
                        No route available for this ride — ask a manager to reassign it.
                    </p>
                )}

                {/* Sits ABOVE Complete, because it happens first and is the
                    lighter action. Disappears once tapped — the server is
                    idempotent on `arrivedAt`, so the button has nothing left to
                    do and leaving it would be a control that does nothing. */}
                {!hasArrived && (
                    <button
                        onClick={handleArrived}
                        disabled={isArriving}
                        className="w-full py-3 rounded-2xl font-bold clay-button-secondary flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                        {isArriving
                            ? <><Loader2 className="animate-spin" size={18} /> Telling them…</>
                            : <><Bell size={18} /> I have arrived</>}
                    </button>
                )}

                {/* Never disabled. It used to be dark until every stop was
                    ticked, which meant one Bhulku who did not come out of the
                    house left the Sarthi with no way to end the run — the roster
                    below is exactly the place to say what happened. */}
                <button
                    onClick={() => setRosterOpen(true)}
                    disabled={isCompleting}
                    className="w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all clay-btn-cta-large disabled:opacity-60"
                >
                    {isCompleting ? (
                        <><Loader2 className="animate-spin" size={20} /> Completing...</>
                    ) : (
                        <><CheckCircle2 size={20} /> Complete Ride</>
                    )}
                </button>

                {!allVisited && (
                    <p className="text-center text-xs text-coffee-500">
                        {totalCount - visitedCount} of {totalCount} stops still open — you can
                        still finish, and say who did not travel.
                    </p>
                )}
            </div>

            {/* Student List */}
            <div className="px-4 mt-6">
                <h3 className="text-sm font-bold text-coffee-500 uppercase tracking-wider mb-3">Bhulka</h3>
                <div className="space-y-3">
                    {ride.students.map((student) => {
                        const routeIdx = route.findIndex(r => r.studentId === student.id);
                        const isVisited = routeIdx >= 0 ? route[routeIdx].visited : false;

                        return (
                            <div
                                key={student.id}
                                className={`clay-card p-4 transition-all ${isVisited ? 'opacity-75' : ''}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-saffron to-saffron-light flex items-center justify-center text-white font-bold text-sm shrink-0">
                                        {student.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className={`font-bold text-coffee ${isVisited ? 'line-through text-coffee-500' : ''}`}>
                                            {student.name}
                                        </h4>
                                        {student.location?.address && (
                                            <p className="text-sm text-coffee-500 flex items-start gap-1 mt-1">
                                                <MapPin size={12} className="mt-0.5 shrink-0" />
                                                <span className="truncate">{student.location.address}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <button
                                            aria-label={isVisited
                                                ? `Undo ${student.name}'s stop`
                                                : `Mark ${student.name}'s stop done`}
                                            onClick={() => routeIdx >= 0 && handleToggleWaypoint(routeIdx)}
                                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isVisited
                                                ? 'bg-[rgb(var(--success-fill))] text-[rgb(var(--text-on-accent))]'
                                                : 'bg-cream-300 text-coffee-500 hover:bg-cream-400'
                                                }`}
                                        >
                                            {isVisited ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                                        </button>
                                        <a
                                            aria-label={`Call ${student.name}`}
                                            href={`tel:${student.phone || (student as any).studentPhone || ''}`}
                                            className="w-10 h-10 rounded-full bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))] flex items-center justify-center hover:opacity-90 transition-colors"
                                        >
                                            <Phone size={16} />
                                        </a>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Route Waypoints Summary */}
            <div className="px-4 mt-6 pb-8">
                <h3 className="text-sm font-bold text-coffee-500 uppercase tracking-wider mb-3">Route</h3>
                <div className="clay-card p-4 space-y-2">
                    {route.map((waypoint, idx) => (
                        <div
                            key={`${waypoint.type}-${idx}`}
                            className={`flex items-center gap-3 py-2 ${waypoint.type === 'start' || waypoint.type === 'end'
                                ? 'text-coffee-500 text-sm'
                                : waypoint.visited
                                    ? 'text-[rgb(var(--success-text))]'
                                    : 'text-coffee'
                                }`}
                        >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${waypoint.type === 'start' ? 'bg-cream-400' :
                                waypoint.type === 'end' ? 'bg-cream-400' :
                                    waypoint.visited ? 'bg-[rgb(var(--success-fill))] text-[rgb(var(--text-on-accent))]' : 'bg-saffron/20 text-saffron-800'
                                }`}>
                                {waypoint.type === 'start' ? 'S' :
                                    waypoint.type === 'end' ? 'E' :
                                        waypoint.visited ? '✓' : idx}
                            </div>
                            <span className="flex-1 text-sm truncate">{waypoint.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* THE RECORD.
                Pre-ticked, so a normal night is one tap. Untick anyone who did
                not get in the car: their ride is cancelled rather than completed
                and they are not reported as having arrived — which matters most
                on the way back, where the alternative is telling a parent their
                child is home safe. */}
            <Sheet
                open={rosterOpen}
                onClose={() => setRosterOpen(false)}
                title="Who travelled?"
                maxWidth="max-w-sm"
                footer={
                    <div className="flex gap-3">
                        <button
                            onClick={() => setRosterOpen(false)}
                            className="flex-1 clay-button-secondary"
                        >
                            Go back
                        </button>
                        <button
                            onClick={handleCompleteRide}
                            disabled={isCompleting}
                            className="flex-1 clay-button-primary disabled:opacity-60"
                        >
                            {isCompleting ? 'Completing…' : 'Complete run'}
                        </button>
                    </div>
                }
            >
                <p className="text-sm text-coffee-700 mb-3">
                    Untick anyone who did not travel. Everyone left ticked is recorded as
                    {' '}{arrivalWord}.
                </p>
                <div className="space-y-2">
                    {ride.students.map((student) => {
                        const came = travelled.has(student.id);
                        return (
                            <button
                                key={student.id}
                                onClick={() => setTravelled(prev => {
                                    const next = new Set(prev);
                                    if (came) next.delete(student.id); else next.add(student.id);
                                    return next;
                                })}
                                aria-pressed={came}
                                aria-label={came
                                    ? `${student.name} travelled — tap to say they did not`
                                    : `${student.name} did not travel — tap to undo`}
                                className="w-full flex items-center gap-3 p-3 rounded-xl bg-cream-300/50 text-left min-h-11"
                            >
                                {came
                                    ? <CheckCircle2 size={20} className="text-[rgb(var(--success-text))] shrink-0" />
                                    : <Circle size={20} className="text-coffee-500 shrink-0" />}
                                <span className={`flex-1 text-sm font-medium ${came ? 'text-coffee' : 'text-coffee-500 line-through'}`}>
                                    {student.name}
                                </span>
                                {!came && (
                                    <span className="text-xs text-coffee-500">did not travel</span>
                                )}
                            </button>
                        );
                    })}
                </div>
                {ride.students.every(s => !travelled.has(s.id)) && (
                    <p className="text-xs text-coffee-500 mt-3">
                        Nobody is ticked. The run will be recorded as carrying no one.
                    </p>
                )}
            </Sheet>

            <Sheet
                open={showBackConfirm}
                onClose={() => setShowBackConfirm(false)}
                title="Leave this run?"
                maxWidth="max-w-sm"
                footer={
                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowBackConfirm(false)}
                            className="flex-1 clay-button-secondary"
                        >
                            Stay
                        </button>
                        <button
                            onClick={() => { setShowBackConfirm(false); onBack(); }}
                            className="flex-1 clay-button-primary"
                        >
                            Leave
                        </button>
                    </div>
                }
            >
                <p className="text-sm text-coffee-700">
                    You have ticked off some stops. Your progress is saved, and the run stays
                    assigned to you — you can come back to it.
                </p>
            </Sheet>
        </div>
    );
};
