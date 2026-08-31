import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Loader2, AlertCircle, CheckCircle2, BellOff } from 'lucide-react';
import { db } from '../../firebase/config';
import { useConfirm } from '../shared/useConfirm';
import { updateNotificationSettings } from '../../src/utils/cloudFunctions';
import {
    ALERT_BAND_CHOICES,
    MAX_ALERT_BANDS,
    NUDGE_COOLDOWN_CHOICES,
    NotificationKey,
    NotificationService,
    NotificationSettings as Settings,
    catalogueFor,
    resolveNotificationSettings,
} from '../../src/constants/notifications';

/**
 * Which notifications go out, and how often. Managers only.
 *
 * SPLIT BY SERVICE, WHICH IS WHY THIS TAKES A PROP. Airport rows render on the
 * Arrivals board and sabha rows render in Setup, because that is where each set is
 * already being thought about — a coordinator watching an arrivals board should not
 * have to leave Airport Seva to stop the 5am escalation, and somebody setting the ride
 * window is already on the screen that decides when requests open. One combined panel
 * would have put fourteen rows in front of somebody who came to change one.
 *
 * The catalogue decides the split, not this file: `catalogueFor(service)` reads the
 * same table the server enforces, so a notification can never be missing from both
 * halves. tests/quality/notification-catalogue-parity.test.ts asserts every entry
 * belongs to exactly one service and that neither side is empty.
 *
 * WHAT IS DELIBERATELY READ-ONLY: the message text, shown as the row's own
 * description. It is a privacy control rather than a preference — no rider names, no
 * addresses, no destinations, because a push lands on a lock screen that may belong to
 * a child. See the copy notes in functions/src/utils/notifications.ts.
 *
 * SAVES THROUGH A CALLABLE, not a direct write, even though the Firestore rule would
 * allow one. The rule can check who is writing but not what, cannot write the audit
 * row, and cannot drop the server's cache. See updateNotificationSettings.ts.
 */

const SETTINGS_PATH = ['settings', 'notifications'] as const;

interface Props {
    service: NotificationService;
}

export const NotificationSettings: React.FC<Props> = ({ service }) => {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const { ask, confirmDialog } = useConfirm();

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, ...SETTINGS_PATH),
            // Through the same resolver the server uses, so this screen shows the
            // configuration that is actually being enforced rather than the raw
            // document. A missing document is the shipped defaults, not an error.
            (snap) => setSettings(resolveNotificationSettings(snap.data())),
            (err) => {
                console.error('[NotificationSettings] Listener error:', err);
                setError('Could not read the current settings.');
            },
        );
        return unsub;
    }, []);

    const save = async (next: Settings) => {
        setSaving(true);
        setError(null);
        try {
            await updateNotificationSettings(next);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (err: unknown) {
            console.error('[NotificationSettings] Save failed:', err);
            setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
            // NOT rolled back in local state: the snapshot listener is the source of
            // truth and will put the old value back on its own. Writing it here as
            // well would fight the listener and flicker.
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (key: NotificationKey, important: boolean, label: string) => {
        if (!settings) return;
        const turningOff = settings.enabled[key];

        // Asked TWICE for the four that strand somebody — a Sarthi parked outside, a
        // traveller in an arrivals hall, a rider waiting for a cancelled sabha. Not
        // disabled, because a switch that cannot move and does not say why is the
        // same dead control this app keeps removing, and there are legitimate reasons
        // to silence any of them.
        if (turningOff && important) {
            const ok = await ask({
                title: `Switch off "${label}"?`,
                message: 'Nobody will be told. This is one of the notifications people'
                    + ' rely on — they may be left waiting with no way to know.',
                confirmLabel: 'Yes, switch it off',
                destructive: true,
            });
            if (!ok) return;
        }

        await save({
            ...settings,
            enabled: { ...settings.enabled, [key]: !turningOff },
        });
    };

    if (!settings) {
        return (
            <div className="flex items-center gap-2 p-4 text-sm text-coffee-500">
                <Loader2 size={16} className="animate-spin" />
                Loading settings…
            </div>
        );
    }

    const rows = catalogueFor(service);
    const anyOff = rows.some(spec => !settings.enabled[spec.key]);

    return (
        <div className="space-y-3">
            {confirmDialog}

            {/*
              * Stated up front rather than per row. A manager who muted something a
              * week ago and forgot is exactly who needs to see this, and hunting for
              * a grey switch among fourteen is how it stays forgotten.
              */}
            {anyOff && (
                <p className="flex items-start gap-2 rounded-xl bg-warning-bg p-3 text-sm text-warning-text">
                    <BellOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Some notifications below are switched off. Nobody is being told.</span>
                </p>
            )}

            {rows.map(spec => {
                const on = settings.enabled[spec.key];
                return (
                    <div
                        key={spec.key}
                        className="rounded-2xl border border-hairline/10 bg-surface p-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-semibold text-coffee">{spec.label}</p>
                                <p className="text-sm text-coffee-500">{spec.trigger}</p>
                                <p className="mt-1 text-xs text-text-soft">To: {spec.audience}</p>
                            </div>

                            {/*
                              * A real checkbox, styled — not a div with a click
                              * handler. It is reachable by keyboard, announced as a
                              * switch, and picks up the platform's own focus ring.
                              */}
                            <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                                <span className="sr-only">{`${spec.label} notifications`}</span>
                                <input
                                    type="checkbox"
                                    role="switch"
                                    checked={on}
                                    disabled={saving}
                                    onChange={() => toggle(spec.key, !!spec.important, spec.label)}
                                    className="peer sr-only"
                                />
                                {/*
                                  * BOTH PARTS ARE OUTLINED, and the outline is not
                                  * decoration. Measured in the harness: the OFF track
                                  * is `--sunken` and the card behind it is `--surface`,
                                  * which is 1.31:1 in light mode — and the knob is
                                  * `--surface` too, so it scored 1.31 against the track
                                  * it sits in. WCAG 1.4.11 asks 3:1 for the boundary of
                                  * a control, and at 1.31 you genuinely cannot see
                                  * which side the knob is on: the whole switch reads as
                                  * one faint smudge.
                                  *
                                  * `--text-soft` is 6.07:1 on the card and clears 3:1
                                  * against both fills in both themes, so one border
                                  * token fixes the track and the knob together. Kept on
                                  * the ON state as well — a switch that gains and loses
                                  * its outline as it flips looks like two controls.
                                  *
                                  * This is the same family as the calendar badge that
                                  * was painted `--sunken` on a `--sunken` cell: a token
                                  * checked against `--canvas` and then used somewhere
                                  * else.
                                  */}
                                <span
                                    aria-hidden="true"
                                    className="h-6 w-11 rounded-full border border-[rgb(var(--text-soft))]
                                        bg-cream-400 transition-colors
                                        peer-checked:bg-[rgb(var(--cta))] peer-focus-visible:ring-2
                                        peer-focus-visible:ring-cta peer-focus-visible:ring-offset-2"
                                />
                                <span
                                    aria-hidden="true"
                                    className="absolute left-0.5 h-5 w-5 rounded-full
                                        border border-[rgb(var(--text-soft))] bg-surface
                                        shadow transition-transform peer-checked:translate-x-5"
                                />
                            </label>
                        </div>

                        {on && spec.frequency !== 'none' && (
                            <div className="mt-3 border-t border-hairline/10 pt-3">
                                {spec.frequency === 'bands' && (
                                    <BandPicker
                                        bands={settings.alertBands}
                                        disabled={saving}
                                        onChange={(alertBands) => save({ ...settings, alertBands })}
                                    />
                                )}
                                {spec.frequency === 'cooldown' && (
                                    <Choice
                                        label="Wait this long before the same rider can be nudged again"
                                        value={settings.nudgeCooldownSec}
                                        options={NUDGE_COOLDOWN_CHOICES.map(sec => ({
                                            value: sec,
                                            label: sec < 60 ? `${sec} seconds` : `${sec / 60} minutes`,
                                        }))}
                                        disabled={saving}
                                        onChange={(nudgeCooldownSec) =>
                                            save({ ...settings, nudgeCooldownSec })}
                                    />
                                )}
                                {spec.frequency === 'reminder' && (
                                    <div className="space-y-3">
                                        <Choice
                                            label="How often"
                                            value={settings.reminderCadence}
                                            options={[
                                                { value: 'daily', label: 'Every day the window is open' },
                                                { value: 'day-before', label: 'Only the day before sabha' },
                                            ]}
                                            disabled={saving}
                                            onChange={(reminderCadence) =>
                                                save({ ...settings, reminderCadence })}
                                        />
                                        <Choice
                                            label="What time"
                                            value={settings.reminderHour}
                                            options={HOURS}
                                            disabled={saving}
                                            onChange={(reminderHour) =>
                                                save({ ...settings, reminderHour })}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {error && (
                <p className="flex items-center gap-2 text-sm text-danger-text" role="alert">
                    <AlertCircle size={16} aria-hidden="true" />
                    {error}
                </p>
            )}
            {saved && (
                <p className="flex items-center gap-2 text-sm text-success-text">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Saved. Phones follow within a minute.
                </p>
            )}
        </div>
    );
};

/** 12am … 11pm, so nobody has to think in 24-hour time to set a reminder. */
const HOURS = Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'am' : 'pm'}`,
}));

/**
 * A labelled native select.
 *
 * NATIVE, deliberately, matching the date and time inputs elsewhere in this app — see
 * tests/quality/native-date-time-inputs.test.ts. On a phone it opens the platform
 * picker, which is bigger, scrollable and accessible for free.
 */
function Choice<T extends string | number>({ label, value, options, disabled, onChange }: {
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    disabled?: boolean;
    onChange: (value: T) => void;
}) {
    const id = React.useId();
    return (
        <div>
            <label htmlFor={id} className="block text-xs font-semibold text-coffee-500">
                {label}
            </label>
            <select
                id={id}
                value={String(value)}
                disabled={disabled}
                onChange={(e) => {
                    const picked = options.find(o => String(o.value) === e.target.value);
                    if (picked) onChange(picked.value);
                }}
                className="mt-1 w-full rounded-xl border border-hairline/20 bg-canvas p-2 text-sm text-coffee"
            >
                {options.map(o => (
                    <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                ))}
            </select>
        </div>
    );
}

/**
 * The escalation ladder, as toggle chips.
 *
 * A FIXED SET RATHER THAN A NUMBER FIELD. `alertUnclaimedArrivals` runs every thirty
 * minutes, so a band tighter than an hour cannot be honoured — it would fire up to
 * half an hour late and announce "in under 30 minutes" while the plane is on the
 * ground. A number box would let a manager set a promise the scheduler is physically
 * unable to keep.
 *
 * The last remaining band cannot be removed. An empty list is ambiguous — "never
 * alert" is what the switch above is for — and `resolveAlertBands` would read it as a
 * broken save and restore the defaults, so the chip would appear to do nothing.
 */
function BandPicker({ bands, disabled, onChange }: {
    bands: number[];
    disabled?: boolean;
    onChange: (bands: number[]) => void;
}) {
    const atLimit = bands.length >= MAX_ALERT_BANDS;

    return (
        <fieldset>
            <legend className="text-xs font-semibold text-coffee-500">
                Warn this many hours before landing
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
                {ALERT_BAND_CHOICES.map(hours => {
                    const picked = bands.includes(hours);
                    const last = picked && bands.length === 1;
                    return (
                        <button
                            key={hours}
                            type="button"
                            aria-pressed={picked}
                            disabled={disabled || last || (!picked && atLimit)}
                            onClick={() => onChange(
                                picked ? bands.filter(b => b !== hours)
                                    : [...bands, hours].sort((a, b) => b - a),
                            )}
                            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors
                                disabled:opacity-50
                                ${picked
                                    // NOT `bg-saffron text-white`: white on any
                                    // saffron shade fails AA in dark mode, where the
                                    // ramp inverts. `--cta` is the solid-fill token and
                                    // `--text-on-accent` flips to near-black with it.
                                    // See tests/quality/theme-tokens.test.ts.
                                    ? 'bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))]'
                                    : 'bg-cream-400 text-coffee'}`}
                        >
                            {hours}h
                        </button>
                    );
                })}
            </div>
            {atLimit && (
                <p className="mt-2 text-xs text-text-soft">
                    That is the most warnings one pickup can send.
                </p>
            )}
        </fieldset>
    );
}
