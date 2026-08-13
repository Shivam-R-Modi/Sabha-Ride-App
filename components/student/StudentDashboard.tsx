import React, { useState, useEffect, useMemo } from 'react';
import { User, Driver, TabView } from '../../types';
import { DiyaIcon, LotusIcon } from '../../constants';
import { PickupForm } from '../PickupForm';
import { RideStatusCard } from '../RideStatus';
import { MyRides } from '../MyRides';
import { Car, Navigation, AlertCircle, Loader2, Sparkles, CheckCircle2, Phone } from 'lucide-react';
import { useActiveRide, markReadyToLeave, updateUserProfile, useStudentRequestStatus, useWeeklyAttendance, useRideHistory } from '../../hooks/useFirestore';
import { useNavigation } from '../../contexts/NavigationContext';
import { useRideWindow } from '../../hooks/useRideWindow';
import { studentReadyToLeave } from '../../src/utils/cloudFunctions';
import { WeeklyAttendancePopup } from './WeeklyAttendancePopup';
import { seatsOf } from '../../src/constants/seats';
import { AttendanceBlockedScreen } from './AttendanceBlockedScreen';
import { ProfileEditor } from '../shared/ProfileEditor';
import { useToast } from '../../contexts/ToastContext';

interface StudentDashboardProps {
    user: User | Driver;
    onLogout?: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ user, onLogout }) => {
    const { currentTab } = useNavigation();
    const toast = useToast();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [showReadyModal, setShowReadyModal] = useState(false);
    // Whether drop-off is open comes from the server, not from this device's
    // clock. The old version tested `now.getDay() === 5 && now.getHours() >= 22`
    // on a 60-second interval: wrong for a phone in another timezone, and
    // completely deaf to a manager moving sabha or opening the window early.
    const { dropoffOpen, timeContext } = useRideWindow();
    const [isReadyLoading, setIsReadyLoading] = useState(false);


    // Use Firestore Hook
    const { activeRide, activeRides, loading } = useActiveRide(user.id);

    /**
     * Is this rider's party travelling in more than one car?
     *
     * A group too large for any vehicle is split, which leaves two live rides:
     * one with a driver and one still waiting. The ride card below renders only
     * the first and would read as "everyone is sorted", so the part still on the
     * pavement would appear nowhere at all.
     *
     * Null whenever nothing is split, which is the ordinary case and leaves the
     * screen exactly as it was.
     */
    const splitStatus = useMemo(() => {
        const legs = (activeRides || []).filter(r => r.groupId);
        if (legs.length < 2) return null;

        const assigned = legs.filter(r => r.status !== 'requested');
        const waiting = legs.filter(r => r.status === 'requested');
        if (assigned.length === 0 || waiting.length === 0) return null;

        const seats = (r: typeof legs[number]) => seatsOf(r);
        return {
            totalSeats: legs[0].groupSeatsTotal
                ?? legs.reduce((n, r) => n + seats(r), 0),
            assignedSeats: assigned.reduce((n, r) => n + seats(r), 0),
            waitingSeats: waiting.reduce((n, r) => n + seats(r), 0),
            driverName: assigned[0].driverName || assigned[0].driver?.name || '',
        };
    }, [activeRides]);

    // Check for dismissed request
    const { dismissedRequest, loading: dismissedLoading } = useStudentRequestStatus(user.id);

    // Weekly attendance check
    const { attendance, loading: attendanceLoading, hasResponded } = useWeeklyAttendance(user.id);
    const [showAttendancePopup, setShowAttendancePopup] = useState(false);
    const [attendanceResponse, setAttendanceResponse] = useState<'yes' | 'no' | null>(null);

    // Ride history with pagination
    const { rides: rideHistory, loading: historyLoading, hasMore, loadMore } = useRideHistory(user.id, 10);

    // Determine if popup should be shown (after attendance data is loaded)
    useEffect(() => {
        if (!attendanceLoading) {
            if (hasResponded && attendance) {
                setAttendanceResponse(attendance.response);
                setShowAttendancePopup(false);
            } else {
                // No response yet - show popup
                setShowAttendancePopup(true);
            }
        }
    }, [attendanceLoading, hasResponded, attendance]);

    // Handle attendance popup response
    const handleAttendanceResponse = (response: 'yes' | 'no') => {
        setAttendanceResponse(response);
        setShowAttendancePopup(false);
        if (response === 'yes' && !activeRide) {
            setIsFormOpen(true);
        }
    };

    // If user responded "no", show blocked screen
    if (attendanceResponse === 'no') {
        return (
            <AttendanceBlockedScreen
                user={user as User}
                onUnblock={() => setAttendanceResponse('yes')}
            />
        );
    }

    // Show attendance popup if needed (before other loading states)
    if (showAttendancePopup && !attendanceLoading) {
        return (
            <WeeklyAttendancePopup
                user={user as User}
                onResponse={handleAttendanceResponse}
            />
        );
    }



    const handleRequestRide = (details: any) => {
        setIsFormOpen(false);
    };

    const handleReadyToLeave = async () => {
        setIsReadyLoading(true);
        setShowReadyModal(false);

        try {
            // Call the Cloud Function instead of direct Firestore update
            await studentReadyToLeave(user.id);
        } catch (error) {
            console.error('Error marking ready to leave:', error);
            toast.error('Could not let your driver know. Please try again.');
        } finally {
            setIsReadyLoading(false);
        }
    };



    const renderHome = () => {
        if (isFormOpen) {
            return <PickupForm user={user} onClose={() => setIsFormOpen(false)} onSubmit={handleRequestRide} />;
        }

        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center h-64">
                    <div className="relative">
                        <Loader2 className="animate-spin w-10 h-10 text-saffron" />
                        <LotusIcon className="absolute inset-0 m-auto w-5 h-5 text-gold opacity-50" />
                    </div>
                    <p className="text-xs font-bold text-gold-700 mt-4 tracking-widest">CONNECTING...</p>
                </div>
            );
        }

        return (
            <div className="space-y-6 px-4 pt-6 pb-6 relative animate-in fade-in duration-500">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h2 className="text-2xl font-header font-bold text-coffee">Jai Swaminarayan!</h2>
                        <p className="text-coffee-700 text-sm">Welcome, {user.name}</p>
                    </div>
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm border border-orange-100 hidden sm:flex">
                        <DiyaIcon className="w-6 h-6 text-saffron" />
                    </div>
                </div>

                {/* Dismissed Request Notification */}
                {dismissedRequest && !activeRide && (
                    <div className="clay-card bg-red-50 border border-red-100">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                                <AlertCircle size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-header font-bold text-red-700 text-lg">Request Dismissed</h3>
                                <p className="text-sm text-red-600 mt-1">
                                    Your ride request was dismissed by {dismissedRequest.managerName}.
                                </p>
                                {dismissedRequest.managerContact && (
                                    <a
                                        href={`tel:${dismissedRequest.managerContact}`}
                                        className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors"
                                    >
                                        <Phone size={16} />
                                        Contact Manager
                                    </a>
                                )}
                                <p className="text-xs text-red-600 mt-3">
                                    Dismissed at {new Date(dismissedRequest.dismissedAt).toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeRide ? (
                        <div className="relative group md:col-span-2 space-y-3">
                            {/* Your party is travelling in more than one car.
                                The card below shows the leg that has a driver, and on
                                its own it reads as "everyone is sorted" — which for a
                                family still standing outside is simply untrue. */}
                            {splitStatus && (
                                <div className="clay-card border-l-4 border-l-amber-500 bg-amber-50/60 relative z-raised">
                                    <p className="font-bold text-coffee text-sm">
                                        {splitStatus.assignedSeats} of your {splitStatus.totalSeats} seats
                                        {splitStatus.driverName ? ` are with ${splitStatus.driverName}` : ' have a car'}.
                                    </p>
                                    <p className="text-xs text-coffee-500 mt-1">
                                        The other {splitStatus.waitingSeats} {splitStatus.waitingSeats === 1 ? 'is' : 'are'} still
                                        waiting for the next car — no car is big enough to take you all at once.
                                        Please decide between you who travels first.
                                    </p>
                                </div>
                            )}
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-saffron to-gold rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                            <RideStatusCard ride={activeRide} />
                        </div>
                    ) : (
                        <div
                            onClick={() => setIsFormOpen(true)}
                            className="clay-card-accent flex items-center justify-between group cursor-pointer relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 p-2 opacity-10">
                                <Sparkles size={40} className="text-gold" />
                            </div>
                            <div className="flex gap-4 items-center relative z-raised">
                                <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center text-saffron group-hover:bg-orange-100 transition-colors shadow-inner">
                                    <Car size={28} />
                                </div>
                                <div>
                                    <h3 className="font-header font-bold text-coffee text-xl leading-tight">Request Pickup</h3>
                                    <p className="text-xs text-coffee-500 mt-1 flex items-center gap-1">
                                        <Sparkles size={10} className="text-gold" />
                                        Click to join this Friday's ride
                                    </p>
                                </div>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-cream flex items-center justify-center text-gold shadow-sm group-hover:bg-gold group-hover:text-white transition-all">
                                <Navigation size={18} />
                            </div>
                        </div>
                    )}

                    <div className="clay-card text-center relative overflow-hidden transition-all group">
                        {!dropoffOpen && (
                            <div className="absolute inset-0 bg-cream/40 backdrop-blur-[1px] z-raised flex items-center justify-center">
                                <span className="clay-badge-status text-center px-3">
                                    {timeContext || 'Not available yet'}
                                </span>
                            </div>
                        )}
                        <h3 className="font-header font-bold text-coffee text-xl mb-1">Return Trip</h3>
                        <p className="text-xs text-coffee-500 mb-8">Ready to go home? Alert your sevak.</p>

                        {activeRide?.dropoffRequested ? (
                            <div className="bg-green-50 border border-green-100 text-green-700 py-5 rounded-2xl font-bold flex flex-col items-center justify-center gap-2 animate-in slide-in-from-bottom-4">
                                <div className="w-10 h-10 bg-green-700 text-white rounded-full flex items-center justify-center shadow-lg shadow-green-100">
                                    <CheckCircle2 size={24} />
                                </div>
                                <span className="text-sm">In Drop-off Queue</span>
                            </div>
                        ) : (
                            <button
                                disabled={!dropoffOpen || isReadyLoading}
                                onClick={() => setShowReadyModal(true)}
                                className="clay-btn-cta-large mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isReadyLoading ? 'Processing...' : "I'M READY TO LEAVE"}
                            </button>
                        )}
                    </div>

                    <div className="clay-card-notice flex gap-4 items-start md:col-span-1">
                        <div className="bg-amber-500/10 p-3 rounded-2xl text-amber-600">
                            <AlertCircle size={24} />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-amber-900 leading-tight">Weekly Notice</h4>
                            <p className="text-xs text-amber-800 mt-2 leading-relaxed">Please request your ride by Thursday evening to ensure we can coordinate a driver for your location.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderProfile = () => <ProfileEditor />;

    const renderContent = () => {
        switch (currentTab) {
            case 'home': return renderHome();
            case 'rides': return (
                <MyRides
                    history={rideHistory}
                    upcoming={activeRide ? [activeRide] : []}
                    onLoadMore={loadMore}
                    hasMoreHistory={hasMore}
                    loadingMore={historyLoading}
                />
            );
            case 'profile': return renderProfile();
            default: return renderHome();
        }
    };

    return (
        <div className="w-full">
            {renderContent()}

            {showReadyModal && (
                <div className="fixed inset-0 z-modal flex items-center justify-center p-6 bg-coffee/60 backdrop-blur-md animate-in fade-in">
                    <div className="clay-modal max-w-sm">
                        <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-6 text-saffron">
                            <Navigation size={32} />
                        </div>
                        <h3 className="font-header font-bold text-2xl text-coffee mb-2 text-center">Ready for Pickup?</h3>
                        <p className="text-coffee-500 text-sm mb-8 text-center leading-relaxed">Your driver will be notified to head towards the designated pickup point.</p>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setShowReadyModal(false)}
                                className="clay-button-secondary flex-1"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleReadyToLeave}
                                className="clay-button-primary flex-1"
                            >
                                Yes, Notify
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Fixed: Made className optional to prevent TypeScript error when invoked without it.
const MapPin = ({ size, className }: { size: number, className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
    </svg>
);