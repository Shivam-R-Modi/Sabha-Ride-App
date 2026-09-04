import React, { useEffect, useState } from 'react';
import { Clock, Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { manuallyUpdateRideContext } from '../../src/utils/cloudFunctions';
import { useConfirm } from '../shared/useConfirm';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_REQUESTS_OPEN_TIME } from '../../src/constants/schedule';

/**
 * Lets a manager open a ride window ahead of the schedule.
 *
 * `manuallyUpdateRideContext` has been deployed all along with nothing calling
 * it, so the only way to move the window was to edit Firestore by hand. Pickups
 * open Wednesday and drop-off opens 15 minutes before sabha ends on their own;
 * this is for the weeks that do not go to plan.
 *
 * Opening a window notifies everyone with push enabled, so the buttons confirm
 * first — this is not an action to trigger by a stray tap.
 */

interface RideContextDoc {
    rideType: 'home-to-sabha' | 'sabha-to-home' | null;
    displayText?: string;
    timeContext?: string;
    overrideUntil?: string | null;
}

export const RideWindowControl: React.FC = () => {
    const [context, setContext] = useState<RideContextDoc | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const { ask, confirmDialog } = useConfirm();
    const { currentUser } = useAuth();
    const { requestsOpenTime, updateRequestsOpenTime, loading: settingsLoading } = useSettings();
    const [openTime, setOpenTime] = useState('');
    const [savingTime, setSavingTime] = useState(false);

    /**
     * Seeded ONCE THE SETTINGS HAVE LOADED, keyed on `loading` rather than on the value.
     *
     * This used to be `if (requestsOpenTime !== undefined)`, which looks like the
     * careful version and is the bug: `undefined` means BOTH "the snapshot has not
     * arrived yet" and "no time has ever been saved". So a congregation that had never
     * set one saw a permanently blank box — and so did everyone else, because
     * `useSettings` was not copying the field off the snapshot at all.
     *
     * `loading` separates the two, and the fallback is the shipped 10:00 rather than
     * '' or midnight. Not keyed on every render either: the context listener fires once
     * a minute, and re-seeding on each tick would wipe a half-typed time.
     */
    useEffect(() => {
        if (settingsLoading) return;
        setOpenTime(requestsOpenTime || DEFAULT_REQUESTS_OPEN_TIME);
    }, [settingsLoading, requestsOpenTime]);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (snap) => setContext(snap.exists() ? (snap.data() as RideContextDoc) : null),
            (err) => {
                console.error('[RideWindowControl] Listener error:', err);
                setError('Could not read the current ride window.');
            }
        );
        return unsub;
    }, []);

    const overrideActive = !!context?.overrideUntil
        && new Date(context.overrideUntil) > new Date();

    const act = async (
        label: string,
        confirmText: string,
        params: { rideType?: 'home-to-sabha' | 'sabha-to-home'; reset?: boolean },
    ) => {
        // Was window.confirm, which returns false when a browser suppresses
        // dialogs — so these buttons silently did nothing in a PWA or an
        // embedded webview.
        if (!await ask({ message: confirmText, confirmLabel: 'Yes, do it' })) return;

        setBusy(label);
        setError(null);
        setDone(null);
        try {
            await manuallyUpdateRideContext(params);
            setDone(label);
            setTimeout(() => setDone(null), 3000);
        } catch (err: unknown) {
            console.error('[RideWindowControl] Failed:', err);
            setError(err instanceof Error ? err.message : 'Could not change the ride window.');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <Clock size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Ride Window</h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    Opens on its own. Use these only to start early.
                </p>
            </div>

            <div className="px-4 py-3 border-b border-hairline/10 bg-[rgb(var(--warning-bg))]/50">
                <p className="text-xs text-coffee-500 mb-1">Right Now</p>
                <p className="text-sm font-medium text-coffee">
                    {context?.displayText || 'No rides available'}
                </p>
                {context?.timeContext && (
                    <p className="text-xs text-coffee-500 mt-0.5">{context.timeContext}</p>
                )}
                {overrideActive && (
                    <p className="text-xs text-saffron-800 font-semibold mt-1">
                        Opened manually — returns to the schedule at midnight
                    </p>
                )}
            </div>

            {/*
              * WHEN THE WINDOW OPENS ON ITS OWN, above the buttons that force it open
              * early. This is the one screen already named "when riders can request",
              * so the setting belongs here rather than beside the notification
              * switches — and it is separate from the reminder hour on purpose: a
              * congregation may want requests to open early and the nagging to start
              * at a civil hour.
              */}
            <div className="px-4 py-3 border-b border-hairline/10">
                <label htmlFor="requests-open-time" className="block text-xs text-coffee-500">
                    Requests open at, two days before sabha
                </label>
                <div className="mt-1 flex items-center gap-2">
                    <input
                        id="requests-open-time"
                        type="time"
                        value={openTime}
                        onChange={(e) => setOpenTime(e.target.value)}
                        className="rounded-lg border border-hairline/20 bg-canvas px-2 py-1.5 text-sm text-coffee"
                    />
                    <button
                        type="button"
                        disabled={savingTime || !openTime || openTime === requestsOpenTime
                            || !currentUser}
                        onClick={async () => {
                            if (!currentUser) return;
                            setSavingTime(true);
                            setError(null);
                            try {
                                await updateRequestsOpenTime(openTime, currentUser.uid);
                                setDone('time');
                                setTimeout(() => setDone(null), 3000);
                            } catch (err: unknown) {
                                console.error('[RideWindowControl] Could not save open time:', err);
                                setError('Could not save that time.');
                            } finally {
                                setSavingTime(false);
                            }
                        }}
                        className="rounded-lg border border-hairline/20 px-3 py-1.5 text-sm font-semibold text-coffee disabled:opacity-50"
                    >
                        {savingTime ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                    </button>
                    {done === 'time' && (
                        <CheckCircle2 size={16} className="text-[rgb(var(--success-text))]" />
                    )}
                </div>
            </div>

            <div className="px-4 py-4 space-y-2">
                <button
                    onClick={() => act(
                        'pickup',
                        'Open ride requests now? Everyone with notifications on will be alerted.',
                        { rideType: 'home-to-sabha' },
                    )}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] rounded-lg font-semibold text-sm hover:bg-[rgb(var(--cta-dark))] disabled:opacity-50 transition-all"
                >
                    {busy === 'pickup' ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
                    Open ride requests now
                </button>

                <button
                    onClick={() => act(
                        'dropoff',
                        'Open drop-off rides now? Everyone with notifications on will be alerted.',
                        { rideType: 'sabha-to-home' },
                    )}
                    disabled={!!busy}
                    // An accent OUTLINE, not `bg-coffee text-cream`. That fill is
                    // `--text-strong`, which inverts between themes, so this
                    // button was dark in light mode and near-white in dark. It is
                    // the middle of three rungs here — filled saffron above,
                    // neutral outline below — and an accent outline keeps that
                    // order while behaving the same in both themes.
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-saffron-800 text-saffron-800 rounded-lg font-semibold text-sm hover:bg-cream-200 disabled:opacity-50 transition-all"
                >
                    {busy === 'dropoff' ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
                    Open drop-off now
                </button>

                {overrideActive && (
                    <button
                        onClick={() => act(
                            'reset',
                            'Return to the automatic schedule?',
                            { reset: true },
                        )}
                        disabled={!!busy}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-hairline/20 text-coffee-700 rounded-lg font-semibold text-sm hover:bg-cream-200 disabled:opacity-50 transition-all"
                    >
                        {busy === 'reset' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                        Back to automatic
                    </button>
                )}

                {error && (
                    <div className="flex items-center gap-2 text-[rgb(var(--danger-text))] bg-[rgb(var(--danger-bg))] px-3 py-2 rounded-lg">
                        <AlertCircle size={14} />
                        <span className="text-xs">{error}</span>
                    </div>
                )}
                {done && (
                    <div className="flex items-center gap-2 text-[rgb(var(--success-text))] bg-[rgb(var(--success-bg))] px-3 py-2 rounded-lg">
                        <CheckCircle2 size={14} />
                        <span className="text-xs">Updated. Everyone has been notified.</span>
                    </div>
                )}
            </div>

            {confirmDialog}
        </div>
    );
};
