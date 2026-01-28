import React, { useState } from 'react';
import { User, TabView } from '../../types';
import { MOCK_HISTORY, DiyaIcon, LotusIcon } from '../../constants';
import { PickupForm } from '../PickupForm';
import { RideStatusCard } from '../RideStatus';
import { MyRides } from '../MyRides';
import { Car, Navigation, AlertCircle, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { useActiveRide, markReadyToLeave } from '../../hooks/useFirestore';
import { useNavigation } from '../../contexts/NavigationContext';

interface StudentDashboardProps {
    user: User;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ user }) => {
    const { currentTab } = useNavigation();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [showReadyModal, setShowReadyModal] = useState(false);

    // Use Firestore Hook
    const { activeRide, loading } = useActiveRide(user.id);

    const handleRequestRide = (details: any) => {
        setIsFormOpen(false);
    };

    const handleReadyToLeave = async () => {
        setShowReadyModal(false);
        if (activeRide) {
            await markReadyToLeave(activeRide.id);
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
                    <p className="text-xs font-bold text-gold mt-4 tracking-widest">CONNECTING...</p>
                </div>
            );
        }

        return (
            <div className="space-y-6 px-4 pt-6 pb-6 relative animate-in fade-in duration-500">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h2 className="text-2xl font-header font-bold text-coffee">Jai Swaminarayan!</h2>
                        <p className="text-mocha/80 text-sm">Welcome to your Sabha Seva</p>
                    </div>
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm border border-orange-100 hidden sm:flex">
                        <DiyaIcon className="w-6 h-6 text-saffron" />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeRide ? (
                        <div className="relative group md:col-span-2">
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
                            <div className="flex gap-4 items-center relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center text-saffron group-hover:bg-orange-100 transition-colors shadow-inner">
                                    <Car size={28} />
                                </div>
                                <div>
                                    <h3 className="font-header font-bold text-coffee text-xl leading-tight">Request Pickup</h3>
                                    <p className="text-xs text-mocha/60 mt-1 flex items-center gap-1">
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
                        {!activeRide && (
                            <div className="absolute inset-0 bg-cream/40 backdrop-blur-[1px] z-10 flex items-center justify-center">
                                <span className="clay-badge-status">Pending Assignment</span>
                            </div>
                        )}
                        <h3 className="font-header font-bold text-coffee text-xl mb-1">Return Trip</h3>
                        <p className="text-xs text-mocha/60 mb-8">Ready to go home? Alert your sevak.</p>

                        {activeRide?.isReadyToLeave ? (
                            <div className="bg-green-50 border border-green-100 text-green-700 py-5 rounded-2xl font-bold flex flex-col items-center justify-center gap-2 animate-in slide-in-from-bottom-4">
                                <div className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-green-100">
                                    <CheckCircle2 size={24} />
                                </div>
                                <span className="text-sm">Driver Notified</span>
                            </div>
                        ) : (
                            <button
                                disabled={!activeRide}
                                onClick={() => setShowReadyModal(true)}
                                className="clay-btn-cta-large mx-auto"
                            >
                                I'M READY TO LEAVE
                            </button>
                        )}
                    </div>

                    <div className="clay-card-notice flex gap-4 items-start md:col-span-1">
                        <div className="bg-amber-500/10 p-3 rounded-2xl text-amber-600">
                            <AlertCircle size={24} />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-amber-900 leading-tight">Weekly Notice</h4>
                            <p className="text-xs text-amber-800/80 mt-2 leading-relaxed">Please request your ride by Thursday evening to ensure we can coordinate a driver for your location.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderProfile = () => (
        <div className="p-8 text-center pt-10 animate-in fade-in duration-500 max-w-sm mx-auto">
            <div className="relative inline-block mb-6">
                <div className="absolute inset-0 bg-gold blur-2xl opacity-20 animate-pulse"></div>
                <img src={user.avatarUrl} className="w-32 h-32 rounded-3xl mx-auto relative border-4 border-white shadow-2xl" alt="Profile" />
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md border border-orange-50">
                    <Sparkles className="text-gold w-6 h-6" />
                </div>
            </div>
            <h2 className="text-2xl font-header font-bold text-coffee">{user.name}</h2>
            <p className="text-gold font-medium text-sm tracking-wide mt-1 uppercase">Devoted Student</p>
            <div className="clay-card mt-8 flex items-center gap-4 text-left">
                <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                    <MapPin size={20} />
                </div>
                <p className="text-sm text-mocha/70 line-clamp-2 leading-relaxed">{user.address}</p>
            </div>
        </div>
    );

    const renderContent = () => {
        switch (currentTab) {
            case 'home': return renderHome();
            case 'rides': return <MyRides history={MOCK_HISTORY} upcoming={activeRide ? [activeRide] : []} />;
            case 'profile': return renderProfile();
            default: return renderHome();
        }
    };

    return (
        <div className="w-full">
            {renderContent()}

            {showReadyModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-coffee/60 backdrop-blur-md animate-in fade-in">
                    <div className="clay-modal max-w-sm">
                        <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-6 text-saffron">
                            <Navigation size={32} />
                        </div>
                        <h3 className="font-header font-bold text-2xl text-coffee mb-2 text-center">Ready for Pickup?</h3>
                        <p className="text-mocha/60 text-sm mb-8 text-center leading-relaxed">Your driver will be notified to head towards the designated pickup point.</p>
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