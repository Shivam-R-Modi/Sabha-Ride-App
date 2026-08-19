import React from 'react';
import { Bell, BellOff, Share, Loader2 } from 'lucide-react';
import { usePush } from '../../hooks/usePush';
import { usePwaInstall } from '../../hooks/usePwaInstall';

/**
 * Turning notifications on, and being honest when they cannot be.
 *
 * Lives in ProfileEditor for the same reason ThemeToggle and InstallAppButton
 * do: it is a property of the DEVICE, and Profile is the one destination all
 * three roles share.
 *
 * Diverges from InstallAppButton's render-null rule in one case on purpose.
 * Null only for `unsupported`, where there is nothing the user could do
 * anywhere. For `blocked` it renders the explanation, because the user CAN fix
 * it — just not here — and Profile is exactly where they will come looking for
 * the switch they turned off. Rendering null there would be an invisible
 * control, which is the same family of defect as a dead one.
 */
export const PushToggle: React.FC = () => {
    const { availability, busy, error, enable, disable } = usePush();
    const { steps } = usePwaInstall();

    if (availability === 'unsupported') return null;

    const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <div className="clay-card p-4 text-left">{children}</div>
    );

    if (availability === 'needs-install') {
        return (
            <Frame>
                <p className="text-sm font-bold text-coffee flex items-center gap-2">
                    <Share size={16} className="shrink-0" /> Add to Home Screen first
                </p>
                {/* Not a "turn on" button. iPhone gives exactly one permission
                    prompt, and a tab can never receive push — spending it here
                    would leave the person unable to undo it without Settings. */}
                <p className="text-xs text-coffee-500 mt-1">
                    iPhone only sends notifications to apps on the Home Screen, not to Safari tabs.
                </p>
                <ol className="mt-2 space-y-1">
                    {steps.map((step, i) => (
                        <li key={step} className="text-xs text-coffee-700 flex items-start gap-2">
                            <span className="shrink-0 w-4 h-4 rounded-full bg-saffron text-white text-[10px] font-bold flex items-center justify-center mt-px">
                                {i + 1}
                            </span>
                            <span className="min-w-0">{step}</span>
                        </li>
                    ))}
                </ol>
                <p className="text-xs text-coffee-500 mt-2">
                    Then open it from your Home Screen and turn notifications on there.
                </p>
            </Frame>
        );
    }

    if (availability === 'blocked') {
        return (
            <Frame>
                <p className="text-sm font-bold text-coffee flex items-center gap-2">
                    <BellOff size={16} className="shrink-0" /> Notifications are turned off
                </p>
                <p className="text-xs text-coffee-500 mt-1">
                    Your browser is blocking them for Bhulka Gaadi. On iPhone: Settings, then
                    Notifications, then Bhulka Gaadi. On Chrome: tap the lock icon beside the
                    address, then Notifications.
                </p>
                <p className="text-xs text-coffee-500 mt-2">
                    You will still see every change on your screen the moment it happens.
                </p>
            </Frame>
        );
    }

    const on = availability === 'on';

    return (
        <button
            onClick={on ? disable : enable}
            disabled={busy}
            className="clay-card w-full flex items-center gap-4 text-left p-4 btn-feedback disabled:opacity-60"
        >
            <div className="bg-cream-300 p-2 rounded-xl text-saffron shrink-0">
                {busy ? <Loader2 size={20} className="animate-spin" /> : on ? <Bell size={20} /> : <BellOff size={20} />}
            </div>
            <div className="min-w-0">
                <p className="text-sm font-bold text-coffee">
                    {on ? 'Notifications are on' : 'Turn on notifications'}
                </p>
                <p className="text-xs text-coffee-500">
                    {error ?? (on
                        ? 'On for this device. Tap to turn off.'
                        : 'Get told when your ride is arranged and when your Sarthi arrives.')}
                </p>
            </div>
        </button>
    );
};
