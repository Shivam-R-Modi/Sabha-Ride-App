import React, { useState, useEffect } from 'react';
import { DriverAssignment, Passenger, Driver } from '../../types';
import { MapPin, Phone, CheckCircle2, Circle, Navigation, Edit2, Plus, Trash2, GripVertical, Save, X, Home, UserPlus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { assignRideToDriver, unassignRide, updateRideDetails, usePendingRequests } from '../../hooks/useFirestore';

interface AssignmentDetailProps {
  assignment: DriverAssignment;
  onBack: () => void;
}

export const AssignmentDetail: React.FC<AssignmentDetailProps> = ({ assignment, onBack }) => {
  const { userProfile, currentUser } = useAuth();
  const [passengers, setPassengers] = useState(assignment.passengers);
  const [isEditing, setIsEditing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Real pending requests for adding new students
  const { requests: pendingRequests } = usePendingRequests();

  // Handle local state sync if props change (though typically we want local control during edit)
  useEffect(() => {
    if (!isEditing) {
        setPassengers(assignment.passengers);
    }
  }, [assignment, isEditing]);

  // --- Actions ---

  const togglePassengerStatus = (id: string) => {
    if (isEditing) return;
    setPassengers(prev => prev.map(p => {
      if (p.id !== id) return p;
      return { ...p, stopStatus: p.stopStatus === 'completed' ? 'pending' : 'completed' };
    }));
  };

  const removePassenger = async (id: string) => {
    if (!confirm("Remove this student from your route?")) return;
    
    // Optimistic update
    setPassengers(prev => prev.filter(p => p.id !== id));
    
    // Perform DB Update
    try {
        // Check if it's the driver's own added stop (which has no ride ID usually, or special ID)
        if (id === currentUser?.uid) {
            // It's the driver, just removed from local state is enough if not persisted as Ride
            return;
        }
        await unassignRide(id);
    } catch (e) {
        console.error("Failed to unassign", e);
        alert("Failed to remove student. Please try again.");
    }
  };

  const handleAddStudent = async (req: any) => {
      if (!currentUser || !userProfile) return;
      
      const newPassenger: Passenger = {
        ...req,
        id: req.id, // Ensure we use the ride ID or user ID depending on structure. req is StudentRequest (ride doc id mostly)
        stopStatus: 'pending',
        sequenceOrder: passengers.length + 1,
        eta: 'TBD'
      };

      // Optimistic
      setPassengers(prev => [...prev, newPassenger]);
      setShowAddModal(false);

      // DB Update
      try {
          // Assuming 'req.id' is the Ride ID from usePendingRequests
          const driver: Driver = userProfile as Driver;
          await assignRideToDriver(req.id, driver);
      } catch (e) {
          console.error(e);
          alert("Failed to assign student.");
      }
  };

  const handleAddMyStop = () => {
      if (!userProfile || !currentUser) return;
      
      const myStop: Passenger = {
          id: currentUser.uid,
          name: `${userProfile.name} (Me)`,
          address: userProfile.address,
          phone: userProfile.phone,
          avatarUrl: userProfile.avatarUrl,
          stopStatus: 'pending',
          sequenceOrder: passengers.length + 1,
          eta: 'End'
      };
      
      // Check if already added
      if (passengers.some(p => p.id === currentUser.uid)) {
          alert("Your stop is already in the list.");
          return;
      }

      setPassengers(prev => [...prev, myStop]);
  };

  const handleFieldChange = (id: string, field: 'address' | 'notes', value: string) => {
      setPassengers(prev => prev.map(p => {
          if (p.id !== id) return p;
          return { ...p, [field]: value };
      }));
  };

  const handleSave = async () => {
      setIsEditing(false);
      // Persist changes to notes/addresses
      for (const p of passengers) {
          // Skip driver's own stop for DB persistence if it's not a real ride
          if (p.id === currentUser?.uid) continue;

          try {
             // We only update if changed. To actully check diff, we'd need original. 
             // For now, just update to be safe or optimize later.
             await updateRideDetails(p.id, {
                 pickupAddress: p.address,
                 notes: p.notes
             });
          } catch (e) {
              console.error(`Failed to update ${p.name}`, e);
          }
      }
  };

  const generateMapUrl = () => {
    // Construct Google Maps URL
    const baseUrl = "https://www.google.com/maps/dir/?api=1";
    const origin = assignment.type === 'pickup' ? "Current+Location" : encodeURIComponent(assignment.venueAddress);
    
    // If passengers list is empty, just go to venue
    if (passengers.length === 0) return `${baseUrl}&destination=${encodeURIComponent(assignment.venueAddress)}`;

    const lastPassenger = passengers[passengers.length - 1];
    const destination = assignment.type === 'pickup' ? encodeURIComponent(assignment.venueAddress) : encodeURIComponent(lastPassenger.address);
    
    // Waypoints
    let waypointAddresses: string[] = [];
    if (assignment.type === 'pickup') {
        waypointAddresses = passengers.map(p => encodeURIComponent(p.address));
    } else {
        // For dropoff, waypoints are all except last
        waypointAddresses = passengers.slice(0, -1).map(p => encodeURIComponent(p.address));
    }
    
    const waypoints = waypointAddresses.length > 0 ? `&waypoints=${waypointAddresses.join('|')}` : '';
    
    return `${baseUrl}&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
  };

  // --- Renderers ---

  return (
    <div className="bg-cream min-h-screen pb-safe">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-orange-100 sticky top-0 z-30">
        <div className="p-4 flex items-center justify-between">
            <button onClick={onBack} className="text-coffee font-medium flex items-center gap-1">
                <X size={20} /> Back
            </button>
            <h2 className="font-header font-bold text-lg text-coffee uppercase tracking-wide">
                {assignment.type} Round
            </h2>
            <button 
                onClick={isEditing ? handleSave : () => setIsEditing(true)} 
                className={`p-2 rounded-full transition-all ${isEditing ? 'bg-green-100 text-green-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
            >
                {isEditing ? <div className="flex items-center gap-1 px-2"><Save size={18} /> <span className="text-xs font-bold">Done</span></div> : <Edit2 size={20} />}
            </button>
        </div>
        
        {/* Stats Bar */}
        <div className="px-4 pb-4 flex justify-between items-end">
            <div>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                    <span className="font-semibold text-coffee">{passengers.length} Students</span>
                    <span>•</span>
                    <span>{assignment.totalDistance}</span>
                </div>
                <div className="h-1.5 w-32 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-green-500 transition-all duration-500" 
                        style={{ width: `${(passengers.filter(p => p.stopStatus === 'completed').length / passengers.length) * 100}%` }}
                    />
                </div>
            </div>
            
            {!isEditing && (
                <a 
                    href={generateMapUrl()} 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-xl font-bold shadow-lg shadow-green-200 active:scale-95 transition-transform"
                >
                    <Navigation size={18} fill="currentColor" />
                    Start
                </a>
            )}
        </div>
      </div>

      {/* List */}
      <div className="p-4 space-y-3">
        {passengers.map((p, index) => (
            <div 
                key={p.id} 
                className={`bg-white rounded-xl p-4 shadow-sm border transition-all relative overflow-hidden ${
                    p.stopStatus === 'completed' && !isEditing ? 'border-green-200 bg-green-50/30' : 'border-gray-100'
                }`}
            >
                <div className="flex items-start gap-3">
                    {/* Index or Drag Handle */}
                    <div className="flex flex-col items-center justify-center pt-1 text-gray-400 font-mono text-sm w-6">
                        {isEditing ? <GripVertical size={20} /> : <span>{index + 1}</span>}
                    </div>

                    <div className="flex-1">
                        <div className="flex justify-between items-start">
                            <h3 className={`font-header font-bold text-coffee ${p.stopStatus === 'completed' && !isEditing ? 'line-through text-gray-400' : ''}`}>
                                {p.name}
                            </h3>
                            <span className="text-xs font-semibold text-saffron bg-orange-50 px-2 py-0.5 rounded">
                                {p.eta}
                            </span>
                        </div>
                        
                        <div className="flex items-start gap-1 mt-1 text-gray-500 text-sm" onClick={(e) => e.stopPropagation()}>
                            <MapPin size={14} className="mt-0.5 shrink-0" />
                            {isEditing ? (
                                <input 
                                    value={p.address}
                                    onChange={(e) => handleFieldChange(p.id, 'address', e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded p-1 text-xs focus:ring-1 focus:ring-saffron focus:outline-none"
                                />
                            ) : (
                                <p className="line-clamp-1">{p.address}</p>
                            )}
                        </div>

                        {(p.notes || isEditing) && (
                            <div className="mt-2">
                                {isEditing ? (
                                    <input 
                                        placeholder="Add notes..."
                                        value={p.notes || ''}
                                        onChange={(e) => handleFieldChange(p.id, 'notes', e.target.value)}
                                        className="w-full bg-orange-50 border border-orange-100 rounded p-1 text-xs text-orange-800 placeholder-orange-300 focus:ring-1 focus:ring-saffron focus:outline-none"
                                    />
                                ) : (
                                    p.notes && (
                                        <p className="text-xs text-orange-600 bg-orange-50 p-2 rounded-lg border border-orange-100">
                                            Note: {p.notes}
                                        </p>
                                    )
                                )}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        {isEditing ? (
                            <button 
                                onClick={() => removePassenger(p.id)}
                                className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100"
                            >
                                <Trash2 size={18} />
                            </button>
                        ) : (
                            <>
                                <button 
                                    onClick={() => togglePassengerStatus(p.id)}
                                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                                        p.stopStatus === 'completed' 
                                        ? 'bg-green-500 text-white shadow-lg shadow-green-200 scale-110' 
                                        : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                                    }`}
                                >
                                    {p.stopStatus === 'completed' ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                                </button>
                                <a href={`tel:${p.phone}`} className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center">
                                    <Phone size={18} />
                                </a>
                            </>
                        )}
                    </div>
                </div>
            </div>
        ))}

        {isEditing && (
            <div className="space-y-3 pt-2">
                <button 
                    onClick={() => setShowAddModal(true)}
                    className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 font-medium flex items-center justify-center gap-2 hover:border-saffron hover:text-saffron hover:bg-orange-50 transition-colors"
                >
                    <Plus size={20} />
                    Add Student
                </button>
                
                <button 
                    onClick={handleAddMyStop}
                    className="w-full py-4 border border-blue-100 bg-blue-50 rounded-xl text-blue-600 font-medium flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors"
                >
                    <Home size={20} />
                    Add My Stop (Start/End)
                </button>
            </div>
        )}
      </div>

      {/* Add Student Modal */}
      {showAddModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-orange-50 shrink-0">
                      <h3 className="font-bold text-coffee flex items-center gap-2">
                          <UserPlus size={18} /> Add Student
                      </h3>
                      <button onClick={() => setShowAddModal(false)}><X size={20} /></button>
                  </div>
                  
                  <div className="p-2 overflow-y-auto">
                      {pendingRequests.length === 0 ? (
                          <div className="p-8 text-center text-gray-400">
                              <p>No pending students found.</p>
                          </div>
                      ) : (
                          pendingRequests.map(req => (
                              <div key={req.id} className="p-3 hover:bg-gray-50 rounded-xl flex items-center justify-between group border-b border-gray-50 last:border-0">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                      <img src={req.avatarUrl} className="w-10 h-10 rounded-full bg-gray-200" alt="" />
                                      <div className="min-w-0">
                                          <p className="font-bold text-sm text-coffee truncate">{req.name}</p>
                                          <p className="text-xs text-gray-500 truncate">{req.address}</p>
                                          <div className="flex gap-2 mt-0.5">
                                             <span className="text-[10px] bg-gray-100 px-1 rounded text-gray-500">{req.requestedTimeSlot}</span>
                                          </div>
                                      </div>
                                  </div>
                                  <button 
                                    onClick={() => handleAddStudent(req)}
                                    className="bg-saffron text-white p-2 rounded-full shadow-md hover:bg-saffron-dark transition-colors shrink-0"
                                  >
                                      <Plus size={16} />
                                  </button>
                              </div>
                          ))
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};