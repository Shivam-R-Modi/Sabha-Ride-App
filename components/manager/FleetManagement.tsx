import React, { useState, useEffect } from 'react';
import { useVehicles, deleteVehicle } from '../../hooks/useFirestore';
import { Vehicle } from '../../types';
import { VehicleForm } from './VehicleForm';
import { VehicleList } from './VehicleList';
import { Plus, Shield, Loader2, AlertCircle } from 'lucide-react';
import { managerReleaseVehicle } from '../../src/utils/cloudFunctions';
import { useConfirm } from '../shared/useConfirm';

export const FleetManagement: React.FC = () => {
    const { vehicles, loading, error } = useVehicles();

    const [showForm, setShowForm] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<Vehicle | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [releasingId, setReleasingId] = useState<string | null>(null);
    const { ask, confirmDialog } = useConfirm();
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

    /**
     * Hand a held car back to the fleet.
     *
     * Names the holder in the question, because "Release Car3?" and "Release Car3
     * from Tonny Stark?" are different decisions and only one of them can be made
     * safely from a list.
     *
     * Goes through the callable rather than writing here: freeing a car also
     * clears `currentVehicleId` on another user's document, and the server
     * refuses outright while that driver has a live ride. The error is surfaced
     * rather than swallowed — a Release that silently did nothing is exactly the
     * dead control this screen already had too much of.
     */
    const handleReleaseVehicle = async (vehicle: Vehicle) => {
        const holder = vehicle.currentDriverName;
        const confirmed = await ask({
            title: `Release ${vehicle.name}?`,
            message: holder
                ? `${holder} is holding this car. Releasing puts it back in the fleet `
                  + `and takes it off their shift.`
                : 'This car is marked in use but no driver is recorded against it. '
                  + 'Releasing puts it back in the fleet.',
            confirmLabel: 'Release',
        });
        if (!confirmed) return;

        setReleasingId(vehicle.id);
        try {
            await managerReleaseVehicle(vehicle.id);
            setNotification({
                type: 'success',
                message: `${vehicle.name} is back in the fleet.`,
            });
        } catch (error: unknown) {
            console.error('Error releasing vehicle:', error);
            setNotification({
                type: 'error',
                message: error instanceof Error ? error.message : 'Could not release that vehicle.',
            });
        } finally {
            setReleasingId(null);
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

    // "In Use" means HELD BY A DRIVER — a car goes in_use the moment it is picked,
    // long before anyone is assigned to it. The dashboard's "Out now" counts
    // drivers with live rides. The two are different quantities and used to share
    // the word "cars", so a fleet reading 3 In Use against Out now · 0 looked like
    // a bug rather than three drivers holding cars with nobody yet aboard.
    //
    // Splitting the number is the honest fix: a held car is unavailable to
    // everyone else whether or not it is moving, and an idle one is the first
    // thing worth chasing when riders are waiting.
    const heldWithoutDriverRecorded = vehicles.filter(
        v => v.status === 'in_use' && !v.currentDriverId).length;

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
                    {/* "Held", not "In Use". A car is held from the moment a driver
                        picks it, which is not the same as carrying anyone — the
                        dashboard's "Out now" counts drivers with live rides. The
                        old wording made those two numbers look like they should
                        agree. */}
                    <div className="text-sm text-[rgb(var(--info-text))]">Held by a driver</div>
                    <div className="text-2xl font-bold text-[rgb(var(--info-text))]">{inUseVehicles}</div>
                </div>
                <div className="clay-card p-4">
                    <div className="text-sm text-[rgb(var(--danger-text))]">Maintenance</div>
                    <div className="text-2xl font-bold text-[rgb(var(--danger-text))]">{maintenanceVehicles}</div>
                </div>
            </div>

            {/* Two things a manager needs told, not left to infer from counters. */}
            {availableVehicles === 0 && totalVehicles > 0 && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-[rgb(var(--warning-bg))]
                                border border-[rgb(var(--warning))]/30 text-[rgb(var(--warning-text))]">
                    <AlertCircle size={20} className="shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold">No cars are free.</p>
                        <p>
                            Every vehicle is held by a driver, so nobody else can go on shift.
                            Release one below if a driver has finished.
                        </p>
                    </div>
                </div>
            )}
            {heldWithoutDriverRecorded > 0 && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-[rgb(var(--warning-bg))]
                                border border-[rgb(var(--warning))]/30 text-[rgb(var(--warning-text))]">
                    <AlertCircle size={20} className="shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold">
                            {heldWithoutDriverRecorded === 1
                                ? '1 car is held with no driver recorded.'
                                : `${heldWithoutDriverRecorded} cars are held with no driver recorded.`}
                        </p>
                        {/* Every release path in the app starts from the driver's
                            record, so this car cannot be freed by anyone but a
                            manager. Saying so is the difference between a two-second
                            fix and an evening spent guessing. */}
                        <p>Nothing can free these automatically. Use Release below.</p>
                    </div>
                </div>
            )}

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
                onRelease={handleReleaseVehicle}
                releasingId={releasingId}
            />
            {confirmDialog}

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
