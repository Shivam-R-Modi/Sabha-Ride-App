/**
 * ProfileEditor — Editable profile form for all user roles.
 * Pre-fills from userProfile, writes back to Firestore on save.
 * Supports name, phone, and address (with Google Places autocomplete).
 */

import React, { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';
import { Save, X, CheckCircle, AlertCircle, Pencil } from 'lucide-react';

export const ProfileEditor: React.FC = () => {
    const { currentUser, userProfile, refreshProfile, logout } = useAuth();

    // Edit mode toggle
    const [isEditing, setIsEditing] = useState(false);

    // Form state — pre-fill from profile
    const [name, setName] = useState(userProfile?.name || '');
    const [phone, setPhone] = useState((userProfile as any)?.phone || '');
    const [address, setAddress] = useState(userProfile?.address || '');
    const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const roleLabel = (() => {
        const role = userProfile?.role || userProfile?.activeRole;
        if (role === 'manager') return 'Seva Manager';
        if (role === 'driver') return 'Volunteer Driver';
        return 'Student';
    })();

    const handlePlaceSelect = (details: PlaceDetails) => {
        setSelectedPlace(details);
        setAddress(details.formattedAddress);
        setError('');
    };

    const handleStartEdit = () => {
        // Re-sync form state from profile when entering edit mode
        setName(userProfile?.name || '');
        setPhone((userProfile as any)?.phone || '');
        setAddress(userProfile?.address || '');
        setSelectedPlace(null);
        setError('');
        setSuccess(false);
        setIsEditing(true);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setError('');
        setSuccess(false);
    };

    const handleSave = async () => {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }
        if (!phone.trim()) {
            setError('Phone number is required');
            return;
        }

        // If user changed address, they must select from autocomplete
        const addressChanged = address !== (userProfile?.address || '');
        if (addressChanged && !selectedPlace) {
            setError('Please select an address from the suggestions');
            return;
        }

        if (!currentUser) return;

        setLoading(true);
        setError('');
        setSuccess(false);

        try {
            const updateData: Record<string, any> = {
                name: name.trim(),
                phone: phone.trim(),
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name.trim())}&background=FF6B35&color=fff&size=200`,
            };

            // Only update location if a new place was selected
            if (selectedPlace) {
                updateData.address = selectedPlace.formattedAddress;
                updateData.location = {
                    latitude: selectedPlace.latitude,
                    longitude: selectedPlace.longitude,
                    formattedAddress: selectedPlace.formattedAddress,
                    placeId: selectedPlace.placeId,
                    geocodedAt: serverTimestamp(),
                };
                // Also update homeLocation for drivers (used by assignment algorithm)
                updateData.homeLocation = {
                    lat: selectedPlace.latitude,
                    lng: selectedPlace.longitude,
                    address: selectedPlace.formattedAddress,
                };
            }

            await setDoc(doc(db, 'users', currentUser.uid), updateData, { merge: true });
            await refreshProfile();

            setSuccess(true);
            setIsEditing(false);

            // Clear success after 3s
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            console.error('Error updating profile:', err);
            setError('Failed to save. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // ── Read-only view ──────────────────────────────────
    if (!isEditing) {
        return (
            <div className="p-8 md:p-12 text-center animate-in fade-in duration-500">
                <img
                    src={userProfile?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.name || 'U')}&background=FF6B35&color=fff&size=200`}
                    className="w-28 h-28 rounded-3xl mx-auto mb-5 border-4 border-white shadow-xl"
                    alt="Profile"
                />
                <h2 className="text-3xl font-header font-bold text-coffee">{userProfile?.name}</h2>
                <p className="text-gold font-bold uppercase tracking-widest mt-1">{roleLabel}</p>

                {success && (
                    <div className="mt-4 mx-auto max-w-sm flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl p-3 animate-in fade-in">
                        <CheckCircle size={16} />
                        Profile updated successfully!
                    </div>
                )}

                {/* Info cards */}
                <div className="mt-6 max-w-sm mx-auto space-y-3">
                    {userProfile?.email && (
                        <div className="clay-card flex items-center gap-4 text-left p-4">
                            <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                            </div>
                            <p className="text-sm text-mocha/70">{userProfile.email}</p>
                        </div>
                    )}

                    {(userProfile as any)?.phone && (
                        <div className="clay-card flex items-center gap-4 text-left p-4">
                            <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                            </div>
                            <p className="text-sm text-mocha/70">{(userProfile as any).phone}</p>
                        </div>
                    )}

                    {userProfile?.address && (
                        <div className="clay-card flex items-center gap-4 text-left p-4">
                            <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                            </div>
                            <p className="text-sm text-mocha/70 line-clamp-2">{userProfile.address}</p>
                        </div>
                    )}
                </div>

                {/* Edit & Sign Out buttons */}
                <div className="mt-8 max-w-sm mx-auto space-y-3">
                    <button
                        onClick={handleStartEdit}
                        className="clay-button w-full py-3 text-white bg-gradient-to-r from-saffron to-gold rounded-xl font-bold shadow-lg flex items-center justify-center gap-2"
                    >
                        <Pencil size={18} />
                        Edit Profile
                    </button>
                    <button
                        onClick={logout}
                        className="clay-button w-full py-3 text-white bg-gradient-to-r from-red-400 to-red-500 rounded-xl font-bold shadow-lg"
                    >
                        Sign Out
                    </button>
                </div>
            </div>
        );
    }

    // ── Edit mode ───────────────────────────────────────
    return (
        <div className="p-6 md:p-10 animate-in fade-in duration-300">
            <h2 className="text-2xl font-header font-bold text-coffee mb-6 text-center">Edit Profile</h2>

            <div className="max-w-md mx-auto space-y-5">
                {/* Name */}
                <div>
                    <label className="block text-sm font-medium text-coffee mb-2">
                        Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter your full name"
                        className="w-full px-4 py-3 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors"
                        disabled={loading}
                        required
                    />
                </div>

                {/* Phone */}
                <div>
                    <label className="block text-sm font-medium text-coffee mb-2">
                        Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="w-full px-4 py-3 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors"
                        disabled={loading}
                        required
                    />
                </div>

                {/* Address */}
                <div>
                    <label className="block text-sm font-medium text-coffee mb-2">
                        Address <span className="text-red-500">*</span>
                    </label>
                    <AddressAutocomplete
                        value={address}
                        onChange={(val) => {
                            setAddress(val);
                            if (selectedPlace && val !== selectedPlace.formattedAddress) {
                                setSelectedPlace(null);
                            }
                        }}
                        onSelect={handlePlaceSelect}
                        disabled={loading}
                        placeholder="Start typing your address…"
                    />
                    {selectedPlace && (
                        <p className="text-sm text-green-600 mt-1">✓ New address selected</p>
                    )}
                    {!selectedPlace && address !== (userProfile?.address || '') && address.length >= 3 && (
                        <p className="text-sm text-mocha/50 mt-1">Please select an address from suggestions</p>
                    )}
                    {!selectedPlace && address === (userProfile?.address || '') && (
                        <p className="text-xs text-mocha/40 mt-1">Address unchanged — leave as is or type a new one</p>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={handleCancel}
                        disabled={loading}
                        className="flex-1 py-3 rounded-xl border-2 border-mocha/20 text-coffee font-semibold hover:bg-mocha/5 transition-colors flex items-center justify-center gap-2"
                    >
                        <X size={18} />
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-saffron to-gold text-white font-semibold hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <Save size={18} />
                        {loading ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};
