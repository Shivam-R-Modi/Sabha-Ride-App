import React, { useState } from 'react';
import { useAvailableVehicles, assignVehicleToDriver } from '../../hooks/useFirestore';
import { useAuth } from '../../contexts/AuthContext';
import { Vehicle } from '../../types';
import { Car, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import { LotusIcon } from '../../constants';

interface VehicleSelectionProps {
    onSelectionComplete: () => void;
}

export const VehicleSelection: React.FC<VehicleSelectionProps> = ({ onSelectionComplete }) => {
    const { availableVehicles, loading } = useAvailableVehicles();
    const { currentUser, userProfile, refreshProfile } = useAuth();
    const [assigningId, setAssigningId] = useState<string | null>(null);

    const handleSelect = async (vehicle: Vehicle) => {
        if (!currentUser || !userProfile) return;
        
        setAssigningId(vehicle.id);
        try {
            await assignVehicleToDriver(vehicle, currentUser.uid, userProfile.name);
            await refreshProfile();
            onSelectionComplete();
        } catch (e) {
            console.error(e);
            setAssigningId(null);
            alert("Failed to assign vehicle. It might have been taken just now.");
        }
    };

    return (
        <div className="min-h-screen bg-cream flex flex-col items-center p-6">
             <div className="mt-8 mb-8 text-center">
                 <div className="w-16 h-16 bg-saffron/10 rounded-full flex items-center justify-center mx-auto mb-4">
                     <LotusIcon className="w-8 h-8 text-saffron" />
                 </div>
                 <h1 className="font-header font-bold text-2xl text-coffee">Select Your Vehicle</h1>
                 <p className="text-gray-500">Choose the car you are driving today.</p>
             </div>

             {loading ? (
                 <div className="flex flex-col items-center justify-center py-20 opacity-50">
                     <Loader2 className="w-8 h-8 animate-spin text-saffron mb-2" />
                     <p className="text-sm">Checking garage...</p>
                 </div>
             ) : (
                 <div className="w-full max-w-md space-y-4">
                     {availableVehicles.length === 0 ? (
                         <div className="bg-white p-8 rounded-2xl text-center shadow-sm border border-gray-200">
                             <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                                 <Car size={32} />
                             </div>
                             <h3 className="font-bold text-gray-600">No Vehicles Available</h3>
                             <p className="text-sm text-gray-400 mt-1">Please contact your coordinator.</p>
                             <button onClick={() => window.location.reload()} className="mt-4 text-saffron font-bold text-sm flex items-center gap-1 justify-center">
                                 <RefreshCcw size={14} /> Refresh
                             </button>
                         </div>
                     ) : (
                        availableVehicles.map(v => (
                            <button 
                                key={v.id}
                                onClick={() => handleSelect(v)}
                                disabled={assigningId !== null}
                                className="w-full bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between group hover:border-saffron hover:shadow-md transition-all active:scale-[0.98]"
                            >
                                <div className="flex items-center gap-4 text-left">
                                    <div className="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center text-green-600 border border-green-100">
                                        <Car size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-coffee text-lg">{v.name}</h4>
                                        <div className="flex items-center gap-2 text-sm text-gray-500">
                                            <span className="font-mono bg-gray-100 px-1.5 rounded text-xs">{v.plateNumber}</span>
                                            <span>•</span>
                                            <span>{v.color}</span>
                                            <span>•</span>
                                            <span>{v.capacity} Seats</span>
                                        </div>
                                    </div>
                                </div>
                                
                                {assigningId === v.id ? (
                                    <Loader2 className="animate-spin text-saffron" />
                                ) : (
                                    <div className="w-8 h-8 rounded-full border-2 border-gray-200 flex items-center justify-center text-white group-hover:border-saffron group-hover:bg-saffron transition-all">
                                        <CheckCircle2 size={16} />
                                    </div>
                                )}
                            </button>
                        ))
                     )}
                 </div>
             )}
        </div>
    );
};