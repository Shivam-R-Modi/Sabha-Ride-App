import React, { useState } from 'react';
import { ArrowLeft, Navigation, Users, Clock, MapPin, Phone, CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import { completeRide, CompleteRideResult } from '../../src/utils/cloudFunctions';
import { openGoogleMaps } from '../../src/utils/googleMaps';

interface ActiveRideProps {
    ride: {
        id: string;
        rideType: 'home-to-sabha' | 'sabha-to-home';
        students: Array<{
            id: string;
            name: string;
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
    const visitedCount = pickupDropoffWaypoints.filter((wp, idx) => {
        const routeIdx = ride.route.indexOf(wp);
        return visitedWaypoints.has(`${wp.type}-${routeIdx}`);
    }).length;
    const totalCount = pickupDropoffWaypoints.length;
    const allVisited = visitedCount >= totalCount;

    const handleToggleWaypoint = (waypoint: typeof ride.route[0], index: number) => {
        const key = `${waypoint.type}-${index}`;
        const newVisited = new Set(visitedWaypoints);
        if (newVisited.has(key)) {
            newVisited.delete(key);
        } else {
            newVisited.add(key);
        }
        setVisitedWaypoints(newVisited);
    };

    const handleOpenMaps = () => {
        if (ride.googleMapsUrl) {
            openGoogleMaps(ride.googleMapsUrl);
        }
    };

    const handleCompleteRide = async () => {
        if (!allVisited) {
            if (!confirm('Not all students have been picked up/dropped off. Are you sure you want to complete this ride?')) {
                return;
            }
        }

        setIsCompleting(true);
        setError(null);
        try {
            const result: CompleteRideResult = await completeRide(ride.id);
            onComplete(
                {
                    students: ride.students.length,
                    distance: ride.estimatedDistance,
                    time: ride.estimatedTime,
                },
                result.driverStats
            );
        } catch (err: any) {
            console.error('Error completing ride:', err);
            setError(err.message || 'Failed to complete ride. Please try again.');
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
        <div className="min-h-screen pb-safe bg-gradient-to-br from-[#FAF9F6] to-[#F5F0E8]">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md shadow-sm border-b border-orange-100 sticky top-0 z-30">
                <div className="p-4">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={handleBack}
                            className="text-coffee font-medium flex items-center gap-1 hover:bg-black/5 p-2 rounded-xl transition-colors"
                        >
                            <ArrowLeft size={20} /> Back
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="text-sm font-medium text-green-600">Ride In Progress</span>
                        </div>
                    </div>

                    {/* Ride Info Card */}
                    <div className="bg-gradient-to-r from-saffron/10 to-orange-100/50 rounded-2xl p-4">
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

                        <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                            <div className="flex items-center gap-1">
                                <Users size={14} />
                                <span>{ride.students.length} students</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Navigation size={14} />
                                <span>{(ride.estimatedDistance / 1609.34).toFixed(1)} mi</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Clock size={14} />
                                <span>{Math.round(ride.estimatedTime / 60)} min</span>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1">
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>Progress</span>
                                <span>{visitedCount}/{totalCount} stops</span>
                            </div>
                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-saffron to-orange-400 transition-all duration-300"
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
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                        <p className="text-red-600 text-sm">{error}</p>
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="px-4 mt-4 space-y-3">
                <button
                    onClick={handleOpenMaps}
                    className="w-full clay-button-secondary py-3 flex items-center justify-center gap-2"
                >
                    <Navigation size={18} />
                    Open in Google Maps
                </button>

                <button
                    onClick={handleCompleteRide}
                    disabled={isCompleting || !allVisited}
                    className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${allVisited
                            ? 'clay-btn-cta-large'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                >
                    {isCompleting ? (
                        <><Loader2 className="animate-spin" size={20} /> Completing...</>
                    ) : (
                        <><CheckCircle2 size={20} /> Complete Ride</>
                    )}
                </button>

                {!allVisited && (
                    <p className="text-center text-xs text-gray-400">
                        Complete all stops to enable ride completion
                    </p>
                )}
            </div>

            {/* Student List */}
            <div className="px-4 mt-6">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Students</h3>
                <div className="space-y-3">
                    {ride.students.map((student, idx) => {
                        const routePoint = ride.route.find(r => r.studentId === student.id);
                        const routeIdx = routePoint ? ride.route.indexOf(routePoint) : -1;
                        const isVisited = routeIdx >= 0 ? visitedWaypoints.has(`${routePoint?.type}-${routeIdx}`) : false;

                        return (
                            <div
                                key={student.id}
                                className={`clay-card p-4 transition-all ${isVisited ? 'opacity-75' : ''}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-saffron to-orange-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                        {student.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className={`font-bold text-coffee ${isVisited ? 'line-through text-gray-400' : ''}`}>
                                            {student.name}
                                        </h4>
                                        {student.location?.address && (
                                            <p className="text-sm text-gray-500 flex items-start gap-1 mt-1">
                                                <MapPin size={12} className="mt-0.5 shrink-0" />
                                                <span className="truncate">{student.location.address}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => routePoint && handleToggleWaypoint(routePoint, routeIdx)}
                                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isVisited
                                                    ? 'bg-green-500 text-white shadow-lg shadow-green-200'
                                                    : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                                                }`}
                                        >
                                            {isVisited ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                                        </button>
                                        <a
                                            href={`tel:${''}`}
                                            className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center hover:bg-blue-100 transition-colors"
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
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Route</h3>
                <div className="clay-card p-4 space-y-2">
                    {ride.route.map((waypoint, idx) => (
                        <div
                            key={`${waypoint.type}-${idx}`}
                            className={`flex items-center gap-3 py-2 ${waypoint.type === 'start' || waypoint.type === 'end'
                                    ? 'text-gray-400 text-sm'
                                    : visitedWaypoints.has(`${waypoint.type}-${idx}`)
                                        ? 'text-green-600'
                                        : 'text-coffee'
                                }`}
                        >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${waypoint.type === 'start' ? 'bg-gray-200' :
                                    waypoint.type === 'end' ? 'bg-gray-200' :
                                        visitedWaypoints.has(`${waypoint.type}-${idx}`) ? 'bg-green-500 text-white' : 'bg-saffron/20 text-saffron'
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

            {/* Back Confirmation Modal */}
            {showBackConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="text-lg font-bold text-coffee mb-2">Leave Ride?</h3>
                        <p className="text-gray-600 text-sm mb-4">
                            You've made progress on this ride. Are you sure you want to go back? Your progress will be saved.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowBackConfirm(false)}
                                className="flex-1 clay-button-secondary py-3"
                            >
                                Stay
                            </button>
                            <button
                                onClick={() => {
                                    setShowBackConfirm(false);
                                    onBack();
                                }}
                                className="flex-1 clay-button-primary py-3"
                            >
                                Leave
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
