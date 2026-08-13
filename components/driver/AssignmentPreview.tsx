import React, { useMemo, useState } from 'react';
import { ArrowLeft, MapPin, Users, Clock, Car, CheckCircle2, Loader2, Building2, Home, Navigation, AlertCircle } from 'lucide-react';
import { startRide, releaseAssignment } from '../../src/utils/cloudFunctions';
import { buildGoogleMapsNavigationUrl, openGoogleMaps } from '../../src/utils/googleMaps';
import { useConfirm } from '../shared/useConfirm';
import { seatsOf } from '../../src/constants/seats';

interface AssignmentPreviewProps {
    assignment: {
        rideId: string;
        students: Array<{
            id: string;
            name: string;
            location: { lat: number; lng: number; address?: string };
            picked: boolean;
            /** People at this stop. Absent means one. */
            seats?: number;
            /** Whole party size when this stop is one part of a group split across cars. */
            groupSeats?: number;
        }>;
        route: Array<{
            lat: number;
            lng: number;
            name: string;
            type: 'start' | 'pickup' | 'dropoff' | 'end';
            studentId?: string;
            visited: boolean;
        }>;
        estimatedDistance: number;
        estimatedTime: number;
        googleMapsUrl: string;
        car: {
            model: string;
            color: string;
            licensePlate: string;
            capacity: number;
        };
    };
    rideType: 'home-to-sabha' | 'sabha-to-home';
    onAccept: () => void;
    onRelease: () => void;
    onBack: () => void;
}

export const AssignmentPreview: React.FC<AssignmentPreviewProps> = ({
    assignment,
    rideType,
    onAccept,
    onRelease,
    onBack,
}) => {
    const [isAccepting, setIsAccepting] = useState(false);
    const [isReleasing, setIsReleasing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { ask, confirmDialog } = useConfirm();

    // People, not stops. This read `students.length` against the car's capacity,
    // so a car carrying a family of three showed "1/4" and looked nearly empty.
    // A stop is an address; the seats are what has to fit in the vehicle.
    const seatsTaken = assignment.students.reduce((n, s) => n + seatsOf({ seatsRequested: s.seats }), 0);
    // The driver's own seat is not one of them.
    const passengerSeats = Math.max(1, assignment.car.capacity - 1);

    // Stops where only part of the party is travelling with this driver. Nothing
    // else on this screen would say so, and a driver who counts heads against a
    // full car will pull away leaving the rest of a family on the pavement.
    const splitStops = assignment.students.filter(
        s => s.groupSeats && s.groupSeats > seatsOf({ seatsRequested: s.seats }));

    // Same source-then-fallback as ActiveRide. See buildGoogleMapsNavigationUrl
    // for why the URL carries no origin.
    const mapsUrl = useMemo(
        () => assignment.googleMapsUrl || buildGoogleMapsNavigationUrl(assignment.route || []),
        [assignment.googleMapsUrl, assignment.route]
    );

    const handleAccept = async () => {
        setIsAccepting(true);
        setError(null);
        try {
            await startRide(assignment.rideId);
            onAccept();
        } catch (err: unknown) {
            console.error('Error starting ride:', err);
            setError(err.message || 'Failed to start ride. Please try again.');
        } finally {
            setIsAccepting(false);
        }
    };

    const handleRelease = async () => {
        const ok = await ask({
            title: 'Release this assignment?',
            message: 'These students go back into the unassigned pool for another driver to pick up.',
            confirmLabel: 'Release',
            cancelLabel: 'Keep it',
            destructive: true,
        });
        if (!ok) return;

        setIsReleasing(true);
        setError(null);
        try {
            await releaseAssignment(assignment.rideId);
            onRelease();
        } catch (err: unknown) {
            console.error('Error releasing assignment:', err);
            setError(err.message || 'Failed to release assignment. Please try again.');
        } finally {
            setIsReleasing(false);
        }
    };

    return (
        <div className="min-h-screen pb-safe bg-gradient-to-br from-[#FAF9F6] to-[#F5F0E8]">
            {/* Header */}
            <div className="bg-[rgb(var(--surface)/0.8)] backdrop-blur-md shadow-sm border-b border-hairline/10 sticky top-0 z-sticky">
                <div className="p-4">
                    <button
                        onClick={onBack}
                        className="text-coffee font-medium flex items-center gap-1 hover:bg-black/5 p-2 rounded-xl transition-colors mb-4"
                    >
                        <ArrowLeft size={20} /> Back
                    </button>

                    <div className="text-center">
                        <span className="inline-block px-3 py-1 bg-cream-300 text-saffron-800 text-xs font-bold uppercase tracking-wider rounded-full mb-2">
                            Assignment Preview
                        </span>
                        <h1 className="text-3xl font-bold text-coffee">
                            Ride #{assignment.rideId.slice(-6)}
                        </h1>
                    </div>
                </div>
            </div>

            <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
                {/* Error Display */}
                {error && (
                    <div className="bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="text-[rgb(var(--danger-text))] shrink-0 mt-0.5" size={18} />
                        <p className="text-[rgb(var(--danger-text))] text-sm">{error}</p>
                    </div>
                )}

                {/* Route Type Card */}
                <div className="clay-card bg-gradient-to-r from-cream-300 to-cream-300 border-hairline/10">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-saffron/20 flex items-center justify-center">
                                {rideType === 'home-to-sabha' ? (
                                    <Building2 size={24} className="text-saffron" />
                                ) : (
                                    <Home size={24} className="text-saffron" />
                                )}
                            </div>
                            <div>
                                <p className="text-xs text-coffee-500 uppercase tracking-wider">Route Type</p>
                                <p className="text-lg font-bold text-coffee">
                                    {rideType === 'home-to-sabha' ? 'Home → Sabha' : 'Sabha → Home'}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-coffee-500 uppercase tracking-wider">Seats</p>
                            <p className="text-2xl font-bold text-saffron-800">
                                {seatsTaken}<span className="text-coffee-500 text-lg">/{passengerSeats}</span>
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-hairline/20/50">
                        <div className="flex items-center gap-2">
                            <Navigation size={16} className="text-saffron" />
                            <div>
                                <p className="text-xs text-coffee-500">Distance</p>
                                <p className="font-bold text-coffee">{assignment.estimatedDistance.toFixed(1)} mi</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-saffron" />
                            <div>
                                <p className="text-xs text-coffee-500">Est. Time</p>
                                <p className="font-bold text-coffee">{assignment.estimatedTime} min</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Vehicle Card */}
                <div className="clay-card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-[rgb(var(--info-bg))] flex items-center justify-center">
                            <Car size={20} className="text-[rgb(var(--info-text))]" />
                        </div>
                        <div>
                            <p className="text-xs text-coffee-500 uppercase tracking-wider">Assigned Vehicle</p>
                            <p className="font-bold text-coffee">{assignment.car.model} ({assignment.car.color})</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-coffee-700 bg-cream-200 rounded-lg p-3">
                        <span>License Plate</span>
                        <span className="font-mono font-bold text-coffee">{assignment.car.licensePlate}</span>
                    </div>
                </div>

                {/* Part of a larger party is travelling with someone else.
                    Stated once, up front, because the seat total below will look
                    complete and there is nothing else on this screen to suggest
                    people are being left behind. */}
                {splitStops.length > 0 && (
                    <div className="clay-card border-l-4 border-l-[rgb(var(--warning))] bg-[rgb(var(--warning-bg))]/60">
                        <div className="flex items-start gap-3">
                            <AlertCircle size={20} className="text-[rgb(var(--warning-text))] shrink-0 mt-0.5" />
                            <div className="text-sm text-coffee">
                                <p className="font-bold">Another car is coming to {splitStops.length === 1 ? 'one of these stops' : 'some of these stops'}.</p>
                                {splitStops.map(s => (
                                    <p key={s.id} className="text-xs text-coffee-500 mt-1">
                                        {s.name}: you are taking {seatsOf({ seatsRequested: s.seats })} of {s.groupSeats}.
                                        The rest travel separately — please don't wait for them.
                                    </p>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Students List */}
                <div>
                    <h3 className="text-sm font-bold text-coffee-500 uppercase tracking-wider mb-3">
                        Stops ({assignment.students.length}) &middot; {seatsTaken} {seatsTaken === 1 ? 'person' : 'people'}
                    </h3>
                    <div className="space-y-3">
                        {assignment.students.map((student, idx) => (
                            <div key={student.id} className="clay-card p-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-saffron to-saffron-light flex items-center justify-center text-white font-bold text-sm shrink-0">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <h4 className="font-bold text-coffee truncate">{student.name}</h4>
                                            {/* How many to expect at the door. Shown only when it
                                                is more than one, so a single rider's card is
                                                unchanged. */}
                                            {seatsOf({ seatsRequested: student.seats }) > 1 && (
                                                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold bg-cream-300 text-saffron-800 px-2 py-1 rounded-lg tabular-nums">
                                                    <Users size={11} />
                                                    {seatsOf({ seatsRequested: student.seats })}
                                                    {student.groupSeats ? ` of ${student.groupSeats}` : ''}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-coffee-500 flex items-start gap-1 mt-1">
                                            <MapPin size={12} className="mt-0.5 shrink-0" />
                                            <span className="truncate">
                                                {student.location?.address || 'Address not available'}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Route Preview */}
                <div className="clay-card p-4">
                    <h4 className="text-sm font-bold text-coffee-500 uppercase tracking-wider mb-3">Route Preview</h4>
                    <div className="space-y-2">
                        {assignment.route.map((waypoint, idx) => (
                            <div key={`${waypoint.type}-${idx}`} className="flex items-center gap-3">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${waypoint.type === 'start' ? 'bg-cream-400 text-coffee-700' :
                                    waypoint.type === 'end' ? 'bg-cream-400 text-coffee-700' :
                                        'bg-saffron/20 text-saffron'
                                    }`}>
                                    {waypoint.type === 'start' ? 'S' :
                                        waypoint.type === 'end' ? 'E' :
                                            idx}
                                </div>
                                <span className={`flex-1 text-sm truncate ${waypoint.type === 'start' || waypoint.type === 'end' ? 'text-coffee-500' : 'text-coffee'
                                    }`}>
                                    {waypoint.name}
                                </span>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => openGoogleMaps(mapsUrl)}
                        disabled={!mapsUrl}
                        className={`w-full mt-4 py-2 text-sm font-medium flex items-center justify-center gap-2 rounded-lg transition-colors ${mapsUrl
                            ? 'text-saffron-800 hover:bg-cream-300'
                            : 'text-coffee-500 cursor-not-allowed'
                            }`}
                    >
                        <Navigation size={14} />
                        {mapsUrl ? 'Preview Route on Google Maps' : 'Route unavailable'}
                    </button>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-4">
                    <button
                        onClick={handleAccept}
                        disabled={isAccepting || isReleasing}
                        className="w-full clay-btn-cta-large py-4 text-lg flex items-center justify-center gap-2"
                    >
                        {isAccepting ? (
                            <><Loader2 className="animate-spin" size={20} /> Starting...</>
                        ) : (
                            <><CheckCircle2 size={20} /> Accept & Start</>
                        )}
                    </button>

                    <button
                        onClick={handleRelease}
                        disabled={isAccepting || isReleasing}
                        className="w-full clay-button-secondary py-3 flex items-center justify-center gap-2"
                    >
                        {isReleasing ? (
                            <><Loader2 className="animate-spin" size={18} /> Releasing...</>
                        ) : (
                            'Release Assignment'
                        )}
                    </button>
                </div>
            </div>
        {confirmDialog}
        </div>
    );
};
