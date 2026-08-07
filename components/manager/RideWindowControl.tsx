import React, { useEffect, useState } from 'react';
import { Clock, Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { manuallyUpdateRideContext } from '../../src/utils/cloudFunctions';

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
        if (!confirm(confirmText)) return;

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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                    <Clock size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-gray-800">Ride Window</h3>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Opens on its own. Use these only to start early.
                </p>
            </div>

            <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/50">
                <p className="text-xs text-gray-500 mb-1">Right Now</p>
                <p className="text-sm font-medium text-gray-800">
                    {context?.displayText || 'No rides available'}
                </p>
                {context?.timeContext && (
                    <p className="text-xs text-gray-500 mt-0.5">{context.timeContext}</p>
                )}
                {overrideActive && (
                    <p className="text-xs text-saffron-800 font-semibold mt-1">
                        Opened manually — returns to the schedule at midnight
                    </p>
                )}
            </div>

            <div className="px-4 py-4 space-y-2">
                <button
                    onClick={() => act(
                        'pickup',
                        'Open ride requests now? Everyone with notifications on will be alerted.',
                        { rideType: 'home-to-sabha' },
                    )}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-saffron text-white rounded-lg font-semibold text-sm hover:bg-saffron/90 disabled:opacity-50 transition-all"
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
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-coffee text-white rounded-lg font-semibold text-sm hover:bg-coffee/90 disabled:opacity-50 transition-all"
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
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-gray-200 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-50 disabled:opacity-50 transition-all"
                    >
                        {busy === 'reset' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                        Back to automatic
                    </button>
                )}

                {error && (
                    <div className="flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                        <AlertCircle size={14} />
                        <span className="text-xs">{error}</span>
                    </div>
                )}
                {done && (
                    <div className="flex items-center gap-2 text-green-800 bg-green-50 px-3 py-2 rounded-lg">
                        <CheckCircle2 size={14} />
                        <span className="text-xs">Updated. Everyone has been notified.</span>
                    </div>
                )}
            </div>
        </div>
    );
};
