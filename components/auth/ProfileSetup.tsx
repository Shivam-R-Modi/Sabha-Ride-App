import React, { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../../src/constants/tenancy';
import { useAuth } from '../../contexts/AuthContext';
import { AddressAutocomplete } from './AddressAutocomplete';
import { PhoneNumberInput } from './PhoneNumberInput';
import { PlaceDetails } from '../../hooks/useGooglePlaces';

interface ProfileSetupProps {
    role: string;
    email: string;
    /**
     * They have not landed in the USA yet, so DO NOT ASK FOR A HOME ADDRESS.
     *
     * This screen otherwise refuses to let anybody past without one picked from Google
     * Places suggestions, with coordinates. For somebody still in India that is either a
     * dead end or their Ahmedabad address written into `location` — which
     * `resolveHomeCoords` would hand to a Sarthi as a Friday pickup point.
     *
     * They are asked the moment they stop arriving: clearing `isArriving` drops them
     * back through the same gate in App.tsx, which is when a home address starts to mean
     * something. Most never see it, because the server seeds the address from their
     * pickup's destination when the trip completes.
     */
    arriving?: boolean;
    onComplete: () => void;
}

export const ProfileSetup: React.FC<ProfileSetupProps> = ({ role, email, arriving = false, onComplete }) => {
    const { currentUser } = useAuth();
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [phoneE164, setPhoneE164] = useState('');
    const [isPhoneValid, setIsPhoneValid] = useState(false);
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

        if (!isPhoneValid) {
            setError('Please enter a valid phone number');
            return;
        }

        // Skipped for an arriving traveller. The `disabled` attribute on the submit
        // button carries the same condition — both gates, or the button unlocks and the
        // handler still refuses.
        if (!arriving && !selectedPlace) {
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
                phone: phoneE164 || phone.trim(),
                // Spread rather than a conditional value, so an arriving traveller's
                // document carries NO `address` and NO `location` at all. Writing them
                // as empty or 0,0 would be worse than absent: `resolveHomeCoords`
                // treats 0,0 as "never geocoded" precisely because somebody once
                // stored it, and an empty address string would satisfy App.tsx's gate
                // and never be asked for again.
                ...(selectedPlace ? {
                    address: selectedPlace.formattedAddress,
                    location: {
                        latitude: selectedPlace.latitude,
                        longitude: selectedPlace.longitude,
                        formattedAddress: selectedPlace.formattedAddress,
                        placeId: selectedPlace.placeId,
                        geocodedAt: serverTimestamp(),
                    },
                } : {}),
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff&size=200`,
                // Belt and braces with RoleSelection. A profile is created there
                // and completed here, and either write can be the one that lands.
                cityId: FOUNDING_CITY_ID,
                locationId: FOUNDING_LOCATION_ID,
            }, { merge: true });

            onComplete();
        } catch (err: unknown) {
            console.error('Error saving profile:', err);
            setError('Failed to save profile. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-surface to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron-800 to-gold-700 text-[rgb(var(--text-on-accent))] py-8 text-center">
                <h1 className="text-3xl md:text-4xl font-header font-bold">Complete Your Profile</h1>
                <p className="text-sm md:text-base mt-2 opacity-90">
                    {role === 'student' && 'Bhulku Information'}
                    {role === 'driver' && 'Sarthi Information'}
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
                            <div className="px-4 py-3 rounded-xl border-2 border-mocha/10 bg-mocha/5 text-coffee-700">
                                {email}
                            </div>
                        </div>

                        {/* Name Input */}
                        <div>
                            <label className="block text-sm font-medium text-coffee mb-2">
                                Full Name <span className="text-[rgb(var(--danger-text))]">*</span>
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

                        {/* Phone Number Input */}
                        <PhoneNumberInput
                            value={phone}
                            onChange={(fullFormatted, e164, isValid) => {
                                setPhone(fullFormatted);
                                setPhoneE164(e164);
                                setIsPhoneValid(isValid);
                                setError('');
                            }}
                            disabled={loading}
                            required
                        />

                        {/* NOT RENDERED for an arriving traveller — see the `arriving`
                            prop. A disabled or empty address field would be a control
                            that cannot work; no field at all, plus the line below saying
                            when they will be asked, is the honest version. */}
                        {arriving ? (
                            <p className="text-sm text-coffee-500">
                                We will ask for your address here once you have landed —
                                for now, your pickup takes the destination you give it.
                            </p>
                        ) : (
                        <div>
                            <label className="block text-sm font-medium text-coffee mb-2">
                                Address <span className="text-[rgb(var(--danger-text))]">*</span>
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
                                <p className="text-sm text-[rgb(var(--success-text))] mt-1">
                                    ✓ Address selected
                                </p>
                            )}
                            {!selectedPlace && address.length >= 3 && (
                                <p className="text-sm text-coffee-500 mt-1">
                                    Please select an address from the suggestions
                                </p>
                            )}
                        </div>
                        )}
                    </div>

                    {error && (
                        <div className="bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 rounded-xl p-3">
                            <p className="text-[rgb(var(--danger-text))] text-sm">{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || (!arriving && !selectedPlace) || !isPhoneValid}
                        className="w-full bg-gradient-to-r from-saffron-800 to-gold-700 text-[rgb(var(--text-on-accent))] py-3 rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Saving…' : 'Complete Setup'}
                    </button>
                </form>
            </div>
        </div>
    );
};

