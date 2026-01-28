import React, { useState } from 'react';
import { MOCK_ALL_DRIVERS } from '../../constants';
import { FleetManagement } from './FleetManagement';
import { RequestTable } from './RequestTable';
import { ResponsiveMap } from './ResponsiveMap';
import { BottomSheet } from '../shared/BottomSheet';
import { 
  Bell, 
  Car, 
  LogOut, 
  X, 
  Download, 
  Map as MapIcon, 
  List, 
  LayoutGrid, 
  UserPlus, 
  Phone, 
  MapPin, 
  Clock 
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePendingDrivers, updateUserStatus, useAutoDispatch, usePendingRequests, useAllActiveRides, assignRideToDriver, unassignRide } from '../../hooks/useFirestore';
import { Driver, Ride, StudentRequest } from '../../types';

export const ManagerDashboard: React.FC = () => {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'planning' | 'dropoff'>('planning');
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [isFleetManaging, setIsFleetManaging] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);

  useAutoDispatch();

  const { pendingDrivers } = usePendingDrivers();
  const { requests: pendingRequests, loading: requestsLoading } = usePendingRequests();
  const { rides: activeRides } = useAllActiveRides();

  const selectedEntity = pendingRequests.find(r => r.id === selectedEntityId) || MOCK_ALL_DRIVERS.find(d => d.id === selectedEntityId);

  const handleMarkerClick = (id: string) => {
    setSelectedEntityId(id);
    if (window.innerWidth < 1024) {
      // Logic for mobile bottom sheet snap handled by component being open
    }
  };

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

        {/* Main Workspace */}
        <div className="flex-1 flex overflow-hidden relative">
            <div className={`flex flex-col h-full bg-white transition-all duration-300 w-full lg:w-[60%] border-r border-gray-200 ${mobileView === 'map' ? 'hidden lg:flex' : 'flex'}`}>
                <RequestTable 
                    requests={pendingRequests}
                    loading={requestsLoading}
                    onAssign={handleAssignToAnyDriver}
                    onDismiss={handleDismiss}
                    onBulkAssign={handleBulkAssign}
                />
            </div>

            {/* Map Canvas */}
            <div className={`flex-1 bg-gray-50 relative p-4 transition-all ${mobileView === 'list' ? 'hidden lg:block' : 'block'}`}>
                <ResponsiveMap 
                    students={pendingRequests} 
                    drivers={MOCK_ALL_DRIVERS} 
                    selectedStudentId={selectedEntityId}
                    onMarkerClick={handleMarkerClick}
                    isFullscreen={isMapFullscreen}
                    onToggleFullscreen={() => setIsMapFullscreen(!isMapFullscreen)}
                />
                
                {/* Auto Dispatch Badge */}
                {!isMapFullscreen && (
                  <div className="absolute top-8 left-8 pointer-events-none hidden sm:block">
                      <div className="inline-flex items-center gap-2 px-3 py-2 bg-white/95 backdrop-blur-sm text-green-700 rounded-2xl shadow-xl border border-green-100">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-widest">Auto-Dispatch Active</span>
                      </div>
                  </div>
                )}

                {/* Mobile View Toggle */}
                <button 
                    onClick={() => setMobileView(mobileView === 'list' ? 'map' : 'list')}
                    className="lg:hidden absolute bottom-24 right-6 w-14 h-14 bg-coffee text-white rounded-full shadow-2xl flex items-center justify-center btn-feedback z-30"
                >
                    {mobileView === 'list' ? <MapIcon size={24} /> : <List size={24} />}
                </button>
            </div>
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
                    className="flex-1 bg-white border border-gray-200 py-4 rounded-2xl flex items-center justify-center gap-2 text-coffee font-bold btn-feedback shadow-sm"
                  >
                    <Phone size={18} /> Call
                  </a>
                  <button 
                    onClick={() => handleAssignToAnyDriver(selectedEntity.id)}
                    className="flex-[2] bg-saffron text-white py-4 rounded-2xl flex items-center justify-center gap-2 font-bold shadow-lg shadow-orange-100 btn-feedback"
                  >
                    <UserPlus size={18} /> Quick Assign
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
                    onClick={() => handleMarkerClick(driver.id)}
                    className={`min-w-[200px] p-3 rounded-xl border transition-all flex items-center gap-3 shrink-0 cursor-pointer ${selectedEntityId === driver.id ? 'bg-orange-50 border-saffron shadow-md' : 'bg-white border-gray-100 hover:border-orange-200 shadow-sm'}`}
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