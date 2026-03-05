import React, { useState, useEffect } from 'react';
import { Vehicle, VehicleFormData } from '../../types';
import { createVehicle, updateVehicle } from '../../hooks/useFirestore';
import { X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface VehicleFormProps {
    vehicle?: Vehicle | null;
    onClose: () => void;
    onSuccess: () => void;
}

const MIN_CAPACITY = 1;
const MAX_CAPACITY = 15;

export const VehicleForm: React.FC<VehicleFormProps> = ({ vehicle, onClose, onSuccess }) => {
    const [formData, setFormData] = useState<VehicleFormData>({
        name: '',
        color: '',
        licensePlate: '',
        capacity: 4
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    useEffect(() => {
        if (vehicle) {
            setFormData({
                name: vehicle.name,
                color: vehicle.color,
                licensePlate: vehicle.licensePlate,
                capacity: vehicle.capacity
            });
        }
    }, [vehicle]);

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        // Name validation
        if (!formData.name.trim()) {
            newErrors.name = 'Name is required';
        } else if (formData.name.trim().length < 2) {
            newErrors.name = 'Name must be at least 2 characters';
        }

        // Capacity validation
        if (formData.capacity < MIN_CAPACITY || formData.capacity > MAX_CAPACITY) {
            newErrors.capacity = `Capacity must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}`;
        }

        // Color validation
        if (!formData.color.trim()) {
            newErrors.color = 'Color is required';
        }

        // License plate validation (format: ABC-1234 or ABC1234)
        const licensePlateRegex = /^[A-Z]{2,3}[-]?[0-9]{3,4}$/i;
        if (!formData.licensePlate.trim()) {
            newErrors.licensePlate = 'License plate is required';
        } else if (!licensePlateRegex.test(formData.licensePlate.trim())) {
            newErrors.licensePlate = 'Invalid format (e.g., ABC-1234 or ABC1234)';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'capacity' ? parseInt(value) || value : value
        }));
        // Clear error when user starts typing
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);

        if (!validateForm()) {
            return;
        }

        setIsSubmitting(true);

        try {
            if (vehicle) {
                // Update existing vehicle
                await updateVehicle(vehicle.id, formData);
            } else {
                // Create new vehicle
                await createVehicle({
                    ...formData,
                    status: 'available',
                    currentDriverId: undefined
                });
            }
            setSubmitSuccess(true);
            setTimeout(() => {
                onSuccess();
            }, 1500);
        } catch (error) {
            console.error('Error saving vehicle:', error);
            setSubmitError(vehicle ? 'Failed to update vehicle. Please try again.' : 'Failed to create vehicle. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const commonInputClass = "w-full px-4 py-3 bg-white border border-mocha/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-saffron focus:border-transparent transition-all";
    const errorInputClass = "border-red-300 focus:ring-red-300";
    const labelClass = "block text-sm font-semibold text-coffee mb-1.5";
    const errorClass = "text-xs text-red-500 mt-1";

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="clay-card max-w-lg w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-cream-dark">
                    <h2 className="text-xl font-header font-bold text-coffee">
                        {vehicle ? 'Edit Vehicle' : 'Add New Vehicle'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-cream rounded-full transition-colors"
                        disabled={isSubmitting}
                    >
                        <X size={20} className="text-mocha" />
                    </button>
                </div>

                {/* Success Message */}
                {submitSuccess && (
                    <div className="mx-6 mt-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 animate-in slide-in-from-top">
                        <CheckCircle2 size={20} className="text-green-600" />
                        <span className="text-green-700 font-medium">
                            {vehicle ? 'Vehicle updated successfully!' : 'Vehicle created successfully!'}
                        </span>
                    </div>
                )}

                {/* Error Message */}
                {submitError && (
                    <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 animate-in slide-in-from-top">
                        <AlertCircle size={20} className="text-red-600" />
                        <span className="text-red-700">{submitError}</span>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Name */}
                    <div>
                        <label className={labelClass}>Name *</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g., School Bus 1"
                            className={`${commonInputClass} ${errors.name ? errorInputClass : ''}`}
                            disabled={isSubmitting}
                        />
                        {errors.name && <p className={errorClass}>{errors.name}</p>}
                    </div>

                    {/* Capacity & Color Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Seating Capacity *</label>
                            <input
                                type="number"
                                name="capacity"
                                value={formData.capacity}
                                onChange={handleChange}
                                min={MIN_CAPACITY}
                                max={MAX_CAPACITY}
                                className={`${commonInputClass} ${errors.capacity ? errorInputClass : ''}`}
                                disabled={isSubmitting}
                            />
                            {errors.capacity && <p className={errorClass}>{errors.capacity}</p>}
                        </div>
                        <div>
                            <label className={labelClass}>Color *</label>
                            <input
                                type="text"
                                name="color"
                                value={formData.color}
                                onChange={handleChange}
                                placeholder="e.g., Yellow"
                                className={`${commonInputClass} ${errors.color ? errorInputClass : ''}`}
                                disabled={isSubmitting}
                            />
                            {errors.color && <p className={errorClass}>{errors.color}</p>}
                        </div>
                    </div>

                    {/* License Plate */}
                    <div>
                        <label className={labelClass}>License Plate *</label>
                        <input
                            type="text"
                            name="licensePlate"
                            value={formData.licensePlate}
                            onChange={handleChange}
                            placeholder="e.g., ABC-1234"
                            className={`${commonInputClass} ${errors.licensePlate ? errorInputClass : ''}`}
                            disabled={isSubmitting}
                        />
                        {errors.licensePlate && <p className={errorClass}>{errors.licensePlate}</p>}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 border border-mocha/30 text-mocha rounded-xl font-semibold hover:bg-cream transition-colors"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-3 bg-saffron text-white rounded-xl font-semibold hover:bg-saffron/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    {vehicle ? 'Updating...' : 'Creating...'}
                                </>
                            ) : (
                                vehicle ? 'Update Vehicle' : 'Add Vehicle'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
