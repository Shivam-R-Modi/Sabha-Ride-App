import React, { useState } from 'react';
import { RequestTable } from './RequestTable';
import { FleetManagement } from './FleetManagement';
import { LocationSettings } from './LocationSettings';
import {
  Bell,
  Car,
  X,
  Users,
  Phone,
  MapPin,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  Navigation,
  Download,
  UserMinus,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePendingDrivers, updateUserStatus, useAutoDispatch, usePendingRequests, useAllActiveRides, assignRideToDriver, unassignRide, useAvailableDrivers, useWeeklyAttendanceCount, downloadAttendanceCSV, returnStudentToPool, releaseVehicle, setDriverAvailability } from '../../hooks/useFirestore';
import { Driver, Ride, StudentRequest } from '../../types';
import { manualAssignStudent } from '../../src/utils/cloudFunctions';
import { VENUE_ADDRESS } from '../../constants';

// Grouped Ride Card Component
const RideAssignmentCard: React.FC<{
  driver: Driver;
  rides: Ride[];
  onUnassign?: (rideId: string) => void;
  onRelease?: (driverId: string, rideIds: string[]) => void;
}> = ({ driver, rides, onUnassign, onRelease }) => {
  return (
    <div className="clay-card bg-white overflow-hidden flex flex-col h-full">
      {/* Driver Header */}
      <div className="p-4 bg-gradient-to-br from-cream to-white border-b border-cream-dark flex items-center gap-4">
        <div className="relative">
          <img
            src={driver?.avatarUrl || `https://ui-avatars.com/api/?name=${driver?.name || 'Driver'}&background=FF6B35&color=fff`}
            className="w-12 h-12 rounded-xl shadow-md border-2 border-white"
            alt={driver?.name || 'Driver'}
          />
          <div className="absolute -bottom-1 -right-1 bg-green-500 p-1 rounded-full border-2 border-white">
            <Car size={10} className="text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-header font-bold text-coffee text-lg truncate">{driver?.name || 'Unassigned Driver'}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs bg-saffron/10 text-saffron px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
              {driver?.carModel || driver?.currentVehicleName || 'Vehicle'}
            </span>
            <span className="text-xs text-mocha/60 bg-cream px-2 py-0.5 rounded-full font-medium">
              {driver?.plateNumber || driver?.currentVehiclePlate || 'No Plate'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Call Driver */}
          <a href={`tel:${driver?.phone || ''}`} className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors shadow-sm" title="Call Driver">
            <Phone size={18} />
          </a>
          {/* Release Driver */}
          {onRelease && (
            <button
              onClick={() => onRelease(driver.id, rides.map(r => r.id))}
              className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors shadow-sm"
              title="Release Driver & Unassign Students"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Student List */}
      <div className="flex-1 divide-y divide-cream-dark overflow-y-auto max-h-[400px]">
        {rides.map((ride, index) => (
          <div key={ride.id} className="p-3 hover:bg-cream/30 transition-colors">
            {/* Row 1: Name + Actions */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-6 h-6 rounded-full bg-saffron/20 text-saffron flex items-center justify-center text-xs font-bold shrink-0">
                  {index + 1}
                </div>
                <span className="font-bold text-coffee truncate">{ride.studentName || 'Student'}</span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Call Button */}
                {ride.studentName && (
                  <a href={`tel:${ride.studentName /* Phone TODO */}`} className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors" title="Call Student">
                    <Phone size={14} />
                  </a>
                )}
                {/* Navigation */}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ride.pickupAddress || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Navigate to Student"
                >
                  <Navigation size={14} />
                </a>
                {/* Unassign */}
                {onUnassign && (
                  <button
                    onClick={() => onUnassign(ride.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    title="Unassign Student"
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Address */}
            <div className="pl-8 text-xs text-mocha/70 truncate flex items-center gap-1">
              <MapPin size={10} className="shrink-0" />
              {ride.pickupAddress || 'No address provided'}
            </div>
          </div>
        ))}

        {rides.length === 0 && (
          <div className="p-6 text-center text-mocha/40 text-sm italic">
            No students assigned yet.
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="bg-cream/50 p-2 border-t border-cream-dark flex justify-between items-center text-xs text-mocha/60">
        <div className="flex items-center gap-1">
          <Users size={12} />
          <span>{rides.length} Passengers</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={12} />
          <span>{rides[0]?.timeSlot || 'Scheduled'}</span>
        </div>
      </div>
    </div >
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
  const { currentUser, userProfile, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'planning' | 'dropoff'>('planning');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFleetManagement, setShowFleetManagement] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Release modal state
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [pendingReleaseDriver, setPendingReleaseDriver] = useState<{ driverId: string; rideIds: string[]; driver: Driver | null } | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);

  useAutoDispatch();

  const { pendingDrivers } = usePendingDrivers();
  const { requests: pendingRequests, loading: requestsLoading } = usePendingRequests();
  const { rides: activeRides } = useAllActiveRides();
  const { drivers: availableDrivers, loading: driversLoading } = useAvailableDrivers();

  // Group active rides by driver
  const groupedRides = React.useMemo(() => {
    const groups: Record<string, { driver: Driver, rides: Ride[] }> = {};

    activeRides.forEach(ride => {
      // Correctly access the ID from the nested driver object or the top level
      const driverIdFromRide = ride.driver?.id || ride.driverId;
      if (!driverIdFromRide) return;

      if (!groups[driverIdFromRide]) {
        // Use existing driver structure from ride, or construct basic info
        const driver = ride.driver || {
          id: driverIdFromRide,
          name: ride.driverName || 'Unknown Driver',
          userId: driverIdFromRide,
          // fill other required Driver fields
          status: 'assigned',
          currentLocation: null,
          homeLocation: null,
          ridesCompletedToday: 0,
          totalStudentsToday: 0,
          totalDistanceToday: 0,
          currentVehicleId: ride.carId,
          currentVehicleName: ride.carModel,
          currentVehiclePlate: ride.carLicensePlate,
          carModel: ride.carModel,
          plateNumber: ride.carLicensePlate
        } as Driver;

        groups[driverIdFromRide] = {
          driver,
          rides: []
        };
      }
      groups[driverIdFromRide].rides.push(ride);
    });

    return Object.values(groups);
  }, [activeRides]);

  // Weekly attendance count for download badge
  const { yesCount: attendanceYesCount, loading: attendanceCountLoading } = useWeeklyAttendanceCount();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadAttendance = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadAttendanceCSV();
    } catch (error) {
      console.error('Error downloading attendance:', error);
      alert('Failed to download attendance CSV');
    } finally {
      setIsDownloading(false);
    }
  };

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
      // Pass manager info so student can see who dismissed their request
      await unassignRide(requestId, {
        managerId: currentUser?.uid || '',
        managerName: userProfile?.name || 'Manager',
        managerPhone: userProfile?.phone || ''
      });
    }
  };

  // Open the release choice modal
  const handleReleaseDriver = (driverId: string, rideIds: string[]) => {
    // Find the driver object from groupedRides
    const driverGroup = groupedRides.find(g => g.driver.id === driverId);
    setPendingReleaseDriver({
      driverId,
      rideIds,
      driver: driverGroup?.driver || null
    });
    setShowReleaseModal(true);
  };

  // Soft Release: Clear students but keep driver online and in their car
  const handleSoftRelease = async () => {
    if (!pendingReleaseDriver) return;
    setReleaseLoading(true);
    try {
      // Only return students to pool, don't touch driver status
      await Promise.all(pendingReleaseDriver.rideIds.map(id => returnStudentToPool(id)));
      setShowReleaseModal(false);
      setPendingReleaseDriver(null);
    } catch (error) {
      console.error("Failed to clear students:", error);
      alert("Failed to clear students. Please try again.");
    } finally {
      setReleaseLoading(false);
    }
  };

  // Hard Release: Clear students AND set driver offline + release their vehicle
  const handleHardRelease = async () => {
    if (!pendingReleaseDriver) return;
    setReleaseLoading(true);
    try {
      // 1. Return all students to pool
      await Promise.all(pendingReleaseDriver.rideIds.map(id => returnStudentToPool(id)));

      // 2. Release the driver's vehicle and set them offline
      const driver = pendingReleaseDriver.driver;
      if (driver?.currentVehicleId) {
        await releaseVehicle(driver.currentVehicleId, driver.id);
      } else {
        // If no vehicle, just set them offline
        await setDriverAvailability(driver?.id || pendingReleaseDriver.driverId, 'offline');
      }

      setShowReleaseModal(false);
      setPendingReleaseDriver(null);
    } catch (error) {
      console.error("Failed to fully release driver:", error);
      alert("Failed to fully release driver. Please try again.");
    } finally {
      setReleaseLoading(false);
    }
  };


  const handleBulkAssign = async (ids: string[]) => {
    const available = availableDrivers.find(d => d.status === 'available');
    if (!available) return alert("No available drivers.");

    for (const id of ids) {
      await assignRideToDriver(id, available);
    }
    alert(`Assigned ${ids.length} requests to ${available.name}`);
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
            onClick={() => setShowFleetManagement(true)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border border-transparent hover:border-gray-200"
            title="Fleet Management"
          >
            <Car size={20} />
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border border-transparent hover:border-gray-200"
            title="Settings"
          >
            <MapPin size={20} />
          </button>

          {/* Weekly Attendance Download Button */}
          <button
            onClick={handleDownloadAttendance}
            disabled={isDownloading}
            className={`p-2 rounded-lg relative transition-colors ${isDownloading ? 'bg-gray-100 cursor-wait' : 'text-gray-500 hover:bg-gray-100'} border border-transparent hover:border-gray-200`}
            title="Download Weekly Attendance CSV"
          >
            <Download size={20} className={isDownloading ? 'animate-pulse' : ''} />
            {!attendanceCountLoading && attendanceYesCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold">
                {attendanceYesCount > 99 ? '99+' : attendanceYesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowNotifications(true)}
            className={`p-2 rounded-lg relative transition-colors ${showNotifications ? 'bg-orange-100 text-saffron' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Notifications"
          >
            <Bell size={20} />
            {(pendingDrivers.length > 0 || pendingRequests.length > 0) && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold animate-pulse">
                {pendingDrivers.length + pendingRequests.length}
              </span>
            )}
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

              {groupedRides.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {groupedRides.map(group => (
                    <RideAssignmentCard
                      key={group.driver.id}
                      driver={group.driver}
                      rides={group.rides}
                      onUnassign={async (rideId) => {
                        try {
                          await returnStudentToPool(rideId);
                        } catch (error) {
                          console.error('Failed to unassign:', error);
                          alert('Failed to unassign student');
                        }
                      }}
                      onRelease={handleReleaseDriver}
                    />
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

      {/* Notifications Panel */}
      {showNotifications && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white sm:rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h3 className="font-header font-bold text-lg text-coffee">
                Pending Approvals
              </h3>
              <button
                onClick={() => setShowNotifications(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto max-h-[calc(80vh-80px)] p-4 space-y-4">
              {/* Pending Drivers Section */}
              {pendingDrivers.length > 0 && (
                <>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Driver Approvals ({pendingDrivers.length})
                  </h4>
                  {pendingDrivers.map((driver) => (
                    <div key={driver.id} className="flex items-center gap-4 p-4 bg-cream rounded-xl border border-mocha/10">
                      <img
                        src={driver.avatarUrl || `https://ui-avatars.com/api/?name=${driver.name}&background=random`}
                        alt={driver.name}
                        className="w-12 h-12 rounded-xl"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-coffee">{driver.name}</h4>
                        <p className="text-sm text-mocha/60 truncate">{driver.phone || 'No phone'}</p>
                        <p className="text-xs text-mocha/40 mt-1">
                          {driver.carModel || 'No vehicle'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDenyDriver(driver.id)}
                          className="flex items-center gap-1 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50 transition-colors"
                        >
                          <X size={14} />
                          Deny
                        </button>
                        <button
                          onClick={() => handleApproveDriver(driver.id)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
                        >
                          <CheckCircle2 size={14} />
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Pending Student Requests Section */}
              {pendingRequests.length > 0 && (
                <>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Ride Requests ({pendingRequests.length})
                  </h4>
                  {pendingRequests.map((request) => (
                    <div key={request.id} className="flex items-center gap-4 p-4 bg-cream rounded-xl border border-mocha/10">
                      <img
                        src={request.avatarUrl || `https://ui-avatars.com/api/?name=${request.name}&background=random`}
                        alt={request.name}
                        className="w-12 h-12 rounded-xl"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-coffee">{request.name}</h4>
                        <p className="text-sm text-mocha/60 truncate">{request.address || 'Loading...'}</p>
                        <p className="text-xs text-mocha/40 mt-1 flex items-center gap-1">
                          <Clock size={12} />
                          {request.requestedTimeSlot || 'Time TBD'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDismiss(request.id)}
                          className="flex items-center gap-1 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50 transition-colors"
                        >
                          <X size={14} />
                          Dismiss
                        </button>
                        <button
                          onClick={() => handleAssignToAnyDriver(request.id)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-saffron text-white rounded-lg text-xs font-semibold hover:bg-saffron/90 transition-colors"
                        >
                          <Car size={14} />
                          Assign
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Empty State */}
              {pendingDrivers.length === 0 && pendingRequests.length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
                  <p className="text-mocha/60">No pending approvals</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fleet Management Modal */}
      {showFleetManagement && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-in zoom-in duration-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="font-header font-bold text-xl text-coffee">Fleet Management</h2>
              <button
                onClick={() => setShowFleetManagement(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
              <FleetManagement />
            </div>
          </div>
        </div>
      )}

      {/* Location Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden animate-in zoom-in duration-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="font-header font-bold text-xl text-coffee">Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-4">
              <LocationSettings />
            </div>
          </div>
        </div>
      )}

      {/* Release Driver Choice Modal */}
      {showReleaseModal && pendingReleaseDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-header font-bold text-xl text-coffee">Release Driver</h2>
                <button
                  onClick={() => {
                    setShowReleaseModal(false);
                    setPendingReleaseDriver(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  disabled={releaseLoading}
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              <p className="text-mocha/70 mb-6">
                Choose how to release <span className="font-bold text-coffee">{pendingReleaseDriver.driver?.name || 'this driver'}</span>:
              </p>

              <div className="space-y-3">
                {/* Soft Release Option */}
                <button
                  onClick={handleSoftRelease}
                  disabled={releaseLoading}
                  className="w-full p-4 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-xl text-left transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Users size={20} className="text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-blue-900">Clear Students (Keep Online)</h3>
                      <p className="text-sm text-blue-700/70">Returns students to pool. Driver stays available for new assignments.</p>
                    </div>
                  </div>
                </button>

                {/* Hard Release Option */}
                <button
                  onClick={handleHardRelease}
                  disabled={releaseLoading}
                  className="w-full p-4 bg-red-50 hover:bg-red-100 border-2 border-red-200 rounded-xl text-left transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-lg">
                      <LogOut size={20} className="text-red-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-red-900">Full Checkout (Go Offline)</h3>
                      <p className="text-sm text-red-700/70">Returns students, releases vehicle, sets driver offline.</p>
                    </div>
                  </div>
                </button>
              </div>

              {releaseLoading && (
                <div className="flex items-center justify-center gap-2 mt-4 text-mocha/60">
                  <div className="animate-spin w-4 h-4 border-2 border-saffron border-t-transparent rounded-full"></div>
                  <span className="text-sm">Processing...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
