import React, { useState, useEffect } from 'react';
import { useVehicles, deleteVehicle } from '../../hooks/useFirestore';
import { Vehicle } from '../../types';
import { VehicleForm } from './VehicleForm';
import { VehicleList } from './VehicleList';
import { Plus, Shield, Loader2, AlertCircle } from 'lucide-react';

export const FleetManagement: React.FC = () => {
    const { vehicles, loading, error } = useVehicles();

    const [showForm, setShowForm] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<Vehicle | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Auto-hide notifications
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const handleAddVehicle = () => {
        setEditingVehicle(null);
        setShowForm(true);
    };

    const handleEditVehicle = (vehicle: Vehicle) => {
        setEditingVehicle(vehicle);
        setShowForm(true);
    };

    const handleDeleteVehicle = async () => {
        if (!deleteConfirm) return;

        setIsDeleting(true);
        try {
            await deleteVehicle(deleteConfirm.id);
            setNotification({ type: 'success', message: 'Vehicle deleted successfully' });
            setDeleteConfirm(null);
        } catch (error) {
            console.error('Error deleting vehicle:', error);
            setNotification({ type: 'error', message: 'Failed to delete vehicle. Please try again.' });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleFormSuccess = () => {
        setShowForm(false);
        setEditingVehicle(null);
        setNotification({
            type: 'success',
            message: editingVehicle ? 'Vehicle updated successfully' : 'Vehicle added successfully'
        });
    };

    const handleFormClose = () => {
        setShowForm(false);
        setEditingVehicle(null);
    };

    // Calculate stats
    const totalVehicles = vehicles.length;
    const availableVehicles = vehicles.filter(v => v.status === 'available').length;
    const inUseVehicles = vehicles.filter(v => v.status === 'in_use').length;
    const maintenanceVehicles = vehicles.filter(v => v.status === 'maintenance').length;

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-saffron/10 flex items-center justify-center">
                        <Shield size={20} className="text-saffron" />
                    </div>
                    <div>
                        <h2 className="text-xl font-header font-bold text-coffee">Fleet Management</h2>
                        <p className="text-sm text-coffee-500">Manage your vehicle fleet</p>
                    </div>
                </div>
                <button
                    onClick={handleAddVehicle}
                    className="flex items-center gap-2 px-4 py-2 bg-saffron text-white rounded-xl font-semibold hover:bg-saffron/90 transition-colors"
                >
                    <Plus size={18} />
                    Add Vehicle
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="clay-card p-4">
                    <div className="text-sm text-coffee-500">Total Fleet</div>
                    <div className="text-2xl font-bold text-coffee">{totalVehicles}</div>
                </div>
                <div className="clay-card p-4">
                    <div className="text-sm text-[rgb(var(--success-text))]">Available</div>
                    <div className="text-2xl font-bold text-[rgb(var(--success-text))]">{availableVehicles}</div>
                </div>
                <div className="clay-card p-4">
                    <div className="text-sm text-[rgb(var(--info-text))]">In Use</div>
                    <div className="text-2xl font-bold text-[rgb(var(--info-text))]">{inUseVehicles}</div>
                </div>
                <div className="clay-card p-4">
                    <div className="text-sm text-[rgb(var(--danger-text))]">Maintenance</div>
                    <div className="text-2xl font-bold text-[rgb(var(--danger-text))]">{maintenanceVehicles}</div>
                </div>
            </div>

            {/* Notification */}
            {notification && (
                <div className={`p-4 rounded-xl flex items-center gap-3 animate-in slide-in-from-top ${notification.type === 'success'
                    ? 'bg-[rgb(var(--success-bg))] border border-[rgb(var(--success))]/40 text-[rgb(var(--success-text))]'
                    : 'bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 text-[rgb(var(--danger-text))]'
                    }`}>
                    <AlertCircle size={20} />
                    <span>{notification.message}</span>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="p-4 bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 rounded-xl flex items-center gap-3">
                    <AlertCircle size={20} className="text-[rgb(var(--danger-text))]" />
                    <span className="text-[rgb(var(--danger-text))]">{error}</span>
                </div>
            )}

            {/* Vehicle List */}
            <VehicleList
                vehicles={vehicles}
                loading={loading}
                onEdit={handleEditVehicle}
                onDelete={(vehicle) => setDeleteConfirm(vehicle)}
            />

            {/* Add/Edit Vehicle Form Modal */}
            {showForm && (
                <VehicleForm
                    vehicle={editingVehicle}
                    onClose={handleFormClose}
                    onSuccess={handleFormSuccess}
                />
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-modal p-4">
                    <div className="clay-card max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 rounded-full bg-[rgb(var(--danger-bg))] flex items-center justify-center">
                                <AlertCircle size={24} className="text-[rgb(var(--danger-text))]" />
                            </div>
                            <div>
                                <h3 className="font-header font-bold text-lg text-coffee">Delete Vehicle?</h3>
                                <p className="text-sm text-coffee-500">
                                    This action cannot be undone.
                                </p>
                            </div>
                        </div>

                        <div className="clay-card bg-cream p-4 rounded-xl mb-6">
                            <p className="font-medium text-coffee">
                                {deleteConfirm.name}
                            </p>
                            <p className="text-sm text-coffee-500 font-mono">{deleteConfirm.licensePlate}</p>
                        </div>

                        {deleteConfirm.status === 'in_use' ? (
                            <div className="p-4 bg-[rgb(var(--warning-bg))] border border-[rgb(var(--warning))]/40 rounded-xl mb-4">
                                <p className="text-sm text-[rgb(var(--warning-text))]">
                                    This vehicle is currently assigned to a driver.
                                    Please release the vehicle before deleting.
                                </p>
                            </div>
                        ) : null}

                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="flex-1 px-4 py-2 border border-mocha/30 text-mocha rounded-xl font-semibold hover:bg-cream transition-colors"
                                disabled={isDeleting}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteVehicle}
                                className="flex-1 px-4 py-2 bg-[rgb(var(--danger-fill))] text-white rounded-xl font-semibold hover:bg-[rgb(var(--danger-fill))] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                disabled={isDeleting || deleteConfirm.status === 'in_use'}
                            >
                                {isDeleting ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        Deleting...
                                    </>
                                ) : (
                                    'Delete'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
