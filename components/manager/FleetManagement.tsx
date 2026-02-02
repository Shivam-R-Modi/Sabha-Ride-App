import React, { useState } from 'react';
import { Car as Vehicle } from '../../types';
import { useVehicles, updateVehicle, releaseVehicle } from '../../hooks/useFirestore';
import { Car, Plus, Trash2, Edit2, X, Save, ChevronUp, Loader2 } from 'lucide-react';
import { addCarToFleet, removeCarFromFleet } from '../../src/utils/cloudFunctions';

interface FleetManagementProps {
    onClose: () => void;
}

export const FleetManagement: React.FC<FleetManagementProps> = ({ onClose }) => {
    const { vehicles, loading } = useVehicles();
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const [formData, setFormData] = useState<Partial<Vehicle>>({
        model: '', color: '', licensePlate: '', capacity: 7, status: 'available'
    });

    const resetForm = () => {
        setFormData({ model: '', color: '', licensePlate: '', capacity: 7, status: 'available' });
        setIsAdding(false);
        setEditingId(null);
    };

    const handleSave = async () => {
        if (!formData.model || !formData.licensePlate) return;

        setIsSaving(true);
        try {
            if (editingId) {
                await updateVehicle(editingId, formData);
            } else {
                // Use Cloud Function to add car
                await addCarToFleet(
                    formData.model,
                    formData.color || '',
                    formData.licensePlate,
                    formData.capacity || 4
                );
            }
            resetForm();
        } catch (e: any) {
            console.error(e);
            alert(e.message || 'Failed to save vehicle');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (carId: string) => {
        if (!confirm("Delete vehicle?")) return;

        try {
            await removeCarFromFleet(carId);
        } catch (e: any) {
            console.error(e);
            alert(e.message || 'Failed to delete vehicle');
        }
    };

    const handleEdit = (v: Vehicle) => {
        setEditingId(v.id);
        setFormData({
            model: v.model,
            color: v.color,
            licensePlate: v.licensePlate,
            capacity: v.capacity,
            status: v.status
        });
        setIsAdding(true);
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
            <div className="bg-white rounded-none sm:rounded-3xl w-full max-w-5xl h-full sm:h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-cream shrink-0 pt-safe">
                    <div className="flex items-center gap-3">
                        <div className="bg-orange-100 p-2 rounded-xl text-saffron hidden sm:flex">
                            <Car size={24} />
                        </div>
                        <div>
                            <h2 className="font-header font-bold text-lg sm:text-xl text-coffee">Fleet Management</h2>
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{vehicles.length} Total Vehicles</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 hover:bg-gray-100 rounded-full text-gray-400 btn-feedback">
                        <X size={28} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col md:flex-row relative">
                    {/* List Section */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
                        {!isAdding && (
                            <button
                                onClick={() => setIsAdding(true)}
                                className="w-full py-4 border-2 border-dashed border-gold/30 rounded-2xl flex items-center justify-center gap-3 text-gold hover:bg-orange-50 transition-all font-bold text-sm btn-feedback bg-white shadow-sm"
                            >
                                <Plus size={20} /> Add New Vehicle
                            </button>
                        )}

                        {loading ? (
                            <div className="text-center py-20 opacity-50"><p className="text-xs font-bold animate-pulse">Scanning Garage...</p></div>
                        ) : (
                            vehicles.map(v => (
                                <div key={v.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${v.status === 'in-use' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                                            <Car size={20} />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-coffee text-sm sm:text-base truncate">{v.name}</h4>
                                            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-gray-500 font-bold uppercase tracking-tighter">
                                                <span className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-coffee">{v.plateNumber}</span>
                                                <span className="truncate">{v.color}</span>
                                                <span className="shrink-0">{v.capacity} Seats</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => handleEdit(v)} className="p-3 text-gray-400 hover:text-coffee btn-feedback">
                                            <Edit2 size={18} />
                                        </button>
                                        <button onClick={() => handleDelete(v.id)} className="p-3 text-gray-300 hover:text-red-500 btn-feedback">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                        <div className="h-20 sm:hidden"></div> {/* Mobile padding */}
                    </div>

                    {/* Edit Panel - Sidebar on Desktop, Bottom Sheet on Mobile */}
                    <div className={`
                        fixed inset-x-0 bottom-0 z-50 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.2)] transition-transform duration-300 transform rounded-t-[2.5rem]
                        md:relative md:inset-auto md:w-96 md:shadow-none md:border-l md:rounded-none md:translate-y-0
                        ${isAdding ? 'translate-y-0' : 'translate-y-full md:hidden'}
                    `}>
                        <div className="p-6 pb-safe">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="font-bold text-lg text-coffee">{editingId ? 'Edit Vehicle' : 'Register Vehicle'}</h3>
                                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Seva Fleet Asset</p>
                                </div>
                                <button onClick={resetForm} className="p-2 text-gray-400 md:hidden btn-feedback"><X size={28} /></button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Make & Model</label>
                                    <input
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full p-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-gold/30 focus:bg-white outline-none transition-all text-base font-medium"
                                        placeholder="e.g. Toyota Sienna"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Plate</label>
                                        <input
                                            value={formData.plateNumber}
                                            onChange={e => setFormData({ ...formData, plateNumber: e.target.value })}
                                            className="w-full p-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-gold/30 focus:bg-white outline-none transition-all text-base uppercase font-mono"
                                            placeholder="ABC-123"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Color</label>
                                        <input
                                            value={formData.color}
                                            onChange={e => setFormData({ ...formData, color: e.target.value })}
                                            className="w-full p-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-gold/30 focus:bg-white outline-none transition-all text-base font-medium"
                                            placeholder="Silver"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Seats Available</label>
                                    <div className="grid grid-cols-5 gap-2">
                                        {[4, 5, 6, 7, 8].map(cap => (
                                            <button
                                                key={cap}
                                                onClick={() => setFormData({ ...formData, capacity: cap })}
                                                className={`py-3 rounded-xl font-bold text-sm border-2 transition-all btn-feedback ${formData.capacity === cap ? 'bg-coffee text-white border-coffee shadow-lg' : 'bg-white text-gray-400 border-gray-100 hover:border-gold/30'}`}
                                            >
                                                {cap}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex gap-3">
                                <button onClick={resetForm} className="hidden md:flex flex-1 py-4 text-gray-400 font-bold hover:text-coffee transition-colors uppercase text-xs tracking-widest">Cancel</button>
                                <button
                                    onClick={handleSave}
                                    className="flex-[2] py-4 bg-saffron text-white rounded-2xl font-bold shadow-xl shadow-orange-100 flex items-center justify-center gap-2 hover:bg-saffron-dark btn-feedback transition-all uppercase text-xs tracking-widest"
                                >
                                    <Save size={18} /> {editingId ? 'Update' : 'Save'} Vehicle
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};