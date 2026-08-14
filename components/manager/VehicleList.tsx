import React from 'react';
import { Vehicle } from '../../types';
import { Edit2, Trash2, Car, Users, CheckCircle2, AlertCircle, Loader2, Undo2 } from 'lucide-react';

interface VehicleListProps {
    vehicles: Vehicle[];
    loading: boolean;
    onEdit: (vehicle: Vehicle) => void;
    onDelete: (vehicle: Vehicle) => void;
    /**
     * Hand a held car back to the fleet.
     *
     * A car goes `in_use` the moment a driver picks it and is only freed by that
     * driver finishing. Until this existed, a driver who stopped without
     * finishing left the car held for ever: delete refuses while `in_use`, and
     * editing does not touch status. On 2026-08-14 that left a three-car fleet
     * with zero available cars and no way back through the UI.
     */
    onRelease: (vehicle: Vehicle) => void;
    /** The vehicle currently being released, so its row can show progress. */
    releasingId?: string | null;
}

const statusColors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    'available': {
        bg: 'bg-[rgb(var(--success-bg))]',
        text: 'text-[rgb(var(--success-text))]',
        icon: <CheckCircle2 size={14} className="text-[rgb(var(--success-text))]" />
    },
    'in_use': {
        bg: 'bg-[rgb(var(--info-bg))]',
        text: 'text-[rgb(var(--info-text))]',
        icon: <Car size={14} className="text-[rgb(var(--info-text))]" />
    },
    'maintenance': {
        bg: 'bg-[rgb(var(--danger-bg))]',
        text: 'text-[rgb(var(--danger-text))]',
        icon: <AlertCircle size={14} className="text-[rgb(var(--danger-text))]" />
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

export const VehicleList: React.FC<VehicleListProps> = ({
    vehicles, loading, onEdit, onDelete, onRelease, releasingId,
}) => {
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <div className="relative">
                    <Loader2 className="animate-spin w-10 h-10 text-saffron" />
                    <Car className="absolute inset-0 m-auto w-5 h-5 text-gold opacity-50" />
                </div>
                <p className="text-xs font-bold text-gold-700 mt-4 tracking-widest">LOADING FLEET...</p>
            </div>
        );
    }

    if (vehicles.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                <div className="w-20 h-20 rounded-full bg-cream flex items-center justify-center mb-4">
                    <Car size={32} className="text-coffee-500" />
                </div>
                <h3 className="font-header font-bold text-lg text-coffee mb-2">No Vehicles</h3>
                <p className="text-sm text-coffee-500">Add your first vehicle to the fleet</p>
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

                                    <div className="flex items-center gap-4 mt-1 text-sm text-coffee-500">
                                        <span className="font-mono bg-cream px-2 py-0.5 rounded">
                                            {vehicle.licensePlate}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Users size={14} />
                                            {vehicle.capacity} seats
                                        </span>
                                    </div>

                                    {/* Who has it. This read `currentDriverName`
                                        off the document, a field nothing writes,
                                        so it never rendered — a car said "In Use"
                                        and named nobody. useVehicles now maps it
                                        from `assignedDriverName`. */}
                                    {vehicle.status === 'in_use' && (
                                        <p className="text-xs text-[rgb(var(--info-text))] mt-1">
                                            {vehicle.currentDriverName
                                                ? `Held by ${vehicle.currentDriverName}`
                                                // A car in use with no holder recorded cannot be
                                                // freed by any driver-side path, so say so rather
                                                // than leaving the row blank.
                                                : 'Held, but no driver is recorded'}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                                {/* Only for a held car — a Release on an already
                                    available one is a control that cannot do
                                    anything, which is the failure mode this
                                    codebase keeps removing. */}
                                {vehicle.status === 'in_use' && (
                                    <button
                                        onClick={() => onRelease(vehicle)}
                                        disabled={releasingId === vehicle.id}
                                        className="p-2 min-h-11 hover:bg-[rgb(var(--warning-bg))] rounded-lg transition-colors
                                                   text-mocha hover:text-[rgb(var(--warning-text))] disabled:opacity-50"
                                        title={`Release ${vehicle.name} back to the fleet`}
                                        aria-label={`Release ${vehicle.name} back to the fleet`}
                                    >
                                        {releasingId === vehicle.id
                                            ? <Loader2 size={18} className="animate-spin" />
                                            : <Undo2 size={18} />}
                                    </button>
                                )}
                                <button
                                    onClick={() => onEdit(vehicle)}
                                    className="p-2 hover:bg-cream rounded-lg transition-colors text-mocha hover:text-coffee"
                                    title="Edit vehicle"
                                >
                                    <Edit2 size={18} />
                                </button>
                                <button
                                    onClick={() => onDelete(vehicle)}
                                    className="p-2 hover:bg-[rgb(var(--danger-bg))] rounded-lg transition-colors text-mocha hover:text-[rgb(var(--danger-text))]"
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
