import React, { useState, useEffect } from 'react';
import { Driver, AssignmentType } from '../../types';
import { MapPin, Users, ChevronRight, ToggleLeft, ToggleRight, Navigation, Car, RefreshCw, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { VehicleSelection } from './VehicleSelection';
import { AssignmentPreview } from './AssignmentPreview';
import { ActiveRide } from './ActiveRide';
import { CompletionScreen } from './CompletionScreen';
import { releaseVehicle, setDriverAvailability } from '../../hooks/useFirestore';
import {
    assignStudentsToDriver,
    driverDoneForToday,
    manuallyUpdateRideContext,
    AssignStudentsResult,
    CompleteRideResult
} from '../../src/utils/cloudFunctions';
import { buildGoogleMapsNavigationUrl, openGoogleMaps } from '../../src/utils/googleMaps';

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
        students: any[];
        route: any[];
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

    // Cast userProfile to Driver to safely access driver-specific properties
    const driverProfile = activeRole === 'driver' ? (userProfile as Driver) : null;
    const isAvailable = userProfile?.status === 'available';

    // Fetch ride context on mount
    useEffect(() => {
        const fetchRideContext = async () => {
            try {
                const context = await manuallyUpdateRideContext();
                setRideContext({
                    rideType: context.rideType as 'home-to-sabha' | 'sabha-to-home' | null,
                    displayText: context.displayText
                });
            } catch (error) {
                console.error('Error fetching ride context:', error);
            }
        };
        fetchRideContext();
    }, []);

    const toggleAvailability = async () => {
        if (!currentUser) {
            console.log("No current user");
            return;
        }
        const newStatus = isAvailable ? 'offline' : 'available';
        console.log(`Toggling availability to ${newStatus} for user ${currentUser.uid}`);
        try {
            await setDriverAvailability(currentUser.uid, newStatus as any);
            console.log("Availability updated successfully");
        } catch (error) {
            console.error("Failed to toggle availability:", error);
            alert("Failed to update availability. Please try again.");
        }
        await refreshProfile();
    };

    const handleReleaseVehicle = async () => {
        if (!userProfile?.currentVehicleId || !currentUser) return;
        setSwitchingCar(true);
        try {
            await releaseVehicle(userProfile.currentVehicleId, currentUser.uid);
            await refreshProfile();
        } catch (e) {
            console.error(e);
            alert("Error releasing vehicle.");
        } finally {
            setSwitchingCar(false);
        }
    };

    // Handle "Assign Me" button click - Show preview instead of auto-assigning
    const handleAssignMe = async () => {
        if (!currentUser || !userProfile?.currentVehicleId) {
            alert('Please select a vehicle first');
            return;
        }

        setIsAssigning(true);
        setError(null);
        try {
            const result = await assignStudentsToDriver(currentUser.uid, userProfile.currentVehicleId);
            console.log('Assignment result:', result);

            // Store the assignment and show preview
            setPendingAssignment(result);
            setViewState('preview');
        } catch (error: any) {
            console.error('Error getting assignment:', error);
            setError(error.message || 'Failed to get assignment. Please try again.');
            alert(error.message || 'Failed to get assignment. Please try again.');
        } finally {
            setIsAssigning(false);
        }
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
        } catch (error: any) {
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
                    <div className="pb-24 px-4 pt-6 space-y-6">
                        {/* Driver Status Header */}
                        <div className="clay-card space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-orange-100">
                                        <img src={userProfile?.avatarUrl} alt="Driver" className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <h2 className="font-header font-bold text-coffee leading-tight">{userProfile?.name}</h2>
                                        <p className={`text-xs font-medium ${isAvailable ? 'text-green-600' : 'text-gray-400'}`}>
                                            {isAvailable ? '● Online' : '○ Offline'}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={toggleAvailability} className="clay-toggle">
                                    {isAvailable ? <ToggleRight size={32} className="fill-saffron/20" /> : <ToggleLeft size={32} className="text-gray-300" />}
                                </button>
                            </div>

                            <div className="bg-gray-50 p-3 rounded-lg flex items-center justify-between border border-gray-100">
                                <div className="flex items-center gap-3">
                                    <div className="bg-white p-2 rounded-md text-coffee shadow-sm">
                                        <Car size={18} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-gray-500 uppercase">Current Vehicle</p>
                                        <p className="text-sm font-bold text-coffee">{userProfile?.currentVehicleName || "Vehicle Selected"}</p>
                                        <p className="text-[10px] text-gray-500 font-mono">{userProfile?.currentVehiclePlate || "No Plate"}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleReleaseVehicle}
                                    disabled={switchingCar}
                                    className="clay-button-secondary text-xs"
                                >
                                    {switchingCar ? <RefreshCw className="animate-spin" size={14} /> : "Switch Car"}
                                </button>
                            </div>
                        </div>

                        {/* Stats Summary */}
                        <div className="flex justify-between items-center px-2">
                            <div>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Today's Seva</p>
                                <p className="text-sm font-medium text-coffee">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Assignments</p>
                                <p className="text-sm font-medium text-coffee">0 Rounds</p>
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
                                disabled={isAssigning}
                                className="w-full clay-btn-cta-large py-4 text-lg"
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
                                    } catch (error: any) {
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

    return renderContent();
};
