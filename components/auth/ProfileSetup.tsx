import React, { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { AddressAutocomplete } from './AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';

interface ProfileSetupProps {
    role: string;
    email: string;
    onComplete: () => void;
}

export const ProfileSetup: React.FC<ProfileSetupProps> = ({ role, email, onComplete }) => {
    const { currentUser } = useAuth();
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handlePlaceSelect = (details: PlaceDetails) => {
        setSelectedPlace(details);
        setAddress(details.formattedAddress);
        setError(''); // Clear any previous errors
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('Please enter your name');
            return;
        }

        if (!selectedPlace) {
            setError('Please select an address from the suggestions');
            return;
        }

        if (!currentUser) {
            setError('User not authenticated');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Save profile WITH coordinates to Firestore
            // Coordinates come directly from Google Places — no separate geocoding needed!
            await setDoc(doc(db, 'users', currentUser.uid), {
                name: name.trim(),
                address: selectedPlace.formattedAddress,
                location: {
                    latitude: selectedPlace.latitude,
                    longitude: selectedPlace.longitude,
                    formattedAddress: selectedPlace.formattedAddress,
                    placeId: selectedPlace.placeId,
                    geocodedAt: serverTimestamp(),
                },
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff&size=200`,
            }, { merge: true });

            onComplete();
        } catch (err: any) {
            console.error('Error saving profile:', err);
            setError('Failed to save profile. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-white to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron to-gold text-white py-8 text-center">
                <h1 className="text-3xl md:text-4xl font-header font-bold">Complete Your Profile</h1>
                <p className="text-sm md:text-base mt-2 opacity-90">
                    {role === 'student' && 'Student Information'}
                    {role === 'driver' && 'Driver Information'}
                    {role === 'manager' && 'Manager Information'}
                </p>
            </div>

            {/* Profile Form */}
            <div className="flex-1 flex items-center justify-center p-6">
                <form onSubmit={handleSubmit} className="clay-card max-w-md w-full p-8 space-y-6 animate-in fade-in zoom-in duration-500">
                    <div className="space-y-4">
                        {/* Email Display */}
                        <div>
                            <label className="block text-sm font-medium text-coffee mb-2">
                                Email
                            </label>
                            <div className="px-4 py-3 rounded-xl border-2 border-mocha/10 bg-mocha/5 text-mocha/70">
                                {email}
                            </div>
                        </div>

                        {/* Name Input */}
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

                        {/* Address Autocomplete */}
                        <div>
                            <label className="block text-sm font-medium text-coffee mb-2">
                                Address <span className="text-red-500">*</span>
                            </label>
                            <AddressAutocomplete
                                value={address}
                                onChange={(val) => {
                                    setAddress(val);
                                    // If user edits after selecting, clear the place data
                                    if (selectedPlace && val !== selectedPlace.formattedAddress) {
                                        setSelectedPlace(null);
                                    }
                                }}
                                onSelect={handlePlaceSelect}
                                disabled={loading}
                                placeholder="Start typing your address…"
                            />
                            {/* Selection confirmation */}
                            {selectedPlace && (
                                <p className="text-sm text-green-600 mt-1">
                                    ✓ Address selected
                                </p>
                            )}
                            {!selectedPlace && address.length >= 3 && (
                                <p className="text-sm text-mocha/50 mt-1">
                                    Please select an address from the suggestions
                                </p>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                            <p className="text-red-700 text-sm">{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !selectedPlace}
                        className="w-full bg-gradient-to-r from-saffron to-gold text-white py-3 rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Saving…' : 'Complete Setup'}
                    </button>
                </form>
            </div>
        </div>
    );
};
