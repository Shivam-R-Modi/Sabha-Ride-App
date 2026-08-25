import React from 'react';
import { Bell } from 'lucide-react';
import { usePush } from '../../hooks/usePush';
import {
    readPushDismissals,
    writePushDismissals,
    shouldOfferPush,
} from '../../src/utils/push';

/**
 * The one-time offer to turn notifications on.
 *
 * Shown at the moment the value is obvious — a ride has just been arranged —
 * rather than at signup. Asking before the app has been any use is how a
 * permission gets refused permanently.
 *
 * This is a PRE-prompt, and the distinction is the whole point. The OS dialog is
 * one-shot: on iOS a refusal can only be undone in Settings, and in Chrome it
 * becomes a blocked state only site settings can clear. So the real dialog is
 * only ever raised for someone who has already said yes to this, which is
 * reversible and costs nothing.
 *
 * Not a fixed banner. `UpdateBanner` and `PWAPrompt` already share the bottom
 * strip; a third would be a pile. This sits in the page, under the thing it is
 * talking about.
 */
export const PushPrompt: React.FC = () => {
    const { availability, busy, enable } = usePush();
    const [dismissals, setDismissals] = React.useState(() => readPushDismissals());

    if (!shouldOfferPush({ availability, dismissals, now: Date.now() })) return null;

    const dismiss = () => {
        const next = { count: dismissals.count + 1, lastAt: Date.now() };
        writePushDismissals(next);
        setDismissals(next);
    };

    return (
        <div className="clay-card p-4 text-left animate-in fade-in slide-in-from-bottom-2">
            <p className="text-sm font-bold text-coffee flex items-center gap-2">
                <Bell size={16} className="shrink-0" /> Get told when your Sarthi is on the way
            </p>
            {/* Says exactly what will be sent. A promise this specific is what
                makes the yes worth asking for. */}
            <p className="text-xs text-coffee-500 mt-1">
                One notification when a Sarthi is assigned, one when they are outside. Nothing else.
            </p>
            <div className="flex gap-2 mt-3">
                <button
                    onClick={enable}
                    disabled={busy}
                    className="flex-1 min-h-11 px-4 rounded-xl bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] text-sm font-bold btn-feedback disabled:opacity-60"
                >
                    {busy ? 'Turning on…' : 'Turn on notifications'}
                </button>
                <button
                    onClick={dismiss}
                    className="min-h-11 px-4 rounded-xl border border-hairline/30 text-coffee-700 text-sm font-bold btn-feedback"
                >
                    Not now
                </button>
            </div>
        </div>
    );
};
