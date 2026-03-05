import React, { useState, useEffect } from 'react';
import { MapPin, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../hooks/useSettings';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';

export const LocationSettings: React.FC = () => {
    const { currentUser } = useAuth();
    const { sabhaLocation, loading, updateSabhaLocation } = useSettings();

    const [address, setAddress] = useState('');
    const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Initialize form with current location from Firestore
    useEffect(() => {
        if (!loading && sabhaLocation) {
            setAddress(sabhaLocation.address);
        }
    }, [loading, sabhaLocation]);

    const handlePlaceSelect = (details: PlaceDetails) => {
        setSelectedPlace(details);
        setAddress(details.formattedAddress);
        setErrorMsg(null);
        setSavedSuccess(false);
    };

    const handleSave = async () => {
        if (!currentUser) return;

        if (!selectedPlace) {
            setErrorMsg('Please select an address from the suggestions.');
            return;
        }

        setSaving(true);
        setErrorMsg(null);
        setSavedSuccess(false);

        try {
            await updateSabhaLocation(
                {
                    lat: selectedPlace.latitude,
                    lng: selectedPlace.longitude,
                    address: selectedPlace.formattedAddress,
                },
                currentUser.uid
            );
            setSavedSuccess(true);
            setSelectedPlace(null); // Reset selection state after save
            setTimeout(() => setSavedSuccess(false), 3000);
        } catch (err: any) {
            console.error('[LocationSettings] Save error:', err);
            setErrorMsg(err.message || 'Failed to save. Are you a manager?');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-saffron" />
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-gray-800">Sabha Location</h3>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Set the venue address for rides. Changes apply immediately to all users.
                </p>
            </div>

            {/* Current Location Display */}
            <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/50">
                <p className="text-xs text-gray-500 mb-1">Current Location</p>
                <p className="text-sm font-medium text-gray-800">{sabhaLocation.address}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                    {sabhaLocation.lat.toFixed(6)}, {sabhaLocation.lng.toFixed(6)}
                </p>
            </div>

            {/* Edit Form */}
            <div className="px-4 py-4 space-y-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                        New Address
                    </label>
                    <AddressAutocomplete
                        value={address}
                        onChange={(val) => {
                            setAddress(val);
                            setSavedSuccess(false);
                            setErrorMsg(null);
                            // If user edits after selecting, clear the place data
                            if (selectedPlace && val !== selectedPlace.formattedAddress) {
                                setSelectedPlace(null);
                            }
                        }}
                        onSelect={handlePlaceSelect}
                        disabled={saving}
                        placeholder="Search for an address…"
                    />
                    {/* Selection confirmation */}
                    {selectedPlace && (
                        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            Address selected — {selectedPlace.latitude.toFixed(6)}, {selectedPlace.longitude.toFixed(6)}
                        </p>
                    )}
                    {!selectedPlace && address.length >= 3 && address !== sabhaLocation.address && (
                        <p className="text-xs text-gray-400 mt-1">
                            Please select an address from the suggestions
                        </p>
                    )}
                </div>

                {/* Status Messages */}
                {errorMsg && (
                    <div className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                        <AlertCircle size={14} />
                        <span className="text-xs">{errorMsg}</span>
                    </div>
                )}
                {savedSuccess && (
                    <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                        <CheckCircle2 size={14} />
                        <span className="text-xs">Location updated successfully!</span>
                    </div>
                )}

                <button
                    onClick={handleSave}
                    disabled={saving || !selectedPlace}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-saffron text-white rounded-lg font-semibold text-sm hover:bg-saffron/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    {saving ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <Save size={16} />
                    )}
                    {saving ? 'Saving...' : 'Update Location'}
                </button>
            </div>
        </div>
    );
};
