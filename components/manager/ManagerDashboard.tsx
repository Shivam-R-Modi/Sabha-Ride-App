import React, { useState } from 'react';
import { MOCK_ALL_DRIVERS } from '../../constants';
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
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePendingDrivers, updateUserStatus, useAutoDispatch, usePendingRequests, useAllActiveRides, assignRideToDriver, unassignRide } from '../../hooks/useFirestore';
import { Driver, Ride, StudentRequest } from '../../types';

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

  const selectedEntity = pendingRequests.find(r => r.id === selectedEntityId) || MOCK_ALL_DRIVERS.find(d => d.id === selectedEntityId);

  const handleAssignToAnyDriver = async (requestId: string) => {
    const available = MOCK_ALL_DRIVERS.find(d => d.status === 'available');
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
    const available = MOCK_ALL_DRIVERS.find(d => d.status === 'available');
    if (!available) return alert("No available drivers.");

    for (const id of ids) {
      await assignRideToDriver(id, available);
    }
  };

  const handleExport = () => {
    const allStudents = [
      ...pendingRequests.map(r => ({ name: r.name, address: r.address, status: 'Pending', driver: 'Unassigned', time: r.requestedTimeSlot })),
      ...activeRides.map(r => ({ name: r.studentName || 'Student', address: r.pickupAddress, status: r.status, driver: r.driver?.name || 'Unassigned', time: r.timeSlot }))
    ];

    if (allStudents.length === 0) return alert("No student data to export.");

    const headers = ["Student Name", "Status", "Assigned Driver", "Pickup Address", "Time Slot"];
    const csvContent = [headers.join(","), ...allStudents.map(s => `"${s.name}","${s.status}","${s.driver}","${s.address}","${s.time}"`)].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `sabha_attendance_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-screen flex flex-col bg-cream relative overflow-hidden">
      {/* Top Control Bar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-2 sm:py-3 flex justify-between items-center shadow-sm z-20 shrink-0 pt-safe lg:pt-3">
        <div className="flex items-center gap-3">
          <div className="bg-gray-100 p-1 rounded-xl flex shrink-0">
            <button
              onClick={() => setActiveTab('planning')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all btn-feedback ${activeTab === 'planning' ? 'bg-white text-coffee shadow-sm' : 'text-gray-400'}`}
            >
              <span className="hidden sm:inline">Request Center</span>
              <span className="sm:hidden">Requests</span>
            </button>
            <button
              onClick={() => setActiveTab('dropoff')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all btn-feedback ${activeTab === 'dropoff' ? 'bg-white text-coffee shadow-sm' : 'text-gray-400'}`}
            >
              <span className="hidden sm:inline">Live Operations</span>
              <span className="sm:hidden">Operations</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button onClick={handleExport} className="p-2.5 text-saffron hover:bg-orange-50 rounded-xl transition-colors btn-feedback sm:border border-orange-100">
            <Download size={18} />
          </button>

          <button
            onClick={() => setShowNotifications(true)}
            className={`p-2.5 rounded-xl relative transition-colors btn-feedback ${showNotifications ? 'bg-orange-100 text-saffron' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <Bell size={20} />
            {pendingDrivers.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white animate-pulse"></span>}
          </button>

          <div className="h-6 w-px bg-gray-100 mx-1 hidden sm:block"></div>

          <button onClick={() => setIsFleetManaging(true)} className="p-2.5 text-gray-500 hover:bg-gray-100 rounded-xl btn-feedback hidden sm:flex items-center gap-2">
            <Car size={18} />
            <span className="text-xs font-bold">Fleet</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {activeTab === 'planning' ? (
          /* Request Center View */
          <div className="max-w-4xl mx-auto">
            <RequestTable
              requests={pendingRequests}
              loading={requestsLoading}
              onAssign={handleAssignToAnyDriver}
              onDismiss={handleDismiss}
              onBulkAssign={handleBulkAssign}
            />
          </div>
        ) : (
          /* Live Operations View - Ride Assignment Cards */
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-header font-bold text-2xl text-coffee">Active Rides</h2>
                <p className="text-mocha/60 text-sm">Students assigned to drivers</p>
              </div>
              <div className="clay-badge inline-flex items-center gap-2 px-3 py-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest">Auto-Dispatch Active</span>
              </div>
            </div>

            {activeRides.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {activeRides.map(ride => (
                  <RideAssignmentCard key={ride.id} ride={ride} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="All Caught Up!"
                message="Every student has been assigned a ride for this week's sabha. Great job coordination!"
              />
            )}
          </div>
        )}
      </div>

      {/* Mobile Detail Sheet */}
      <BottomSheet isOpen={!!selectedEntityId} onClose={() => setSelectedEntityId(null)}>
        {selectedEntity && (
          <div className="py-2">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <img src={selectedEntity.avatarUrl} className="w-14 h-14 rounded-2xl shadow-lg" alt="" />
                <div>
                  <h3 className="font-header font-bold text-coffee text-lg">{selectedEntity.name}</h3>
                  <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">{selectedEntity.role}</p>
                </div>
              </div>
              <button onClick={() => setSelectedEntityId(null)} className="p-2 text-gray-400"><X size={24} /></button>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3 bg-gray-50 p-4 rounded-2xl">
                <MapPin className="text-saffron mt-1" size={18} />
                <p className="text-sm text-gray-600 leading-relaxed">{selectedEntity.address}</p>
              </div>
              <div className="flex items-center gap-3 bg-gray-50 p-4 rounded-2xl">
                <Clock className="text-gray-400" size={18} />
                <p className="text-sm text-gray-600">Requested for: 5:30 PM</p>
              </div>
            </div>

            <div className="flex gap-4">
              <a
                href={`tel:${selectedEntity.phone}`}
                className="clay-button-secondary flex-1"
              >
                <Phone size={18} /> Call
              </a>
              <button
                onClick={() => handleAssignToAnyDriver(selectedEntity.id)}
                className="clay-button-primary flex-[2]"
              >
                <User size={18} /> Quick Assign
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Fleet Bottom Panel (Desktop only) */}
      <div className="h-28 bg-white border-t border-gray-200 hidden lg:flex flex-col">
        <div className="px-4 py-1.5 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sevak Fleet Status</span>
          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 rounded">6/8 Online</span>
        </div>
        <div className="flex-1 flex overflow-x-auto items-center px-4 gap-3 scrollbar-hide">
          {MOCK_ALL_DRIVERS.map(driver => (
            <div
              key={driver.id}
              onClick={() => setSelectedEntityId(driver.id)}
              className={`clay-card min-w-[200px] flex items-center gap-3 shrink-0 cursor-pointer ${selectedEntityId === driver.id ? 'bg-orange-50 border-saffron shadow-md' : ''}`}
            >
              <div className="relative shrink-0">
                <img src={driver.avatarUrl} className="w-9 h-9 rounded-full" alt="" />
                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${driver.status === 'available' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
              </div>
              <div className="min-w-0">
                <p className="font-bold text-xs text-coffee truncate">{driver.name}</p>
                <p className="text-[10px] text-gray-400 capitalize">{driver.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isFleetManaging && <FleetManagement onClose={() => setIsFleetManaging(false)} />}

      {showNotifications && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end" onClick={() => setShowNotifications(false)}>
          <div className="w-full max-w-sm bg-white h-full shadow-2xl animate-in slide-in-from-right flex flex-col pt-safe" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-cream">
              <h3 className="font-header font-bold text-coffee flex items-center gap-2">Notifications</h3>
              <button onClick={() => setShowNotifications(false)} className="p-2 text-gray-400"><X size={24} /></button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <p className="text-xs text-gray-400 text-center py-10">All clear for now</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};