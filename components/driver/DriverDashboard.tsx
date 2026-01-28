
import React, { useState } from 'react';
import { DriverAssignment, AssignmentType, Driver } from '../../types';
import { MapPin, Users, ChevronRight, ToggleLeft, ToggleRight, Navigation, Car, RefreshCw, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { VehicleSelection } from './VehicleSelection';
import { releaseVehicle, useDriverAssignments, setDriverAvailability } from '../../hooks/useFirestore';

interface DriverDashboardProps {
  onSelectAssignment: (assignment: DriverAssignment) => void;
}

interface AssignmentCardProps {
  assignment: DriverAssignment;
  onSelect: (assignment: DriverAssignment) => void;
}

const AssignmentCard: React.FC<AssignmentCardProps> = ({ assignment, onSelect }) => {
    const isPickup = assignment.type === 'pickup';
    const completedCount = assignment.passengers.filter(p => p.stopStatus === 'completed').length;
    const totalCount = assignment.passengers.length;
    
    return (
      <div 
        onClick={() => onSelect(assignment)}
        className="bg-white rounded-2xl p-5 shadow-md border border-gray-100 active:scale-[0.98] transition-all cursor-pointer relative overflow-hidden group"
      >
        {/* Decorative Indicator Strip */}
        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${isPickup ? 'bg-saffron' : 'bg-blue-500'}`} />

        <div className="flex justify-between items-start mb-4 pl-2">
            <div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                    isPickup ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                }`}>
                    {isPickup ? 'Pickup Round' : 'Drop-off Round'}
                </span>
                <h3 className="text-lg font-bold text-coffee mt-2 flex items-center gap-2">
                    {assignment.status === 'active' ? 'En Route' : 'Pending'}
                </h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-gray-100 transition-colors">
                <ChevronRight size={20} />
            </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-4 pl-2">
            <div>
                <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                    <Users size={14} />
                    <span className="text-xs font-medium">Passengers</span>
                </div>
                <p className="font-header font-bold text-coffee">{completedCount}/{totalCount}</p>
            </div>
            <div>
                <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                    <Navigation size={14} />
                    <span className="text-xs font-medium">Distance</span>
                </div>
                <p className="font-header font-bold text-coffee">{assignment.totalDistance}</p>
            </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 pl-2">
            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                <div 
                    className={`h-full ${isPickup ? 'bg-saffron' : 'bg-blue-500'}`} 
                    style={{ width: `${(completedCount/totalCount)*100}%` }} 
                />
            </div>
        </div>
      </div>
    );
};

export const DriverDashboard: React.FC<DriverDashboardProps> = ({ onSelectAssignment }) => {
  const { userProfile, currentUser, refreshProfile } = useAuth();
  const [switchingCar, setSwitchingCar] = useState(false);
  
  // Real Assignments
  const { assignments, loading } = useDriverAssignments(currentUser?.uid || '');

  // Cast userProfile to Driver to safely access driver-specific properties
  const driverProfile = userProfile?.role === 'driver' ? (userProfile as Driver) : null;

  // Local state for toggle, ideally persisted in DB via setDriverAvailability
  // We assume 'available' in DB means online. 
  // Fixed error: Accessing 'status' from driverProfile instead of userProfile union
  const isAvailable = driverProfile?.status === 'available';

  const toggleAvailability = async () => {
      if (!currentUser) return;
      const newStatus = isAvailable ? 'offline' : 'available';
      // Optimistic update handled by Firestore listener eventually, but we just trigger it
      await setDriverAvailability(currentUser.uid, newStatus as any);
      await refreshProfile();
  };

  // Check if driver has a selected vehicle
  const hasVehicle = !!userProfile?.currentVehicleId;

  const handleReleaseVehicle = async () => {
      if (!userProfile?.currentVehicleId || !currentUser) return;
      setSwitchingCar(true);
      try {
          await releaseVehicle(userProfile.currentVehicleId, currentUser.uid);
          await refreshProfile(); // This will trigger re-render and show selection screen
      } catch (e) {
          console.error(e);
          alert("Error releasing vehicle.");
      } finally {
          setSwitchingCar(false);
      }
  };

  // If no vehicle selected, show selection screen
  if (!hasVehicle) {
      return <VehicleSelection onSelectionComplete={() => {}} />;
  }

  return (
    <div className="pb-24 px-4 pt-6 space-y-6">
      {/* Driver Status Header */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-orange-50 space-y-4">
          
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
            <button onClick={toggleAvailability} className="text-saffron transition-colors">
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
                      {/* Fixed errors: Accessing driver-specific properties from driverProfile */}
                      <p className="text-sm font-bold text-coffee">{driverProfile?.carModel || "Vehicle Selected"}</p>
                      <p className="text-[10px] text-gray-500 font-mono">{driverProfile?.plateNumber}</p>
                  </div>
              </div>
              <button 
                onClick={handleReleaseVehicle}
                disabled={switchingCar}
                className="text-[10px] font-bold text-saffron hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors border border-orange-200"
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
             {/* Dynamic stats can be added later */}
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Assignments</p>
            <p className="text-sm font-medium text-coffee">{assignments.length} Rounds</p>
         </div>
      </div>

      {/* Assignments List */}
      <div className="space-y-4">
        {loading ? (
             <div className="text-center py-10 opacity-50">
                 <Loader2 className="w-8 h-8 animate-spin mx-auto text-saffron mb-2" />
                 <p className="text-sm">Fetching assignments...</p>
             </div>
        ) : assignments.length > 0 ? (
            assignments.map(assignment => (
                <AssignmentCard key={assignment.id} assignment={assignment} onSelect={onSelectAssignment} />
            ))
        ) : (
            <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <p className="text-gray-400 font-medium text-sm">No assignments yet.</p>
                <p className="text-xs text-gray-400 mt-1">Stay online, assignments will appear automatically.</p>
            </div>
        )}
      </div>

      {!isAvailable && (
          <div className="text-center p-6 bg-gray-50 rounded-xl border border-dashed border-gray-200 mt-8">
              <p className="text-gray-400 text-sm">You are currently offline.</p>
          </div>
      )}
    </div>
  );
};
