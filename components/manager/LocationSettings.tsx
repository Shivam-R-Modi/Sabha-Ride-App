import React, { useState, useEffect } from 'react';
import { MapPin, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../hooks/useSettings';
import { useLocations } from '../../hooks/useLocations';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';
import {
    isUsableDuration, DROPOFF_LEAD_MINUTES, PICKUP_LEAD_DAYS,
} from '../../src/constants/schedule';
import { messageOf } from '../../src/utils/errorText';

export const LocationSettings: React.FC = () => {
    const { currentUser } = useAuth();
    const {
        sabhaLocation, sabhaStartTime, sabhaEndTime, loading,
        updateSabhaLocation, updateSabhaTimes,
    } = useSettings();
    /**
     * The hall this screen is editing.
     *
     * ONE HALL TODAY, so there is nothing to disambiguate and no picker to offer — a
     * control with one option is a control that cannot do anything. A manager cannot
     * create a second hall from the UI yet, so `active[0]` is unambiguous by
     * construction; the per-hall version arrives with the release that adds the
     * picker, and `active.length` is asserted in the test so this cannot quietly start
     * editing an arbitrary hall.
     */
    const { active: openHalls, updateLocationVenue } = useLocations();
    const editingHall = openHalls.length === 1 ? openHalls[0] : null;

    const [address, setAddress] = useState('');
    const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
    const [startInput, setStartInput] = useState('');
    const [endInput, setEndInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Manager invites used to live on this page, under a heading about where
    // drivers are routed to. Granting someone manager rights is a people
    // decision, so it moved to the People page — components/manager/ManagerInvites.tsx.

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
                const venue = {
                    lat: selectedPlace.latitude,
                    lng: selectedPlace.longitude,
                    address: selectedPlace.formattedAddress,
                };

                /**
                 * WRITTEN TO BOTH PLACES, and that is the point of this release.
                 *
                 * Dispatch now resolves a venue as
                 * `event.venue → locations/{id}.venue → settings/main.sabhaLocation`.
                 * Writing only `settings/main` would leave this Save button reporting
                 * "Location updated successfully!" while changing nothing a driver is
                 * routed by — the dead control this codebase keeps removing, shipped
                 * by the change that introduced the new authority.
                 *
                 * Writing only the hall would be worse in the other direction: an
                 * un-refreshed phone still reads `settings/main` for the address it
                 * shows a rider, so the two would disagree about where sabha is.
                 *
                 * The hall FIRST, so a failure there aborts before the two can
                 * diverge. Keeping `settings/main` in step also means this release is
                 * revertible by redeploying functions alone.
                 */
                if (editingHall) {
                    await updateLocationVenue(editingHall.id, venue, currentUser.uid);
                }
                await updateSabhaLocation(venue, currentUser.uid);
            }
            if (timesChanged) {
                await updateSabhaTimes(startInput, endInput, currentUser.uid);
            }
            setSavedSuccess(true);
            setSelectedPlace(null); // Reset selection state after save
            setTimeout(() => setSavedSuccess(false), 3000);
        } catch (err: unknown) {
            console.error('[LocationSettings] Save error:', err);
            setErrorMsg(messageOf(err, 'Failed to save. Are you a manager?'));
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
        <div className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Sabha Location</h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    Set the venue address for rides. Changes apply immediately to all users.
                </p>
            </div>

            {/* Current Location Display */}
            <div className="px-4 py-3 border-b border-hairline/10 bg-[rgb(var(--warning-bg))]/50">
                <p className="text-xs text-coffee-500 mb-1">Current Location</p>
                <p className="text-sm font-medium text-coffee">{sabhaLocation.address}</p>
                <p className="text-xs text-coffee-500 mt-0.5">
                    {sabhaLocation.lat.toFixed(6)}, {sabhaLocation.lng.toFixed(6)}
                </p>
            </div>

            {/* Edit Form */}
            <div className="px-4 py-4 space-y-3">
                <div>
                    <label
                        htmlFor="sabha-new-address" className="block text-xs font-medium text-coffee-700 mb-1">
                        New Address
                    </label>
                    <AddressAutocomplete
                        id="sabha-new-address"
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
                        <p className="text-xs text-[rgb(var(--success-text))] mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            Address selected — {selectedPlace.latitude.toFixed(6)}, {selectedPlace.longitude.toFixed(6)}
                        </p>
                    )}
                    {!selectedPlace && address.length >= 3 && address !== sabhaLocation.address && (
                        <p className="text-xs text-coffee-500 mt-1">
                            Please select an address from the suggestions
                        </p>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* `min-w-0`: a grid child will not shrink below its own
                        content, and a native time control reports a wide
                        intrinsic size on iOS — enough to push this two-up row
                        past the card edge. Measured as a no-op where it already
                        fits, so it costs nothing where it is not needed. */}
                    <div className="min-w-0">
                        {/* `htmlFor` / `id`, which neither of these had. Two adjacent
                            unlabelled time fields are announced as "time" and "time",
                            so a screen reader user cannot tell start from end — and
                            tapping the visible text did not focus the input either. */}
                        <label
                            htmlFor="sabha-default-start"
                            className="block text-xs font-medium text-coffee-700 mb-1"
                        >
                            Default Start
                        </label>
                        <input
                            id="sabha-default-start"
                            type="time"
                            value={startInput}
                            onChange={(e) => {
                                setStartInput(e.target.value);
                                setSavedSuccess(false);
                                setErrorMsg(null);
                            }}
                            disabled={saving}
                            className="w-full px-3 py-2 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron disabled:opacity-50"
                        />
                    </div>
                    <div className="min-w-0">
                        <label
                            htmlFor="sabha-default-end"
                            className="block text-xs font-medium text-coffee-700 mb-1"
                        >
                            Default End
                        </label>
                        <input
                            id="sabha-default-end"
                            type="time"
                            value={endInput}
                            onChange={(e) => {
                                setEndInput(e.target.value);
                                setSavedSuccess(false);
                                setErrorMsg(null);
                            }}
                            disabled={saving}
                            className="w-full px-3 py-2 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron disabled:opacity-50"
                        />
                    </div>
                </div>

                <div className="bg-[rgb(var(--warning-bg))]/60 border border-[rgb(var(--warning))]/25 rounded-lg px-3 py-2 space-y-1">
                    {/*
                      These prefill the "Add a sabha" form in the Calendar (see
                      newSabhaTimes there). Once an event exists it carries its own
                      times, so changing this does not move a sabha already on the
                      calendar. Saying so plainly, because a manager changing this
                      expecting tonight to move is exactly the kind of quiet
                      mismatch this app has been full of.
                    */}
                    <p className="text-xs text-coffee-700">
                        Prefills the times when you{' '}
                        <span className="font-semibold">add a new sabha</span> below. To change a
                        sabha already on the calendar, edit it in{' '}
                        <span className="font-semibold">Sabha Calendar</span> above.
                    </p>
                    <p className="text-xs text-coffee-700">
                        Ride requests open{' '}
                        <span className="font-semibold">{PICKUP_LEAD_DAYS} days before</span> each
                        sabha. Drop-off opens{' '}
                        <span className="font-semibold">
                            {DROPOFF_LEAD_MINUTES} minutes before it ends
                        </span>.
                    </p>
                    {timesChanged && !timesValid && (
                        <p className="text-xs text-[rgb(var(--danger-text))] font-semibold">
                            Sabha must run for more than {DROPOFF_LEAD_MINUTES} minutes.
                        </p>
                    )}
                </div>

                {/* Status Messages */}
                {errorMsg && (
                    <div className="flex items-center gap-2 text-[rgb(var(--danger-text))] bg-[rgb(var(--danger-bg))] px-3 py-2 rounded-lg">
                        <AlertCircle size={14} />
                        <span className="text-xs">{errorMsg}</span>
                    </div>
                )}
                {savedSuccess && (
                    <div className="flex items-center gap-2 text-[rgb(var(--success-text))] bg-[rgb(var(--success-bg))] px-3 py-2 rounded-lg">
                        <CheckCircle2 size={14} />
                        <span className="text-xs">Location updated successfully!</span>
                    </div>
                )}

                <button
                    onClick={handleSave}
                    disabled={saving || !canSave}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] rounded-lg font-semibold text-sm hover:bg-[rgb(var(--cta-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    {saving ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <Save size={16} />
                    )}
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>

        </div>
    );
};
