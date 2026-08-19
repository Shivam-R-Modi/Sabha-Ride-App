import React, { useState } from 'react';
import { RequestTable } from './RequestTable';
import { Car, X, Users, Phone, MapPin, Clock, CheckCircle2, Navigation, UserMinus, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAutoDispatch, usePendingRequests, useAllActiveRides, assignRideToDriver, unassignRide, useAvailableDrivers, returnStudentToPool, setDriverAvailability } from '../../hooks/useFirestore';
import { Driver, Ride } from '../../types';
import { useConfirm } from '../shared/useConfirm';
import { useToast } from '../../contexts/ToastContext';
import { seatsOnRide } from '../../src/constants/seats';
import { managerReleaseVehicle } from '../../src/utils/cloudFunctions';
import { DriverPicker } from './DriverPicker';

// Grouped Ride Card Component
const RideAssignmentCard: React.FC<{
  driver: Driver;
  rides: Ride[];
  onUnassign?: (rideId: string) => void;
  onRelease?: (driverId: string, rideIds: string[]) => void;
}> = ({ driver, rides, onUnassign, onRelease }) => {
  // People this driver is carrying, across all their ride documents.
  const ridePassengers = rides.reduce((n, r) => n + seatsOnRide(r), 0);
  return (
    <div className="clay-card bg-surface overflow-hidden flex flex-col h-full">
      {/* Driver Header */}
      <div className="p-4 bg-gradient-to-br from-cream to-surface border-b border-hairline/10 flex items-center gap-4">
        <div className="relative">
          <img
            src={driver?.avatarUrl || `https://ui-avatars.com/api/?name=${driver?.name || 'Sarthi'}&background=FF6B35&color=fff`}
            className="w-12 h-12 rounded-xl shadow-md border-2 border-surface"
            alt={driver?.name || 'Sarthi'}
          />
          <div className="absolute -bottom-1 -right-1 bg-[rgb(var(--success-fill))] p-1 rounded-full border-2 border-surface">
            <Car size={10} className="text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-header font-bold text-coffee text-lg truncate">{driver?.name || 'Unassigned Sarthi'}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs bg-saffron/10 text-saffron-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
              {driver?.carModel || driver?.currentVehicleName || 'Vehicle'}
            </span>
            <span className="text-xs text-coffee-500 bg-cream px-2 py-0.5 rounded-full font-medium">
              {driver?.plateNumber || driver?.currentVehiclePlate || 'No Plate'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Call Driver */}
          <a href={`tel:${driver?.phone || ''}`} className="p-2 bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))] rounded-lg hover:opacity-90 transition-colors shadow-sm" title="Call Sarthi">
            <Phone size={18} />
          </a>
          {/* Release Driver */}
          {onRelease && (
            <button
              onClick={() => onRelease(driver.id, rides.map(r => r.id))}
              className="p-2 bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] rounded-lg hover:opacity-90 transition-colors shadow-sm"
              title="Release Sarthi & Unassign Bhulka"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Student List */}
      <div className="flex-1 divide-y divide-hairline/10 overflow-y-auto max-h-[400px]">
        {rides.map((ride, index) => (
          <div key={ride.id} className="p-3 hover:bg-cream/30 transition-colors">
            {/* Row 1: Name + Actions */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-6 h-6 rounded-full bg-saffron/20 text-saffron-800 flex items-center justify-center text-xs font-bold shrink-0">
                  {index + 1}
                </div>
                <span className="font-bold text-coffee truncate">{ride.studentName || 'Bhulku'}</span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Call Button */}
                {(ride.studentPhone || (ride as any).phone || (ride as any).studentContact) ? (
                  <a href={`tel:${ride.studentPhone || (ride as any).phone || (ride as any).studentContact}`} className="p-1.5 text-[rgb(var(--success-text))] hover:bg-[rgb(var(--success-bg))] rounded-md transition-colors" title="Call Bhulku">
                    <Phone size={14} />
                  </a>
                ) : (
                  <span className="p-1.5 text-coffee-400" title="No phone number">
                    <Phone size={14} />
                  </span>
                )}
                {/* Navigation */}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ride.pickupAddress || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-[rgb(var(--info-text))] hover:bg-[rgb(var(--info-bg))] rounded-md transition-colors"
                  title="Navigate to Bhulku"
                >
                  <Navigation size={14} />
                </a>
                {/* Unassign */}
                {onUnassign && (
                  <button
                    onClick={() => onUnassign(ride.id)}
                    className="p-1.5 text-[rgb(var(--danger-text))] hover:bg-[rgb(var(--danger-bg))] rounded-md transition-colors"
                    title="Unassign Bhulku"
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Address */}
            <div className="pl-8 text-xs text-coffee-700 truncate flex items-center gap-1">
              <MapPin size={10} className="shrink-0" />
              {ride.pickupAddress || 'No address provided'}
            </div>
          </div>
        ))}

        {rides.length === 0 && (
          <div className="p-6 text-center text-coffee-500 text-sm italic">
            No students assigned yet.
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="bg-cream/50 p-2 border-t border-hairline/10 flex justify-between items-center text-xs text-coffee-500">
        <div className="flex items-center gap-1">
          <Users size={12} />
          {/* Seats, not ride documents. This read `rides.length`, so a driver
              carrying one family of four showed "1 Passengers" — the count of
              rows, which is the same head-count-as-seat-count mistake the seat
              work removed everywhere else. */}
          <span>{ridePassengers} {ridePassengers === 1 ? 'Passenger' : 'Passengers'}</span>
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
    <p className="text-coffee-500 max-w-sm">{message}</p>
  </div>
);

export const ManagerDashboard: React.FC = () => {
  const { currentUser, userProfile } = useAuth();
  // Two tabs, not three. The Database Console moved to Setup → Raw records: it
  // edits live documents with none of the app's checks, and had no business
  // being a peer of Friday-evening dispatch.
  const [activeTab, setActiveTab] = useState<'planning' | 'dropoff'>('planning');

  /** The request awaiting a driver, or null. */
  const [assigning, setAssigning] = useState<{ id: string; name: string; seats: number } | null>(null);
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);

  // Release modal state
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [pendingReleaseDriver, setPendingReleaseDriver] = useState<{ driverId: string; rideIds: string[]; driver: Driver | null } | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const { ask, confirmDialog } = useConfirm();
  const toast = useToast();

  useAutoDispatch();

  // useCurrentEvent was read here for the attendance CSV, which now lives in
  // ManagerReports. Nothing on this screen is per-gathering any more, so the
  // subscription went with it — as did the venue read before it, for the same
  // reason: every venue-dependent surface reads it where it is used.

  // usePendingDrivers/usePendingRiders were called here and never read — two live
  // Firestore listeners on every manager's dashboard, feeding nothing. The
  // approvals UI is components/manager/ManagerPeople.tsx, which subscribes itself.
  const { requests: pendingRequests, loading: requestsLoading } = usePendingRequests();
  const { rides: activeRides } = useAllActiveRides();
  const { drivers: availableDrivers, loading: driversLoading } = useAvailableDrivers();

  // Group active rides by driver (excluding completed rides)
  const groupedRides = React.useMemo(() => {
    const groups: Record<string, { driver: Driver, rides: Ride[] }> = {};
    const ongoingRides = activeRides.filter(r => r.status !== 'completed' && r.status !== 'cancelled');

    ongoingRides.forEach(ride => {
      // Correctly access the ID from the nested driver object or the top level
      const driverIdFromRide = ride.driver?.id || ride.driverId;
      if (!driverIdFromRide) return;

      if (!groups[driverIdFromRide]) {
        // Use existing driver structure from ride, or construct basic info
        const driver = ride.driver || {
          id: driverIdFromRide,
          name: ride.driverName || 'Sarthi',
          userId: driverIdFromRide,
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

  /** Seats waiting, not requests. A tab reading "7" when it is 14 people is
      the same head-count-as-row-count mistake the seat work removed elsewhere. */
  const waitingPeople = React.useMemo(
    () => pendingRequests.reduce((n, r) => n + (r.seats ?? 1), 0),
    [pendingRequests],
  );

  // The attendance count and its CSV download used to live here too. Both moved
  // to components/manager/ManagerReports.tsx; these copies were left behind and
  // wired to nothing.

  /**
   * Opens the picker. It used to take `availableDrivers.find(...)` — whoever
   * was first in the array — and never say who got the rider.
   */
  const handleAssignRequest = (requestId: string) => {
    const request = pendingRequests.find(r => r.id === requestId);
    setAssigning({
      id: requestId,
      name: request?.name ?? 'this rider',
      seats: request?.seats ?? 1,
    });
  };

  const handlePickDriver = async (driver: Driver) => {
    if (!assigning) return;
    setAssigningDriverId(driver.id);
    try {
      await assignRideToDriver(assigning.id, driver);
      toast.success(`${assigning.name} assigned to ${driver.name}.`);
      setAssigning(null);
    } catch (error) {
      console.error('Failed to assign:', error);
      toast.error(error instanceof Error ? error.message : 'Could not assign that rider.');
    } finally {
      setAssigningDriverId(null);
    }
  };

  const handleDismiss = async (requestId: string) => {
    if (await ask({
      title: 'Dismiss this request?',
      message: 'The rider will not get a ride to this sabha.',
      confirmLabel: 'Dismiss',
      cancelLabel: 'Keep it',
      destructive: true,
    })) {
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
      toast.error('Could not return those riders to the queue. Please try again.');
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

      // 2. Release the driver's vehicle and set them offline.
      //
      // Through the callable, not a client write. This touches ANOTHER user's
      // document, so it needs the three things a browser cannot do: a manager
      // check, an audit row naming who released what, and a refusal while that
      // driver still has riders in the car. The client path it replaced did none
      // of them, and it also left `activeRideId` dangling — which is what made
      // driverDoneForToday refuse for a driver who had nothing left to do.
      //
      // Students are returned to the pool above, so by the time this runs the
      // driver has no live rides and the refusal does not fire. If it ever does,
      // that means step 1 did not finish — and stopping is right: releasing a car
      // mid-run makes the driver's screen disagree with their passengers.
      const driver = pendingReleaseDriver.driver;
      const vehicleId = driver?.currentVehicleId || (driver as any)?.currentCarId || (driver as any)?.carId;
      const driverId = driver?.id || pendingReleaseDriver.driverId;

      if (vehicleId) {
        await managerReleaseVehicle(vehicleId);
      } else {
        // If no vehicle ID found, set driver offline
        await setDriverAvailability(driverId, 'offline');
      }

      setShowReleaseModal(false);
      setPendingReleaseDriver(null);
    } catch (error) {
      // The server's own words. The callable refuses for good reasons — a driver
      // still carrying riders — and "please try again" would send the manager
      // round a loop that cannot succeed.
      console.error("Failed to fully release driver:", error);
      toast.error(error instanceof Error && error.message
        ? error.message
        : 'Could not release the driver. Please try again.');
    } finally {
      setReleaseLoading(false);
    }
  };

  const handleBulkAssign = async (ids: string[]) => {
    const available = availableDrivers.find(d => d.status === 'available');
    if (!available) {
      toast.error('No driver is available right now. Ask someone to go on shift.');
      return;
    }

    // Partial success is the normal outcome here, not an edge case: each
    // assignment is its own write and a later one can fail once the driver
    // fills up. Reporting "Assigned 5" after two succeeded would send a
    // manager away believing three riders are sorted when they are waiting.
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await assignRideToDriver(id, available);
      } catch (error) {
        console.error('Bulk assign failed for', id, error);
        failed.push(id);
      }
    }

    const assigned = ids.length - failed.length;
    if (failed.length === 0) {
      toast.success(`Assigned ${assigned} ${assigned === 1 ? 'request' : 'requests'} to ${available.name}.`);
    } else if (assigned === 0) {
      toast.error(`Could not assign any of the ${ids.length} requests. They are still waiting.`);
    } else {
      toast.error(`Assigned ${assigned} of ${ids.length}. ${failed.length} still waiting — try again.`);
    }
  };

  // handleManualAssign was defined here and never referenced in the JSX.
  //
  // The remediation plan called for wiring it to the Assign buttons. It cannot
  // serve them: manualAssignStudent ADDS a rider to a driver's existing ride and
  // throws 'Driver does not have an active ride' otherwise, whereas the Assign
  // button assigns a pending request to an idle driver. Two different
  // operations. The dead handler is removed; the callable stays deployed
  // (manager-gated) for the "add a rider to a run already going out" screen that
  // does not exist yet. Making the Assign button correct meant fixing
  // assignRideToDriver instead — see hooks/useRides.ts.

  // handleApproveDriver / handleDenyDriver / handleApproveRider / handleDenyRider
  // were defined here and referenced nowhere — ~55 lines of approve/deny logic
  // with no button attached, left over from before people management was split
  // into components/manager/ManagerPeople.tsx. That component owns the flow and
  // calls the same `updateUserStatus`, so nothing is lost by deleting these.
  //
  // Worth stating plainly: this was NOT a missing feature. Approvals work. It was
  // a second, unreachable copy of them.

  return (
    <div className="app-panel flex flex-col bg-cream relative overflow-hidden">
      {/* Two tabs, and the counts you would otherwise switch tabs to read.
          The merge into a single "Tonight" screen was declined deliberately —
          this is the cheap way to cut the toggling. */}
      <div className="glass-chrome border-b border-hairline/10 px-4 py-2 shrink-0 pt-safe lg:pt-2 z-sticky">
        <div className="bg-cream-300/60 p-1 rounded-xl flex gap-1 max-w-md">
          <button
            onClick={() => setActiveTab('planning')}
            aria-current={activeTab === 'planning' ? 'page' : undefined}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-11
              ${activeTab === 'planning'
                ? 'bg-surface text-coffee shadow-sm'
                : 'text-coffee-500 hover:text-coffee'}`}
          >
            Waiting · {pendingRequests.length}
            {waitingPeople !== pendingRequests.length && (
              <span className="font-medium"> ({waitingPeople} people)</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('dropoff')}
            aria-current={activeTab === 'dropoff' ? 'page' : undefined}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-11
              ${activeTab === 'dropoff'
                ? 'bg-surface text-coffee shadow-sm'
                : 'text-coffee-500 hover:text-coffee'}`}
          >
            {/* "drivers", not "cars".
                This counts groupedRides, which groups ACTIVE RIDES BY DRIVER — so
                it is the number of people currently out carrying riders. Fleet's
                "In Use" counts vehicles a driver is holding, which includes every
                car picked up but not yet dispatched.
                Two different quantities under one word: on 2026-08-14 Fleet said 3
                In Use while this said "Out now · 0 cars", and the disagreement
                read as a display fault rather than as the plain fact that three
                drivers were holding cars and none had riders. */}
            Out now · {groupedRides.length} {groupedRides.length === 1 ? 'driver' : 'drivers'}
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
              onAssign={handleAssignRequest}
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
                  <p className="text-coffee-500 text-sm">Who is driving whom, and where each ride has got to</p>
                </div>
                {/* Said "Auto-Dispatch Active", with a pulsing green dot, while
                    the browser dispatcher it referred to has been disabled
                    since 80c3c0e (it threw a ReferenceError before doing any
                    work, and repairing it would have been worse than removing
                    it). Assignment is driver-pull today; server-side dispatch
                    is Phase 4. The badge now says what is true. */}
                <div className="bg-surface border border-[rgb(var(--info))]/40 text-[rgb(var(--info-text))] inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[rgb(var(--info))]"></span>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest">Sarthis Self-Assign</span>
                </div>
              </div>

              {/* A "Live Interactive Map" sat here. It was a schematic box that
                  placed pins by scaling latitude and longitude into percentages
                  of a plain div — no map tiles, no streets, nothing to
                  recognise. Even plotting real positions, which it did only
                  after f4bc5cd, it could not answer the question a manager
                  actually has: where is this driver now, and how far off is
                  their next pickup. Live driver positions were never on it.
                  Removed at the manager's request rather than kept as decoration.
                  Real mapping is a Phase 4 concern, alongside server-side
                  dispatch, and would start from a tile provider. */}

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
                          toast.error('Could not unassign that rider. Please try again.');
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

      {/* Release Driver Choice Modal */}
      {showReleaseModal && pendingReleaseDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-modal p-4 animate-in fade-in duration-200">
          <div className="bg-surface rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-header font-bold text-xl text-coffee">Release Sarthi</h2>
                <button
                  onClick={() => {
                    setShowReleaseModal(false);
                    setPendingReleaseDriver(null);
                  }}
                  className="p-2 hover:bg-cream-300 rounded-full transition-colors"
                  disabled={releaseLoading}
                >
                  <X size={20} className="text-coffee-500" />
                </button>
              </div>

              <p className="text-coffee-700 mb-6">
                Choose how to release <span className="font-bold text-coffee">{pendingReleaseDriver.driver?.name || 'this driver'}</span>:
              </p>

              <div className="space-y-3">
                {/* Soft Release Option */}
                <button
                  onClick={handleSoftRelease}
                  disabled={releaseLoading}
                  className="w-full p-4 bg-[rgb(var(--info-bg))] hover:bg-[rgb(var(--info-bg))] border-2 border-[rgb(var(--info))]/40 rounded-xl text-left transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[rgb(var(--info-bg))] rounded-lg">
                      <Users size={20} className="text-[rgb(var(--info-text))]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[rgb(var(--info-text))]">Clear Bhulka (Keep Online)</h3>
                      <p className="text-sm text-[rgb(var(--info-text))]/70">Returns students to pool. Sarthi stays available for new assignments.</p>
                    </div>
                  </div>
                </button>

                {/* Hard Release Option */}
                <button
                  onClick={handleHardRelease}
                  disabled={releaseLoading}
                  className="w-full p-4 bg-[rgb(var(--danger-bg))] hover:bg-[rgb(var(--danger-bg))] border-2 border-[rgb(var(--danger))]/40 rounded-xl text-left transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[rgb(var(--danger-bg))] rounded-lg">
                      <LogOut size={20} className="text-[rgb(var(--danger-text))]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[rgb(var(--danger-text))]">Full Checkout (Go Offline)</h3>
                      <p className="text-sm text-[rgb(var(--danger-text))]/70">Returns students, releases vehicle, sets driver offline.</p>
                    </div>
                  </div>
                </button>
              </div>

              {releaseLoading && (
                <div className="flex items-center justify-center gap-2 mt-4 text-coffee-500">
                  <div className="animate-spin w-4 h-4 border-2 border-saffron border-t-transparent rounded-full"></div>
                  <span className="text-sm">Processing...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <DriverPicker
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        riderName={assigning?.name}
        seats={assigning?.seats ?? 1}
        drivers={availableDrivers}
        loading={driversLoading}
        assigningId={assigningDriverId}
        onPick={handlePickDriver}
      />

      {confirmDialog}
    </div>
  );
};
