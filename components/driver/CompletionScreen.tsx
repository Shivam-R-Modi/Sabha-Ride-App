import React, { useState, useEffect } from 'react';
import { CheckCircle2, Users, Navigation, Loader2, AlertCircle, Car, Sparkles, Home } from 'lucide-react';

interface CompletionScreenProps {
    rideId: string;
    rideNumber: string;
    stats: {
        students: number;
        distance: number;
        time: number;
    };
    driverStats: {
        ridesCompletedToday: number;
        totalStudentsToday: number;
        totalDistanceToday: number;
    };
    onAssignNext: () => void;
    onDoneForToday: () => void;
}

interface ConfettiPiece {
    id: number;
    left: number;
    delay: number;
    duration: number;
    color: string;
}

export const CompletionScreen: React.FC<CompletionScreenProps> = ({
    rideId,
    rideNumber,
    stats,
    driverStats,
    onAssignNext,
    onDoneForToday,
}) => {
    const [isAssigning, setIsAssigning] = useState(false);
    const [isFinishing, setIsFinishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);

    // Generate confetti on mount
    useEffect(() => {
        const colors = ['#FF6B35', '#D4AF37', '#22C55E', '#3B82F6', '#F59E0B'];
        const pieces: ConfettiPiece[] = Array.from({ length: 30 }, (_, i) => ({
            id: i,
            left: Math.random() * 100,
            delay: Math.random() * 2,
            duration: 2 + Math.random() * 2,
            color: colors[Math.floor(Math.random() * colors.length)],
        }));
        setConfetti(pieces);
    }, []);

    const handleAssignNext = async () => {
        setIsAssigning(true);
        setError(null);
        try {
            onAssignNext();
        } catch (err: any) {
            setError(err.message || 'Failed to get next assignment.');
        } finally {
            setIsAssigning(false);
        }
    };

    const handleDoneForToday = async () => {
        setIsFinishing(true);
        setError(null);
        try {
            await onDoneForToday();
        } catch (err: any) {
            setError(err.message || 'Failed to finish for today.');
        } finally {
            setIsFinishing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#FAF9F6] to-[#F5F0E8] flex flex-col relative overflow-hidden">
            {/* Confetti Animation */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
                {confetti.map((piece) => (
                    <div
                        key={piece.id}
                        className="absolute top-0 w-2 h-2 rounded-full animate-confetti"
                        style={{
                            left: `${piece.left}%`,
                            backgroundColor: piece.color,
                            animationDelay: `${piece.delay}s`,
                            animationDuration: `${piece.duration}s`,
                        }}
                    />
                ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center justify-center p-6 z-10">
                {/* Success Icon */}
                <div className="relative mb-6">
                    <div className="absolute inset-0 bg-green-500/20 rounded-full animate-ping"></div>
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg shadow-green-200 animate-bounce">
                        <CheckCircle2 size={48} className="text-white" />
                    </div>
                    {/* Sparkles */}
                    <Sparkles size={20} className="absolute -top-2 -right-2 text-yellow-400 animate-pulse" />
                    <Sparkles size={16} className="absolute -bottom-1 -left-3 text-saffron animate-pulse delay-150" />
                </div>

                {/* Success Message */}
                <h1 className="text-3xl font-bold text-coffee text-center mb-2">
                    Ride #{rideNumber} Completed
                </h1>
                <p className="text-green-600 font-medium mb-8">✓ Great job!</p>

                {/* Ride Summary Card */}
                <div className="w-full max-w-sm clay-card bg-gradient-to-r from-green-50 to-emerald-50 border-green-100 mb-6">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 text-center">Ride Summary</h3>
                    <div className="flex items-center justify-center gap-2 text-coffee font-medium text-center mb-4">
                        <span>{stats.students} students</span>
                        <span className="text-gray-300">•</span>
                        <span>{(stats.distance / 1609.34).toFixed(1)} mi</span>
                        <span className="text-gray-300">•</span>
                        <span>{Math.round(stats.time / 60)} min</span>
                    </div>

                    {/* Today's Stats */}
                    <div className="border-t border-green-200/50 pt-4 mt-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wider text-center mb-3">Today's Seva</p>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center">
                                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-1">
                                    <Car size={18} className="text-green-600" />
                                </div>
                                <p className="text-xl font-bold text-coffee">{driverStats.ridesCompletedToday}</p>
                                <p className="text-xs text-gray-500">Rides</p>
                            </div>
                            <div className="text-center">
                                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-1">
                                    <Users size={18} className="text-blue-600" />
                                </div>
                                <p className="text-xl font-bold text-coffee">{driverStats.totalStudentsToday}</p>
                                <p className="text-xs text-gray-500">Students</p>
                            </div>
                            <div className="text-center">
                                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-1">
                                    <Navigation size={18} className="text-orange-600" />
                                </div>
                                <p className="text-xl font-bold text-coffee">{(driverStats.totalDistanceToday / 1609.34).toFixed(0)}</p>
                                <p className="text-xs text-gray-500">Miles</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="w-full max-w-sm bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-3">
                        <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                        <p className="text-red-600 text-sm">{error}</p>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="w-full max-w-sm space-y-3">
                    <button
                        onClick={handleAssignNext}
                        disabled={isAssigning || isFinishing}
                        className="w-full clay-btn-cta-large py-4 text-lg flex items-center justify-center gap-2 animate-pulse"
                    >
                        {isAssigning ? (
                            <><Loader2 className="animate-spin" size={20} /> Finding...</>
                        ) : (
                            'Assign Next Ride'
                        )}
                    </button>

                    <button
                        onClick={handleDoneForToday}
                        disabled={isAssigning || isFinishing}
                        className="w-full clay-button-secondary py-4 flex items-center justify-center gap-2"
                    >
                        {isFinishing ? (
                            <><Loader2 className="animate-spin" size={18} /> Processing...</>
                        ) : (
                            <><Home size={18} /> Done for Today</>
                        )}
                    </button>
                </div>
            </div>

            {/* Custom CSS for confetti */}
            <style>{`
                @keyframes confetti {
                    0% {
                        transform: translateY(-100%) rotate(0deg);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(100vh) rotate(720deg);
                        opacity: 0;
                    }
                }
                .animate-confetti {
                    animation: confetti linear forwards;
                }
            `}</style>
        </div>
    );
};
