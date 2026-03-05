import React from 'react';
import { Vehicle } from '../../types';
import { Edit2, Trash2, Car, Users, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface VehicleListProps {
    vehicles: Vehicle[];
    loading: boolean;
    onEdit: (vehicle: Vehicle) => void;
    onDelete: (vehicle: Vehicle) => void;
}

const statusColors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    'available': {
        bg: 'bg-green-50',
        text: 'text-green-700',
        icon: <CheckCircle2 size={14} className="text-green-500" />
    },
    'in_use': {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        icon: <Car size={14} className="text-blue-500" />
    },
    'maintenance': {
        bg: 'bg-red-50',
        text: 'text-red-700',
        icon: <AlertCircle size={14} className="text-red-500" />
    }
};

const formatStatus = (status: string): string => {
    switch (status) {
        case 'in_use':
            return 'In Use';
        case 'available':
            return 'Available';
        case 'maintenance':
            return 'Maintenance';
        default:
            return status;
    }
};

export const VehicleList: React.FC<VehicleListProps> = ({ vehicles, loading, onEdit, onDelete }) => {
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <div className="relative">
                    <Loader2 className="animate-spin w-10 h-10 text-saffron" />
                    <Car className="absolute inset-0 m-auto w-5 h-5 text-gold opacity-50" />
                </div>
                <p className="text-xs font-bold text-gold mt-4 tracking-widest">LOADING FLEET...</p>
            </div>
        );
    }

    if (vehicles.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                <div className="w-20 h-20 rounded-full bg-cream flex items-center justify-center mb-4">
                    <Car size={32} className="text-mocha/40" />
                </div>
                <h3 className="font-header font-bold text-lg text-coffee mb-2">No Vehicles</h3>
                <p className="text-sm text-mocha/60">Add your first vehicle to the fleet</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {vehicles.map((vehicle) => {
                const statusStyle = statusColors[vehicle.status] || statusColors['available'];

                return (
                    <div
                        key={vehicle.id}
                        className="clay-card p-4 hover:shadow-md transition-shadow"
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex gap-4">
                                {/* Vehicle Icon with Color */}
                                <div
                                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-sm"
                                    style={{ backgroundColor: vehicle.color || '#888' }}
                                >
                                    <Car size={24} className="text-white/90" />
                                </div>

                                {/* Vehicle Details */}
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-header font-bold text-lg text-coffee">
                                            {vehicle.name}
                                        </h3>
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                                            {statusStyle.icon}
                                            {formatStatus(vehicle.status)}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-4 mt-1 text-sm text-mocha/60">
                                        <span className="font-mono bg-cream px-2 py-0.5 rounded">
                                            {vehicle.licensePlate}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Users size={14} />
                                            {vehicle.capacity} seats
                                        </span>
                                    </div>

                                    {vehicle.currentDriverName && (
                                        <p className="text-xs text-blue-600 mt-1">
                                            Assigned to: {vehicle.currentDriverName}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onEdit(vehicle)}
                                    className="p-2 hover:bg-cream rounded-lg transition-colors text-mocha hover:text-coffee"
                                    title="Edit vehicle"
                                >
                                    <Edit2 size={18} />
                                </button>
                                <button
                                    onClick={() => onDelete(vehicle)}
                                    className="p-2 hover:bg-red-50 rounded-lg transition-colors text-mocha hover:text-red-500"
                                    title="Delete vehicle"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
