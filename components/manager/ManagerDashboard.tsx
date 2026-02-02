import React, { useState } from 'react';
import { FleetManagement } from './FleetManagement';
import { RequestTable } from './RequestTable';
import { BottomSheet } from '../shared/BottomSheet';
import {
  Bell,
  Car,
  X,
  Download,
  Users,
  Phone,
  MapPin,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePendingDrivers, updateUserStatus, useAutoDispatch, usePendingRequests, useAllActiveRides, assignRideToDriver, unassignRide, useAvailableDrivers } from '../../hooks/useFirestore';
import { Driver, Ride, StudentRequest } from '../../types';
import { manualAssignStudent, generateEventCSV, downloadCSV } from '../../src/utils/cloudFunctions';

// Ride Assignment Card Component
const RideAssignmentCard: React.FC<{
  ride: Ride;
  onUnassign?: (rideId: string) => void;
}> = ({ ride, onUnassign }) => {
  const driver = ride.driver;
  const passengers = ride.peers || [];

  return (
    <div className="clay-card bg-white overflow-hidden">
      {/* Driver Header */}
      <div className="flex items-center gap-4 pb-4 border-b border-cream-dark">
        <div className="relative">
          <img
            src={driver?.avatarUrl || `https://ui-avatars.com/api/?name=${driver?.name || 'Driver'}&background=FF6B35&color=fff`}
            className="w-14 h-14 rounded-2xl shadow-lg border-2 border-white"
            alt={driver?.name || 'Driver'}
          />
          <div className="absolute -bottom-1 -right-1 bg-green-500 p-1 rounded-full border-2 border-white">
            <Car size={12} className="text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-header font-bold text-coffee text-lg truncate">{driver?.name || 'Unassigned Driver'}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs bg-saffron/10 text-saffron px-2 py-0.5 rounded-full font-bold">
              {driver?.carModel || 'Vehicle'}
            </span>
            <span className="text-xs text-mocha/60">{driver?.plateNumber || ''}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded-lg">
            <Users size={14} />
            <span className="text-xs font-bold">{passengers.length + 1} / {driver?.capacity || 4}</span>
          </div>
        </div>
      </div>

      {/* Student Passenger - Main Student */}
      <div className="py-4">
        <p className="text-[10px] font-bold text-mocha/50 uppercase tracking-widest mb-3">Students in this ride</p>

        {/* Main Student */}
        <div className="flex items-center gap-3 p-3 bg-cream rounded-xl mb-2">
          <img
            src={`https://ui-avatars.com/api/?name=${ride.studentName || 'Student'}&background=6366f1&color=fff`}
            className="w-10 h-10 rounded-xl"
            alt={ride.studentName || 'Student'}
          />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-coffee text-sm truncate">{ride.studentName || 'Student'}</p>
            <p className="text-xs text-mocha/60 truncate flex items-center gap-1">
              <MapPin size={10} />
              {ride.pickupAddress}
            </p>
          </div>
          <CheckCircle2 size={18} className="text-green-500 shrink-0" />
        </div>

        {/* Additional Passengers (Peers) */}
        {passengers.map((peer, index) => (
          <div key={peer.id || index} className="flex items-center gap-3 p-3 bg-cream/50 rounded-xl mb-2">
            <img
              src={peer.avatarUrl || `https://ui-avatars.com/api/?name=${peer.name}&background=8b5cf6&color=fff`}
              className="w-10 h-10 rounded-xl"
              alt={peer.name}
            />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-coffee text-sm truncate">{peer.name}</p>
              <p className="text-xs text-mocha/60 truncate flex items-center gap-1">
                <MapPin size={10} />
                {peer.address}
              </p>
            </div>
            <CheckCircle2 size={18} className="text-green-500 shrink-0" />
          </div>
        ))}

        {passengers.length === 0 && (
          <p className="text-xs text-mocha/40 text-center py-2 italic">No additional passengers</p>
        )}
      </div>

      {/* Ride Info Footer */}
      <div className="pt-3 border-t border-cream-dark flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-mocha/60">
          <Clock size={14} />
          <span>{ride.timeSlot}</span>
        </div>
        <div className={`px-2 py-1 rounded-lg text-xs font-bold ${ride.status === 'assigned' ? 'bg-blue-50 text-blue-600' :
          ride.status === 'driver_en_route' ? 'bg-yellow-50 text-yellow-600' :
            ride.status === 'arriving' ? 'bg-orange-50 text-orange-600' :
              ride.status === 'completed' ? 'bg-green-50 text-green-600' :
                'bg-gray-50 text-gray-600'
          }`}>
          {ride.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </div>
      </div>
    </div>
  );
};

// Empty State Component
const EmptyState: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
    <div className="clay-card-inset w-24 h-24 rounded-full flex items-center justify-center mb-6">
      <CheckCircle2 size={40} className="text-saffron/60" />
    </div>
    <h3 className="font-header font-bold text-2xl text-coffee mb-2">{title}</h3>
    <p className="text-mocha/60 max-w-sm">{message}</p>
  </div>
);

export const ManagerDashboard: React.FC = () => {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'planning' | 'dropoff'>('planning');
  const [isFleetManaging, setIsFleetManaging] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  useAutoDispatch();

  const { pendingDrivers } = usePendingDrivers();
  const { requests: pendingRequests, loading: requestsLoading } = usePendingRequests();
  const { rides: activeRides } = useAllActiveRides();
  const { drivers: availableDrivers, loading: driversLoading } = useAvailableDrivers();

  const selectedEntity = pendingRequests.find(r => r.id === selectedEntityId) || availableDrivers.find(d => d.id === selectedEntityId);

  const handleAssignToAnyDriver = async (requestId: string) => {
    const available = availableDrivers.find(d => d.status === 'available');
    if (available) {
      await assignRideToDriver(requestId, available);
      setSelectedEntityId(null);
    } else {
      alert("No available drivers found to assign manually.");
    }
  };

  const handleDismiss = async (requestId: string) => {
    if (confirm("Are you sure you want to dismiss this request?")) {
      await unassignRide(requestId);
      setSelectedEntityId(null);
    }
  };

  const handleBulkAssign = async (ids: string[]) => {
    const available = availableDrivers.find(d => d.status === 'available');
    if (!available) return alert("No available drivers.");

    for (const id of ids) {
      await assignRideToDriver(id, available);
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await generateEventCSV(today);

      if (result.csvContent) {
        downloadCSV(result.csvContent, `sabha_attendance_${today}.csv`);
        alert(`Export successful! Total students: ${result.summary.totalStudents}`);
      } else {
        alert("No data available for export.");
      }
    } catch (error: any) {
      console.error('Error exporting CSV:', error);
      alert(error.message || 'Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  // Handle manual assignment using Cloud Function
  const handleManualAssign = async (studentId: string, driverId: string) => {
    try {
      const result = await manualAssignStudent(studentId, driverId);
      alert(`Student assigned successfully! Total students in ride: ${result.updatedStats.totalStudents}`);
      setSelectedEntityId(null);
    } catch (error: any) {
      console.error('Error manually assigning student:', error);
      alert(error.message || 'Failed to assign student');
    }
  };

  const handleApproveDriver = async (driverId: string) => {
    try {
      await updateUserStatus(driverId, 'approved');
      alert('Driver approved successfully!');
    } catch (error) {
      console.error('Error approving driver:', error);
      alert('Failed to approve driver. Please try again.');
    }
  };

  const handleDenyDriver = async (driverId: string) => {
    if (confirm('Are you sure you want to deny this driver?')) {
      try {
        await updateUserStatus(driverId, 'rejected');
        alert('Driver denied.');
      } catch (error) {
        console.error('Error denying driver:', error);
        alert('Failed to deny driver. Please try again.');
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 relative overflow-hidden">
      {/* Top Control Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex justify-between items-center shadow-sm z-20 shrink-0 pt-safe lg:pt-2">
        <div className="flex items-center gap-3">
          <div className="bg-gray-100 p-1 rounded-lg flex shrink-0">
            <button
              onClick={() => setActiveTab('planning')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'planning' ? 'bg-white text-coffee shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Request Center
            </button>
            <button
              onClick={() => setActiveTab('dropoff')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'dropoff' ? 'bg-white text-coffee shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Live Operations
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border border-transparent hover:border-gray-200 disabled:opacity-50"
            title="Export CSV"
          >
            {isExporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
          </button>

          <button
            onClick={() => setShowNotifications(true)}
            className={`p-2 rounded-lg relative transition-colors ${showNotifications ? 'bg-orange-100 text-saffron' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Notifications"
          >
            <Bell size={20} />
            {pendingDrivers.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border border-white animate-pulse"></span>}
          </button>

          <div className="h-6 w-px bg-gray-200 mx-1 hidden sm:block"></div>

          <button onClick={() => setIsFleetManaging(true)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg flex items-center gap-2 transition-colors">
            <Car size={18} />
            <span className="text-xs font-bold hidden sm:inline">Fleet</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'planning' ? (
          /* Request Center View - seamless full table */
          <div className="h-full w-full flex flex-col">
            <RequestTable
              requests={pendingRequests}
              loading={requestsLoading}
              onAssign={handleAssignToAnyDriver}
              onDismiss={handleDismiss}
              onBulkAssign={handleBulkAssign}
            />
          </div>
        ) : (
          /* Live Operations View */
          <div className="h-full overflow-y-auto p-4 sm:p-6">
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="font-header font-bold text-2xl text-coffee">Active Rides</h2>
                  <p className="text-gray-500 text-sm">Real-time status of assigned rides</p>
                </div>
                <div className="bg-white border border-green-200 text-green-700 inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest">Auto-Dispatch Active</span>
                </div>
              </div>

              {activeRides.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {activeRides.map(ride => (
                    <RideAssignmentCard key={ride.id} ride={ride} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="All Caught Up!"
                  message="Every student has been assigned a ride for this week's sabha."
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fleet Bottom Panel - Integrated Bar */}
      <div className="bg-white border-t border-gray-200 flex-shrink-0 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Fleet Status</span>
          </div>
          <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-md">
            {availableDrivers.filter(d => d.status === 'available').length}/{availableDrivers.length} Online
          </span>
        </div>
        <div className="h-16 flex overflow-x-auto items-center px-4 gap-3 scrollbar-hide bg-white/50">
          {driversLoading ? (
            <span className="text-xs text-gray-400 pl-2">Loading fleet...</span>
          ) : availableDrivers.length === 0 ? (
            <span className="text-xs text-gray-400 pl-2 italic">No drivers online</span>
          ) : (
            availableDrivers.map(driver => (
              <div
                key={driver.id}
                onClick={() => setSelectedEntityId(driver.id)}
                className={`flex items-center gap-2 shrink-0 cursor-pointer rounded-lg border transition-all ${selectedEntityId === driver.id
                  ? 'bg-orange-50 border-saffron shadow-sm'
                  : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  } px-2 py-1.5 min-w-[140px]`}
              >
                <div className="relative shrink-0">
                  <img
                    src={driver.avatarUrl || `https://ui-avatars.com/api/?name=${driver.name}&background=FF6B35&color=fff`}
                    className="w-8 h-8 rounded-full border border-gray-100"
                    alt=""
                  />
                  <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${driver.status === 'available' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-xs text-gray-700 truncate">{driver.name}</p>
                  <p className="text-[10px] text-gray-400 capitalize truncate">{driver.carModel || 'No Vehicle'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {isFleetManaging && <FleetManagement onClose={() => setIsFleetManaging(false)} />}

      {showNotifications && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end" onClick={() => setShowNotifications(false)}>
          <div className="w-full max-w-sm bg-white h-full shadow-2xl animate-in slide-in-from-right flex flex-col pt-safe" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-cream">
              <h3 className="font-header font-bold text-coffee flex items-center gap-2">
                Notifications
                {pendingDrivers.length > 0 && (
                  <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                    {pendingDrivers.length}
                  </span>
                )}
              </h3>
              <button onClick={() => setShowNotifications(false)} className="p-2 text-gray-400"><X size={24} /></button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {pendingDrivers.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-10">All clear for now</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                    Pending Rider Approvals ({pendingDrivers.length})
                  </p>
                  {pendingDrivers.map((driver) => (
                    <div key={driver.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                      <div className="flex items-center gap-3 mb-3">
                        <img
                          src={driver.avatarUrl || `https://ui-avatars.com/api/?name=${driver.name}&background=FF6B35&color=fff`}
                          className="w-12 h-12 rounded-xl"
                          alt={driver.name}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-coffee text-sm truncate">{driver.name}</h4>
                          <p className="text-xs text-gray-500 truncate">{driver.email}</p>
                          <p className="text-xs text-gray-400 truncate">{driver.phone}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveDriver(driver.id)}
                          className="flex-1 bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                          <CheckCircle2 size={14} />
                          Approve
                        </button>
                        <button
                          onClick={() => handleDenyDriver(driver.id)}
                          className="flex-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                          <X size={14} />
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};