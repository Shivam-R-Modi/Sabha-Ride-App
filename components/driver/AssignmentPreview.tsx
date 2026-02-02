import React, { useState } from 'react';
import { ArrowLeft, MapPin, Users, Clock, Car, CheckCircle2, Loader2, Building2, Home, Navigation, AlertCircle } from 'lucide-react';
import { startRide, releaseAssignment } from '../../src/utils/cloudFunctions';
import { openGoogleMaps } from '../../src/utils/googleMaps';

interface AssignmentPreviewProps {
    assignment: {
        rideId: string;
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

    const studentCount = assignment.students.length;
    const capacity = assignment.car.capacity;

    const handleAccept = async () => {
        setIsAccepting(true);
        setError(null);
        try {
            await startRide(assignment.rideId);
            onAccept();
        } catch (err: any) {
            console.error('Error starting ride:', err);
            setError(err.message || 'Failed to start ride. Please try again.');
        } finally {
            setIsAccepting(false);
        }
    };

    const handleRelease = async () => {
        if (!confirm('Are you sure you want to release this assignment? The students will be returned to the unassigned pool.')) {
            return;
        }

        setIsReleasing(true);
        setError(null);
        try {
            await releaseAssignment(assignment.rideId);
            onRelease();
        } catch (err: any) {
            console.error('Error releasing assignment:', err);
            setError(err.message || 'Failed to release assignment. Please try again.');
        } finally {
            setIsReleasing(false);
        }
    };

    return (
        <div className="min-h-screen pb-safe bg-gradient-to-br from-[#FAF9F6] to-[#F5F0E8]">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md shadow-sm border-b border-orange-100 sticky top-0 z-30">
                <div className="p-4">
                    <button
                        onClick={onBack}
                        className="text-coffee font-medium flex items-center gap-1 hover:bg-black/5 p-2 rounded-xl transition-colors mb-4"
                    >
                        <ArrowLeft size={20} /> Back
                    </button>

                    <div className="text-center">
                        <span className="inline-block px-3 py-1 bg-orange-100 text-orange-700 text-xs font-bold uppercase tracking-wider rounded-full mb-2">
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
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                        <p className="text-red-600 text-sm">{error}</p>
                    </div>
                )}

                {/* Route Type Card */}
                <div className="clay-card bg-gradient-to-r from-orange-50 to-amber-50 border-orange-100">
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
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Route Type</p>
                                <p className="text-lg font-bold text-coffee">
                                    {rideType === 'home-to-sabha' ? 'Home → Sabha' : 'Sabha → Home'}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-gray-500 uppercase tracking-wider">Seats</p>
                            <p className="text-2xl font-bold text-saffron">
                                {studentCount}<span className="text-gray-400 text-lg">/{capacity}</span>
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-orange-200/50">
                        <div className="flex items-center gap-2">
                            <Navigation size={16} className="text-saffron" />
                            <div>
                                <p className="text-xs text-gray-500">Distance</p>
                                <p className="font-bold text-coffee">{(assignment.estimatedDistance / 1609.34).toFixed(1)} mi</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-saffron" />
                            <div>
                                <p className="text-xs text-gray-500">Est. Time</p>
                                <p className="font-bold text-coffee">{Math.round(assignment.estimatedTime / 60)} min</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Vehicle Card */}
                <div className="clay-card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <Car size={20} className="text-blue-600" />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wider">Assigned Vehicle</p>
                            <p className="font-bold text-coffee">{assignment.car.model} ({assignment.car.color})</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                        <span>License Plate</span>
                        <span className="font-mono font-bold text-coffee">{assignment.car.licensePlate}</span>
                    </div>
                </div>

                {/* Students List */}
                <div>
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
                        Students ({studentCount})
                    </h3>
                    <div className="space-y-3">
                        {assignment.students.map((student, idx) => (
                            <div key={student.id} className="clay-card p-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-saffron to-orange-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-bold text-coffee">{student.name}</h4>
                                        <p className="text-sm text-gray-500 flex items-start gap-1 mt-1">
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
                    <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Route Preview</h4>
                    <div className="space-y-2">
                        {assignment.route.map((waypoint, idx) => (
                            <div key={`${waypoint.type}-${idx}`} className="flex items-center gap-3">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${waypoint.type === 'start' ? 'bg-gray-200 text-gray-600' :
                                        waypoint.type === 'end' ? 'bg-gray-200 text-gray-600' :
                                            'bg-saffron/20 text-saffron'
                                    }`}>
                                    {waypoint.type === 'start' ? 'S' :
                                        waypoint.type === 'end' ? 'E' :
                                            idx}
                                </div>
                                <span className={`flex-1 text-sm truncate ${waypoint.type === 'start' || waypoint.type === 'end' ? 'text-gray-400' : 'text-coffee'
                                    }`}>
                                    {waypoint.name}
                                </span>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => openGoogleMaps(assignment.googleMapsUrl)}
                        className="w-full mt-4 py-2 text-saffron text-sm font-medium flex items-center justify-center gap-2 hover:bg-orange-50 rounded-lg transition-colors"
                    >
                        <Navigation size={14} />
                        Preview Route on Google Maps
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
        </div>
    );
};
