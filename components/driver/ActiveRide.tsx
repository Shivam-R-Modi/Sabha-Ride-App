import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Navigation, Users, Clock, MapPin, Phone, CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import { completeRide, CompleteRideResult } from '../../src/utils/cloudFunctions';
import { buildGoogleMapsNavigationUrl, openGoogleMaps } from '../../src/utils/googleMaps';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../shared/useConfirm';
import { useNavigation } from '../../contexts/NavigationContext';
import { Sheet } from '../shared/Sheet';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { seatsOnRide } from '../../src/constants/seats';
import { messageOf } from '../../src/utils/errorText';

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
    const { ask, confirmDialog } = useConfirm();
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

    // Enable real-time GPS location tracking during active ride
    useDriverLocation({
        driverId: currentUser?.uid || '',
        rideId: ride?.id || null,
        isRideActive: true
    });

    const [visitedWaypoints, setVisitedWaypoints] = useState<Set<string>>(() => {
        const visited = new Set<string>();
        ride.route.forEach((wp, idx) => {
            if (wp.visited) visited.add(`${wp.type}-${idx}`);
        });
        return visited;
    });
    const [isCompleting, setIsCompleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showBackConfirm, setShowBackConfirm] = useState(false);

    // Calculate progress
    const pickupDropoffWaypoints = ride.route.filter(wp => wp.type === 'pickup' || wp.type === 'dropoff');
    const visitedCount = pickupDropoffWaypoints.filter((wp) => {
        const routeIdx = ride.route.indexOf(wp);
        return visitedWaypoints.has(`${wp.type}-${routeIdx}`);
    }).length;
    const totalCount = pickupDropoffWaypoints.length;
    const allVisited = visitedCount >= totalCount;

    const handleToggleWaypoint = async (waypoint: typeof ride.route[0], index: number) => {
        const key = `${waypoint.type}-${index}`;
        const newVisited = new Set(visitedWaypoints);
        const isNowVisited = !newVisited.has(key);
        if (isNowVisited) {
            newVisited.add(key);
        } else {
            newVisited.delete(key);
        }
        setVisitedWaypoints(newVisited);

        try {
            // Update route progress in Firestore in real-time
            const updatedRoute = ride.route.map((wp, idx) => {
                if (idx === index) {
                    return { ...wp, visited: isNowVisited };
                }
                return wp;
            });
            await updateDoc(doc(db, 'rides', ride.id), {
                route: updatedRoute
            });
        } catch (err) {
            console.error('[ActiveRide] Failed to update waypoint status in Firestore:', err);
        }
    };

    // Prefer the URL the assignment persisted; rebuild it from `route` for rides
    // assigned before that field was written, so an in-flight ride still
    // navigates. '' means neither source was usable — the button says so rather
    // than looking tappable and doing nothing.
    const mapsUrl = useMemo(
        () => ride.googleMapsUrl || buildGoogleMapsNavigationUrl(ride.route || []),
        [ride.googleMapsUrl, ride.route]
    );

    const handleOpenMaps = () => {
        // Opened synchronously from the click. This used to run inside the
        // navigator.geolocation.getCurrentPosition callback, by which point the
        // user activation was spent and iOS Safari and Chrome Android blocked
        // window.open outright. The URL carries no origin, so Maps routes from
        // the device's live location anyway — better than one stale GPS fix.
        openGoogleMaps(mapsUrl);
    };

    const handleCompleteRide = async () => {
        if (!allVisited) {
            const ok = await ask({
                title: 'Complete this ride?',
                message: 'Not all students have been picked up or dropped off.',
                confirmLabel: 'Complete anyway',
                cancelLabel: 'Go back',
                destructive: true,
            });
            if (!ok) return;
        }

        setIsCompleting(true);
        setError(null);
        try {
            const result: CompleteRideResult = await completeRide(ride.id);
            onComplete(
                {
                    students: seatsOnRide(ride),
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

                <button
                    onClick={handleCompleteRide}
                    disabled={isCompleting || !allVisited}
                    className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${allVisited
                        ? 'clay-btn-cta-large'
                        : 'bg-cream-400 text-coffee-500 cursor-not-allowed'
                        }`}
                >
                    {isCompleting ? (
                        <><Loader2 className="animate-spin" size={20} /> Completing...</>
                    ) : (
                        <><CheckCircle2 size={20} /> Complete Ride</>
                    )}
                </button>

                {!allVisited && (
                    <p className="text-center text-xs text-coffee-500">
                        Complete all stops to enable ride completion
                    </p>
                )}
            </div>

            {/* Student List */}
            <div className="px-4 mt-6">
                <h3 className="text-sm font-bold text-coffee-500 uppercase tracking-wider mb-3">Bhulka</h3>
                <div className="space-y-3">
                    {ride.students.map((student) => {
                        const routePoint = ride.route.find(r => r.studentId === student.id);
                        const routeIdx = routePoint ? ride.route.indexOf(routePoint) : -1;
                        const isVisited = routeIdx >= 0 ? visitedWaypoints.has(`${routePoint?.type}-${routeIdx}`) : false;

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
                                            onClick={() => routePoint && handleToggleWaypoint(routePoint, routeIdx)}
                                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isVisited
                                                ? 'bg-[rgb(var(--success-fill))] text-[rgb(var(--text-on-accent))]'
                                                : 'bg-cream-300 text-coffee-500 hover:bg-cream-400'
                                                }`}
                                        >
                                            {isVisited ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                                        </button>
                                        <a
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
                    {ride.route.map((waypoint, idx) => (
                        <div
                            key={`${waypoint.type}-${idx}`}
                            className={`flex items-center gap-3 py-2 ${waypoint.type === 'start' || waypoint.type === 'end'
                                ? 'text-coffee-500 text-sm'
                                : visitedWaypoints.has(`${waypoint.type}-${idx}`)
                                    ? 'text-[rgb(var(--success-text))]'
                                    : 'text-coffee'
                                }`}
                        >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${waypoint.type === 'start' ? 'bg-cream-400' :
                                waypoint.type === 'end' ? 'bg-cream-400' :
                                    visitedWaypoints.has(`${waypoint.type}-${idx}`) ? 'bg-[rgb(var(--success-fill))] text-[rgb(var(--text-on-accent))]' : 'bg-saffron/20 text-saffron-800'
                                }`}>
                                {waypoint.type === 'start' ? 'S' :
                                    waypoint.type === 'end' ? 'E' :
                                        visitedWaypoints.has(`${waypoint.type}-${idx}`) ? '✓' : idx}
                            </div>
                            <span className="flex-1 text-sm truncate">{waypoint.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {confirmDialog}

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
