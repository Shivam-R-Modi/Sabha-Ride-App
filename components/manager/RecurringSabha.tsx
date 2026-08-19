import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Repeat, Loader2, AlertCircle, Check } from 'lucide-react';
import { db } from '../../firebase/config';
import { updateSabhaRecurrence } from '../../src/utils/cloudFunctions';
import { normaliseRecurrence, describeRule } from '../../src/utils/recurrence';
import { useToast } from '../../contexts/ToastContext';
import { isUsableDuration } from '../../src/constants/schedule';

/**
 * The recurring sabha pattern — ONE record, no horizon.
 *
 * Before this existed every gathering had to be added by hand, so the calendar
 * ran dry and the whole app went quiet — measured on 2026-08-15, `rideContext`
 * read `no-scheduled-event` and nobody could request a ride.
 *
 * The first version of this card asked how many weeks ahead to fill, because the
 * server materialised that many `events/{date}` documents. That is gone: the rule
 * IS the schedule, it repeats until a manager changes it, and there is no horizon
 * to choose. See src/utils/recurrence.ts.
 *
 * What the copy below has to make clear, because a manager cannot infer it:
 * editing the pattern changes every week that has not been edited individually,
 * while a week they DID edit or cancel keeps its own arrangements. That is the
 * behaviour the owner asked for — one week diverging leaves the rest alone — and
 * it is the opposite of the old "applies to dates not on the calendar yet".
 */

const DAYS = [
    { value: 0, short: 'Sun', full: 'Sunday' },
    { value: 1, short: 'Mon', full: 'Monday' },
    { value: 2, short: 'Tue', full: 'Tuesday' },
    { value: 3, short: 'Wed', full: 'Wednesday' },
    { value: 4, short: 'Thu', full: 'Thursday' },
    { value: 5, short: 'Fri', full: 'Friday' },
    { value: 6, short: 'Sat', full: 'Saturday' },
];

const RECURRENCE_DOC = 'settings/sabhaRecurrence';

export const RecurringSabha: React.FC = () => {
    const toast = useToast();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [enabled, setEnabled] = useState(false);
    const [days, setDays] = useState<number[]>([5]);
    const [start, setStart] = useState('19:00');
    const [end, setEnd] = useState('22:00');

    // Live, because a second manager changing this must not be silently overwritten
    // by whatever was on screen when this one opened the page.
    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, RECURRENCE_DOC),
            snap => {
                // Read through the same validator the server uses, so the form
                // cannot show a rule the server would refuse.
                const rule = normaliseRecurrence(snap.data());
                if (rule) {
                    setEnabled(rule.enabled);
                    setDays(rule.daysOfWeek);
                    setStart(rule.startTime);
                    setEnd(rule.endTime);
                }
                setLoading(false);
            },
            err => {
                console.error('[RecurringSabha] Could not read the pattern:', err);
                setError('Could not load the recurring schedule.');
                setLoading(false);
            },
        );
        return unsub;
    }, []);

    const toggleDay = (value: number) =>
        setDays(current => current.includes(value)
            ? current.filter(d => d !== value)
            : [...current, value].sort((a, b) => a - b));

    // Mirrors the server's own validation so the button can explain itself before
    // the round trip — never instead of it. The callable re-checks everything.
    const problem = days.length === 0
        ? 'Pick at least one day.'
        : !isUsableDuration(start, end)
            ? 'The end time must be later than the start, with enough room for drop-off.'
            : null;

    const handleSave = async () => {
        // Turning the pattern OFF is always allowed, whatever else is on screen —
        // otherwise a manager with a half-edited form cannot stop it repeating.
        if (enabled && problem) {
            setError(problem);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const result = await updateSabhaRecurrence({
                enabled,
                daysOfWeek: days,
                startTime: start,
                endTime: end,
            });

            // Reports the rule the SERVER stored, not what was on screen. If the
            // two ever disagree the manager should see the server's version.
            toast.success(!enabled
                ? 'Repeating turned off. Dates you edited individually are kept.'
                : `Saved. ${describeRule(result.rule)}, repeating until you change it.`);
        } catch (err: unknown) {
            console.error('[RecurringSabha] Save failed:', err);
            const message = err instanceof Error ? err.message : 'Could not save the schedule.';
            setError(message);
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-surface rounded-xl border border-hairline/20 shadow-sm mb-4
                            flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-saffron" />
                <span className="sr-only">Loading the recurring schedule</span>
            </div>
        );
    }

    return (
        <section
            className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden mb-4"
            aria-labelledby="recurring-sabha-heading"
        >
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <Repeat size={18} className="text-saffron" aria-hidden="true" />
                    <h3 id="recurring-sabha-heading" className="text-sm font-bold text-coffee">
                        Repeat every week
                    </h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    Set it once and every week is scheduled. Without this, a week
                    nobody adds by hand is a week with no rides.
                </p>
            </div>

            <div className="p-4 space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setEnabled(e.target.checked)}
                        className="w-5 h-5 rounded accent-[rgb(var(--cta))]"
                    />
                    <span className="text-sm font-semibold text-coffee">
                        Keep the calendar filled automatically
                    </span>
                </label>

                <fieldset disabled={!enabled} className={enabled ? '' : 'opacity-50'}>
                    <legend className="text-xs font-semibold text-coffee-700 mb-2">
                        Which day{days.length > 1 ? 's' : ''}?
                    </legend>
                    {/* A 4-wide grid, not flex-wrap. Seven chips sized to their
                        own labels wrapped 5 + 2 and left a ragged second row; a
                        grid gives 4 + 3 with every chip the same width. Not
                        7-across: that would put each chip under the 44px
                        minimum touch target at 390px. */}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                        {DAYS.map(day => {
                            const on = days.includes(day.value);
                            return (
                                <button
                                    key={day.value}
                                    type="button"
                                    onClick={() => toggleDay(day.value)}
                                    aria-pressed={on}
                                    aria-label={day.full}
                                    className={`min-w-11 min-h-11 px-3 rounded-xl text-xs font-semibold
                                                border-2 transition-colors ${on
                                            ? 'bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] border-transparent'
                                            : 'border-hairline/30 text-coffee-700 hover:bg-cream-300/60'}`}
                                >
                                    {day.short}
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        {/* `min-w-0`: a grid child will not shrink below its own
                            content, and a native time control reports a wide
                            intrinsic size on iOS — enough to push this two-up row
                            past the card edge. Measured as a no-op where it
                            already fits. */}
                        <label className="block min-w-0">
                            <span className="text-xs font-semibold text-coffee-700">Starts</span>
                            <input
                                type="time"
                                value={start}
                                onChange={e => setStart(e.target.value)}
                                className="mt-1 w-full min-h-11 px-3 rounded-xl border-2 border-hairline/30
                                           bg-surface text-sm text-coffee"
                            />
                        </label>
                        <label className="block min-w-0">
                            <span className="text-xs font-semibold text-coffee-700">Ends</span>
                            <input
                                type="time"
                                value={end}
                                onChange={e => setEnd(e.target.value)}
                                className="mt-1 w-full min-h-11 px-3 rounded-xl border-2 border-hairline/30
                                           bg-surface text-sm text-coffee"
                            />
                        </label>
                    </div>

                </fieldset>

                {/* The one thing a manager cannot infer, so it is stated. */}
                <p className="text-xs text-coffee-500 border-l-2 border-hairline/30 pl-3">
                    This repeats <strong>until you change it</strong> — there is no end date.
                    Changing it here updates every week except the ones you have edited or
                    cancelled individually; those keep their own arrangements.
                </p>

                {error && (
                    <div
                        role="alert"
                        className="flex items-start gap-2 text-[rgb(var(--danger-text))]
                                   bg-[rgb(var(--danger-bg))] px-3 py-2 rounded-lg"
                    >
                        <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="text-xs">{error}</span>
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full min-h-11 rounded-xl font-semibold text-sm
                               bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))]
                               hover:opacity-90 disabled:opacity-60 transition-opacity
                               flex items-center justify-center gap-2"
                >
                    {saving
                        ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Saving…</>
                        : <><Check size={16} aria-hidden="true" /> Save schedule</>}
                </button>
            </div>
        </section>
    );
};
