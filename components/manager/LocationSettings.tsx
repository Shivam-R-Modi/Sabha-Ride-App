import React, { useState, useEffect } from 'react';
import { Clock, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../hooks/useSettings';
import {
    isUsableDuration, DROPOFF_LEAD_MINUTES, PICKUP_LEAD_DAYS,
} from '../../src/constants/schedule';
import { messageOf } from '../../src/utils/errorText';

export const LocationSettings: React.FC = () => {
    const { currentUser } = useAuth();
    const {
        sabhaStartTime, sabhaEndTime, loading, updateSabhaTimes,
    } = useSettings();
    /**
     * THE ADDRESS EDITOR THAT USED TO BE HERE IS GONE, and it had to be.
     *
     * It wrote a hall's venue only when EXACTLY ONE was open — a deliberate guard while
     * a manager could not create a second one. The moment a second hall was opened that
     * condition went false, so Save reported "Location updated successfully!" and wrote
     * only `settings/main.sabhaLocation`, which loses to `locations/{id}.venue` in
     * `resolveVenue`. A button that says it moved sabha and moves nothing.
     *
     * Addresses now live in `HallManagement`, per hall, with the hall named on the row —
     * so there is nothing here to be ambiguous about. This card keeps the DEFAULT TIMES,
     * which are genuinely global.
     */
    const [startInput, setStartInput] = useState('');
    const [endInput, setEndInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Manager invites used to live on this page, under a heading about where
    // drivers are routed to. Granting someone manager rights is a people
    // decision, so it moved to the People page — components/manager/ManagerInvites.tsx.

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
    const canSave = timesChanged && timesValid;

    const handleSave = async () => {
        if (!currentUser) return;

        if (timesChanged && !timesValid) {
            setErrorMsg(`Sabha must run for more than ${DROPOFF_LEAD_MINUTES} minutes.`);
            return;
        }

        if (!canSave) {
            setErrorMsg('Nothing to save — change a time first.');
            return;
        }

        setSaving(true);
        setErrorMsg(null);
        setSavedSuccess(false);

        try {
            if (timesChanged) {
                await updateSabhaTimes(startInput, endInput, currentUser.uid);
            }
            setSavedSuccess(true);
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
                    <Clock size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Default sabha times</h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    Used when a gathering has no time of its own. Addresses are set per
                    location above.
                </p>
            </div>

            {/* Edit Form */}
            <div className="px-4 py-4 space-y-3">
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
