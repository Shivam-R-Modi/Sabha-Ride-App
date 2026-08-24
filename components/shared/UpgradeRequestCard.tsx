import React, { useState } from 'react';
import { Car, Loader2, Clock, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { requestRoleUpgrade, clearRoleUpgradeRequest } from '../../hooks/useFirestore';
import { recordedRoles } from '../../src/roles';
import { messageOf } from '../../src/utils/errorText';

/**
 * A Bhulku asking to become a Sarthi, and the answer.
 *
 * Lives in ProfileEditor for the same reason ThemeToggle, InstallAppButton,
 * PushToggle and FeedbackCard do: Profile is the one destination all three roles
 * share, so one placement reaches everybody with no per-role wiring. It sits last
 * of the five because asking to drive is rarer than any of them.
 *
 * RENDERS NOTHING FOR A SARTHI OR A MANAGER
 * -----------------------------------------
 * Not a disabled button, not "you already have this" — nothing at all. The role
 * hierarchy already grants a Sarthi and a manager everything a Bhulku can do, so
 * there is no request for them to make, and a control that cannot do anything is
 * the failure this app keeps removing. Same reason InstallAppButton renders
 * nothing where the browser cannot install.
 *
 * A REFUSAL STAYS ON SCREEN UNTIL IT IS READ
 * ------------------------------------------
 * The rejected state is a real state with its own card, rather than the request
 * quietly disappearing. A person who asked and heard nothing asks again, and again
 * — and the manager's queue fills with duplicates of a decision that was already
 * made. Dismissing it is the rider's own action, once they have seen it.
 *
 * Inline messages rather than toasts, matching ProfileEditor's own success and
 * error banners. A toast fired from inside a card that already has somewhere to
 * put the text would be the third pattern on one screen.
 */
export const UpgradeRequestCard: React.FC = () => {
    const { currentUser, userProfile, refreshProfile } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const request = userProfile?.roleUpgrade ?? null;

    // `recordedRoles`, so somebody recorded as a Sarthi only in `roles[]` is
    // correctly treated as one. Reading `role` alone would offer a Sarthi a
    // request to become what they already are.
    const roles = recordedRoles(userProfile as any);
    if (!currentUser || roles.includes('driver') || roles.includes('manager')) return null;

    // An account that is not approved cannot be given riders, and the callable
    // refuses it. Offering the button anyway would be a control that cannot work.
    if (userProfile?.accountStatus !== 'approved') return null;

    const act = async (fn: (uid: string) => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await fn(currentUser.uid);
            // The profile subscription will bring the change in on its own; this
            // just stops the card lagging a second behind the tap.
            await refreshProfile?.();
        } catch (err: unknown) {
            setError(messageOf(err, 'Could not send that. Please try again.'));
        } finally {
            setBusy(false);
        }
    };

    if (request?.status === 'pending') {
        return (
            <div className="clay-card p-4 text-left space-y-3">
                <div className="flex items-center gap-4">
                    <div className="bg-[rgb(var(--info-bg))] p-2 rounded-xl text-[rgb(var(--info-text))] shrink-0">
                        <Clock size={20} />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold text-coffee text-sm">Waiting to be reviewed</p>
                        <p className="text-xs text-coffee-500">
                            A manager will look at your request to become a Sarthi.
                        </p>
                    </div>
                </div>
                {error && <p className="text-xs text-[rgb(var(--danger-text))]">{error}</p>}
                <button
                    onClick={() => act(clearRoleUpgradeRequest)}
                    disabled={busy}
                    className="tap-target text-xs font-bold text-coffee-500 hover:text-coffee
                               disabled:opacity-50"
                >
                    {busy ? 'Withdrawing…' : 'Withdraw request'}
                </button>
            </div>
        );
    }

    if (request?.status === 'rejected') {
        return (
            <div className="clay-card p-4 text-left space-y-3">
                <div className="flex items-center gap-4">
                    <div className="bg-[rgb(var(--warning-bg))] p-2 rounded-xl text-[rgb(var(--warning-text))] shrink-0">
                        <XCircle size={20} />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold text-coffee text-sm">Not approved</p>
                        <p className="text-xs text-coffee-500">
                            A manager did not approve your request to become a Sarthi. Speak to
                            the seva team if you would like to know more.
                        </p>
                    </div>
                </div>
                {error && <p className="text-xs text-[rgb(var(--danger-text))]">{error}</p>}
                <button
                    onClick={() => act(clearRoleUpgradeRequest)}
                    disabled={busy}
                    className="tap-target text-xs font-bold text-coffee-500 hover:text-coffee
                               disabled:opacity-50"
                >
                    {busy ? 'Dismissing…' : 'Dismiss'}
                </button>
            </div>
        );
    }

    return (
        <div className="clay-card p-4 text-left space-y-3">
            <button
                onClick={() => act(requestRoleUpgrade)}
                disabled={busy}
                className="w-full flex items-center gap-4 text-left disabled:opacity-50"
            >
                <div className="bg-cream-300 p-2 rounded-xl text-saffron-800 shrink-0">
                    {busy ? <Loader2 className="animate-spin" size={20} /> : <Car size={20} />}
                </div>
                <div className="min-w-0">
                    <p className="font-bold text-coffee text-sm">Become a Sarthi</p>
                    <p className="text-xs text-coffee-500">
                        Offer to drive Bhulka to and from the sabha. A manager approves this,
                        and you can still ask for a lift yourself.
                    </p>
                </div>
            </button>
            {error && <p className="text-xs text-[rgb(var(--danger-text))]">{error}</p>}
        </div>
    );
};
