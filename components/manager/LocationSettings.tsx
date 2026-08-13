import React, { useState, useEffect } from 'react';
import { MapPin, Save, CheckCircle2, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../hooks/useSettings';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';
import { createManagerInvite, CreateInviteResult } from '../../src/utils/cloudFunctions';
import {
    isUsableDuration, DROPOFF_LEAD_MINUTES, PICKUP_LEAD_DAYS,
} from '../../src/constants/schedule';

/** Must match INVITE_TTL_DAYS in functions/src/utils/invites.ts. */
const INVITE_TTL_DAYS = 7;

export const LocationSettings: React.FC = () => {
    const { currentUser } = useAuth();
    const {
        sabhaLocation, sabhaStartTime, sabhaEndTime, loading,
        updateSabhaLocation, updateSabhaTimes,
    } = useSettings();

    const [address, setAddress] = useState('');
    const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
    const [startInput, setStartInput] = useState('');
    const [endInput, setEndInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Manager invites. `newInvite` holds the only copy of a freshly minted code
    // that will ever exist — Firestore stores a salted hash — so it is kept in
    // state until the manager dismisses it rather than cleared on a timer.
    const [inviteLabel, setInviteLabel] = useState('');
    const [minting, setMinting] = useState(false);
    const [newInvite, setNewInvite] = useState<CreateInviteResult | null>(null);
    const [inviteError, setInviteError] = useState<string | null>(null);

    const handleCreateInvite = async () => {
        setMinting(true);
        setInviteError(null);
        setNewInvite(null);
        try {
            setNewInvite(await createManagerInvite(inviteLabel.trim() || undefined));
            setInviteLabel('');
        } catch (err: unknown) {
            console.error('Error creating manager invite:', err);
            setInviteError(err instanceof Error ? err.message : 'Could not create an invite.');
        } finally {
            setMinting(false);
        }
    };

    // Initialize form with current settings from Firestore
    useEffect(() => {
        if (!loading && sabhaLocation) {
            setAddress(sabhaLocation.address);
        }
    }, [loading, sabhaLocation]);

    useEffect(() => {
        if (!loading) {
            setStartInput(sabhaStartTime);
            setEndInput(sabhaEndTime);
        }
    }, [loading, sabhaStartTime, sabhaEndTime]);

    const timesChanged = startInput !== sabhaStartTime || endInput !== sabhaEndTime;
    // Same rule the Calendar enforces, not a weaker one. These values now prefill
    // the "Add a sabha" form, so a pair this screen accepted but that screen
    // rejected (anything under 16 minutes — drop-off would open before the sabha
    // started) would save here and then block the manager there.
    const timesValid = isUsableDuration(startInput, endInput);
    const canSave = !!selectedPlace || (timesChanged && timesValid);

    const handlePlaceSelect = (details: PlaceDetails) => {
        setSelectedPlace(details);
        setAddress(details.formattedAddress);
        setErrorMsg(null);
        setSavedSuccess(false);
    };

    const handleSave = async () => {
        if (!currentUser) return;

        if (timesChanged && !timesValid) {
            setErrorMsg(`Sabha must run for more than ${DROPOFF_LEAD_MINUTES} minutes.`);
            return;
        }

        if (!canSave) {
            setErrorMsg('Nothing to save — change a time, or pick an address from the suggestions.');
            return;
        }

        setSaving(true);
        setErrorMsg(null);
        setSavedSuccess(false);

        try {
            if (selectedPlace) {
                await updateSabhaLocation(
                    {
                        lat: selectedPlace.latitude,
                        lng: selectedPlace.longitude,
                        address: selectedPlace.formattedAddress,
                    },
                    currentUser.uid
                );
            }
            if (timesChanged) {
                await updateSabhaTimes(startInput, endInput, currentUser.uid);
            }
            setSavedSuccess(true);
            setSelectedPlace(null); // Reset selection state after save
            setTimeout(() => setSavedSuccess(false), 3000);
        } catch (err: unknown) {
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
                <p className="text-xs text-gray-500 mt-0.5">
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
                        <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            Address selected — {selectedPlace.latitude.toFixed(6)}, {selectedPlace.longitude.toFixed(6)}
                        </p>
                    )}
                    {!selectedPlace && address.length >= 3 && address !== sabhaLocation.address && (
                        <p className="text-xs text-gray-500 mt-1">
                            Please select an address from the suggestions
                        </p>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                            Default Start
                        </label>
                        <input
                            type="time"
                            value={startInput}
                            onChange={(e) => {
                                setStartInput(e.target.value);
                                setSavedSuccess(false);
                                setErrorMsg(null);
                            }}
                            disabled={saving}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                            Default End
                        </label>
                        <input
                            type="time"
                            value={endInput}
                            onChange={(e) => {
                                setEndInput(e.target.value);
                                setSavedSuccess(false);
                                setErrorMsg(null);
                            }}
                            disabled={saving}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron disabled:opacity-50"
                        />
                    </div>
                </div>

                <div className="bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2 space-y-1">
                    {/*
                      These prefill the "Add a sabha" form in the Calendar (see
                      newSabhaTimes there). Once an event exists it carries its own
                      times, so changing this does not move a sabha already on the
                      calendar. Saying so plainly, because a manager changing this
                      expecting tonight to move is exactly the kind of quiet
                      mismatch this app has been full of.
                    */}
                    <p className="text-xs text-gray-600">
                        Prefills the times when you{' '}
                        <span className="font-semibold">add a new sabha</span> below. To change a
                        sabha already on the calendar, edit it in{' '}
                        <span className="font-semibold">Sabha Calendar</span> above.
                    </p>
                    <p className="text-xs text-gray-600">
                        Ride requests open{' '}
                        <span className="font-semibold">{PICKUP_LEAD_DAYS} days before</span> each
                        sabha. Drop-off opens{' '}
                        <span className="font-semibold">
                            {DROPOFF_LEAD_MINUTES} minutes before it ends
                        </span>.
                    </p>
                    {timesChanged && !timesValid && (
                        <p className="text-xs text-red-600 font-semibold">
                            Sabha must run for more than {DROPOFF_LEAD_MINUTES} minutes.
                        </p>
                    )}
                </div>

                {/* Status Messages */}
                {errorMsg && (
                    <div className="flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                        <AlertCircle size={14} />
                        <span className="text-xs">{errorMsg}</span>
                    </div>
                )}
                {savedSuccess && (
                    <div className="flex items-center gap-2 text-green-800 bg-green-50 px-3 py-2 rounded-lg">
                        <CheckCircle2 size={14} />
                        <span className="text-xs">Location updated successfully!</span>
                    </div>
                )}

                <button
                    onClick={handleSave}
                    disabled={saving || !canSave}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-saffron text-white rounded-lg font-semibold text-sm hover:bg-saffron/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    {saving ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <Save size={16} />
                    )}
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>

            {/* ── Manager invites ─────────────────────────────────────────── */}
            <div className="border-t border-gray-100 p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <KeyRound size={16} className="text-saffron" />
                    <h3 className="text-sm font-bold text-gray-800">Manager invites</h3>
                </div>

                <p className="text-xs text-gray-500">
                    Creates a single-use code that expires in {INVITE_TTL_DAYS} days. Give it to
                    one person. You will see it once — it is stored scrambled, so it cannot be
                    looked up later.
                </p>

                <input
                    type="text"
                    value={inviteLabel}
                    onChange={(e) => setInviteLabel(e.target.value)}
                    placeholder="Who is this for? (optional, for your records)"
                    className="w-full px-3 py-2 rounded-lg border border-mocha/20 text-sm focus:outline-none focus:border-saffron bg-white"
                    disabled={minting}
                />

                <button
                    onClick={handleCreateInvite}
                    disabled={minting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-saffron text-saffron rounded-lg font-semibold text-sm hover:bg-saffron/5 disabled:opacity-50 transition-all"
                >
                    {minting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                    {minting ? 'Creating…' : 'Create an invite'}
                </button>

                {inviteError && (
                    <div className="flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                        <AlertCircle size={14} />
                        <span className="text-xs">{inviteError}</span>
                    </div>
                )}

                {/* Shown once. Nothing can retrieve it again, so it stays on screen
                    until the manager dismisses it rather than auto-hiding. */}
                {newInvite && (
                    <div className="bg-green-50 border-2 border-green-200 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-bold text-green-900">
                            Copy this now — it will not be shown again
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 font-mono text-sm bg-white px-3 py-2 rounded border border-green-200 tracking-wider select-all break-all">
                                {newInvite.code}
                            </code>
                            <button
                                onClick={() => navigator.clipboard?.writeText(newInvite.code)}
                                className="px-3 py-2 text-xs font-semibold text-green-900 border border-green-300 rounded hover:bg-green-100"
                            >
                                Copy
                            </button>
                        </div>
                        <p className="text-[11px] text-green-800">
                            Expires {new Date(newInvite.expiresAt).toLocaleDateString()}. Single use.
                        </p>
                        <button
                            onClick={() => setNewInvite(null)}
                            className="text-[11px] text-green-900 underline"
                        >
                            Done, hide it
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
