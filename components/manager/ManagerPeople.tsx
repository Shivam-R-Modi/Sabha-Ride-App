import React, { useState } from 'react';
import { CheckCircle2, X, UserCheck, Loader2, Car } from 'lucide-react';
import {
    usePendingDrivers, usePendingRiders, updateUserStatus,
    useRoleUpgradeRequests, declineRoleUpgrade,
} from '../../hooks/useFirestore';
import { managerSetUserRole } from '../../src/utils/cloudFunctions';
import { ManagerInvites } from './ManagerInvites';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../shared/useConfirm';
import { useAuth } from '../../contexts/AuthContext';
import type { Driver, User } from '../../types';

/**
 * Approvals — who is waiting to be let into the app.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A bell icon in a toolbar opening a modal that mixed FOUR different decisions:
 * driver approvals, rider approvals, and pending ride requests — the last of
 * which duplicated the Request Center sitting directly behind the modal, with a
 * second "Assign" button that did the same thing.
 *
 * Approving someone is not a notification. It gates access to an app holding
 * children's names, phone numbers and home addresses, and it deserves a screen
 * rather than a panel you dismiss by tapping outside. Ride requests belong to
 * Dispatch, and are only there now.
 */
export const ManagerPeople: React.FC = () => {
    // Who is doing the approving, for the audit row. An audit entry that cannot name
    // the actor looks like a record and identifies nobody.
    const { currentUser, userProfile } = useAuth();
    const { pendingDrivers, loading: driversLoading } = usePendingDrivers();
    const { pendingRiders, loading: ridersLoading } = usePendingRiders();
    // Bhulka already in the app who have asked to drive. A different decision from
    // the two queues above — those are "may this person use the app at all".
    const { requests: upgradeRequests, loading: upgradesLoading } = useRoleUpgradeRequests();
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busyId, setBusyId] = useState<string | null>(null);

    const loading = driversLoading || ridersLoading || upgradesLoading;
    const total = pendingDrivers.length + pendingRiders.length + upgradeRequests.length;

    const decide = async (
        person: { id: string; name: string },
        approve: boolean,
        kind: 'driver' | 'rider',
    ) => {
        if (!approve) {
            const ok = await ask({
                title: `Turn down ${person.name}?`,
                message: kind === 'driver'
                    ? 'They will not be able to volunteer to drive.'
                    : 'They will not be able to request rides.',
                confirmLabel: 'Turn down',
                cancelLabel: 'Go back',
                destructive: true,
            });
            if (!ok) return;
        }

        setBusyId(person.id);
        try {
            await updateUserStatus(person.id, approve ? 'approved' : 'rejected', {
                uid: currentUser?.uid ?? '',
                name: (userProfile?.name as string) || 'A manager',
            });
            toast.success(approve
                ? `${person.name} approved.`
                : `${person.name} turned down.`);
        } catch (error) {
            console.error('Error updating account status:', error);
            toast.error(error instanceof Error
                ? error.message
                : `Could not update ${person.name}. Please try again.`);
        } finally {
            setBusyId(null);
        }
    };

    /**
     * Grant or refuse a request to become a Sarthi.
     *
     * The grant goes through the callable, not a client write: the role lives in
     * four fields that have to move together, and firestore.rules now refuses all
     * four from a browser. The refusal is a plain write — nothing about the
     * person's access changes, so there is nothing to make atomic.
     */
    const decideUpgrade = async (person: User, approve: boolean) => {
        const actor = {
            uid: currentUser?.uid ?? '',
            name: (userProfile?.name as string) || 'A manager',
        };

        if (!approve) {
            const ok = await ask({
                title: `Turn down ${person.name}?`,
                message: 'They stay a Bhulku. They will see that the request was not '
                    + 'approved, and can ask again later.',
                confirmLabel: 'Turn down',
                cancelLabel: 'Go back',
                destructive: true,
            });
            if (!ok) return;
        }

        setBusyId(person.id);
        try {
            if (approve) {
                await managerSetUserRole(person.id, 'driver');
                toast.success(`${person.name} is now a Sarthi.`);
            } else {
                await declineRoleUpgrade(person.id, person.roleUpgrade?.requestedAt, actor);
                toast.success(`${person.name}'s request was turned down.`);
            }
        } catch (error) {
            console.error('Error deciding a role upgrade:', error);
            // The server's own words — it explains refusals a manager can act on.
            toast.error(error instanceof Error
                ? error.message
                : `Could not update ${person.name}. Please try again.`);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="px-4 pt-6 pb-6 space-y-5 max-w-3xl mx-auto animate-in fade-in duration-300">
            <header>
                <h1 className="text-2xl font-header font-bold text-coffee">People</h1>
                <p className="text-sm text-coffee-500">
                    {loading
                        ? 'Checking who is waiting…'
                        : total === 0
                            ? 'Nobody is waiting to be approved.'
                            : `${total} waiting to be approved.`}
                </p>
            </header>

            {loading ? (
                <PersonSkeleton />
            ) : total === 0 ? (
                <div className="clay-card text-center py-12">
                    <CheckCircle2 size={36} className="mx-auto text-[rgb(var(--success))] mb-3" />
                    <p className="font-header font-bold text-coffee">All caught up</p>
                    <p className="text-sm text-coffee-500 mt-1">
                        New sign-ups will appear here for you to approve.
                    </p>
                </div>
            ) : (
                <>
                    {/* First of the three. A request from somebody already in the
                        congregation is rarer and more considered than a sign-up,
                        and it is the only one of the three that changes what an
                        existing account can do. */}
                    {upgradeRequests.length > 0 && (
                        <Section title="Wants to drive" count={upgradeRequests.length}>
                            {upgradeRequests.map(person => (
                                <PersonRow
                                    key={person.id}
                                    name={person.name}
                                    detail={person.phone || person.email || 'No contact details'}
                                    extra="Asked to become a Sarthi"
                                    avatarUrl={person.avatarUrl}
                                    busy={busyId === person.id}
                                    approveLabel="Make Sarthi"
                                    approveIcon={<Car size={16} />}
                                    onApprove={() => decideUpgrade(person, true)}
                                    onDeny={() => decideUpgrade(person, false)}
                                />
                            ))}
                        </Section>
                    )}

                    {pendingDrivers.length > 0 && (
                        <Section title="Sarthis" count={pendingDrivers.length}>
                            {pendingDrivers.map(driver => (
                                <PersonRow
                                    key={driver.id}
                                    name={driver.name}
                                    detail={driver.phone || 'No phone number'}
                                    extra={(driver as Driver).carModel || 'No vehicle listed'}
                                    avatarUrl={driver.avatarUrl}
                                    busy={busyId === driver.id}
                                    onApprove={() => decide(driver, true, 'driver')}
                                    onDeny={() => decide(driver, false, 'driver')}
                                />
                            ))}
                        </Section>
                    )}

                    {pendingRiders.length > 0 && (
                        <Section title="Riders" count={pendingRiders.length}>
                            {pendingRiders.map(rider => (
                                <PersonRow
                                    key={rider.id}
                                    name={rider.name}
                                    detail={(rider as User).phone || rider.email || 'No contact details'}
                                    extra={rider.address || 'No address set'}
                                    avatarUrl={rider.avatarUrl}
                                    busy={busyId === rider.id}
                                    onApprove={() => decide(rider, true, 'rider')}
                                    onDeny={() => decide(rider, false, 'rider')}
                                />
                            ))}
                        </Section>
                    )}
                </>
            )}

            {/* OUTSIDE the ternary above, deliberately.
                That branch returns an "All caught up" card INSTEAD of the sections
                whenever nothing is pending — which is the normal state most of the
                week. Rendering invites inside it would make the feature vanish
                exactly when a manager has time to use it, and look deleted.
                tests/components/ManagerInvites.test.tsx pins this. */}
            <ManagerInvites />

            {confirmDialog}
        </div>
    );
};

const Section: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({
    title, count, children,
}) => (
    <section className="space-y-3">
        <h2 className="text-xs font-bold text-coffee-500 uppercase tracking-widest">
            {title} · {count}
        </h2>
        {children}
    </section>
);

const PersonRow: React.FC<{
    name: string;
    detail: string;
    extra: string;
    avatarUrl?: string;
    busy: boolean;
    /**
     * Overridable because this row now serves two different decisions. "Approve"
     * is right for letting somebody into the app and wrong for handing them a
     * carload of children — the button should say what it does.
     */
    approveLabel?: string;
    approveIcon?: React.ReactNode;
    onApprove: () => void;
    onDeny: () => void;
}> = ({ name, detail, extra, avatarUrl, busy, approveLabel, approveIcon, onApprove, onDeny }) => (
    <div className="clay-card">
        <div className="flex items-center gap-3">
            <img
                src={avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff`}
                alt=""
                className="w-11 h-11 rounded-xl shrink-0"
            />
            <div className="min-w-0 flex-1">
                <p className="font-bold text-coffee truncate">{name}</p>
                <p className="text-sm text-coffee-500 truncate">{detail}</p>
                <p className="text-xs text-coffee-500 truncate">{extra}</p>
            </div>
        </div>

        {/* Full-width targets on their own row rather than two small chips
            squeezed beside the name — this is an irreversible-ish decision made
            on a phone, and a mis-tap turns someone away. */}
        <div className="flex gap-3 mt-4">
            <button
                onClick={onDeny}
                disabled={busy}
                className="flex-1 min-h-11 rounded-xl border-2 border-[rgb(var(--danger))]
                           text-[rgb(var(--danger-text))] font-semibold text-sm
                           hover:bg-[rgb(var(--danger-bg))] transition-colors
                           disabled:opacity-50 flex items-center justify-center gap-2"
            >
                <X size={16} /> Turn down
            </button>
            <button
                onClick={onApprove}
                disabled={busy}
                className="flex-1 min-h-11 rounded-xl bg-[rgb(var(--success-fill))]
                           text-[rgb(var(--text-on-accent))] font-semibold text-sm
                           hover:opacity-90 transition-opacity disabled:opacity-50
                           flex items-center justify-center gap-2"
            >
                {busy
                    ? <Loader2 className="animate-spin" size={16} />
                    : (approveIcon ?? <UserCheck size={16} />)}
                {approveLabel ?? 'Approve'}
            </button>
        </div>
    </div>
);

const PersonSkeleton: React.FC = () => (
    <div className="clay-card" aria-busy="true" aria-label="Loading approvals">
        <div className="flex items-center gap-3 animate-pulse">
            <div className="w-11 h-11 rounded-xl bg-cream-300 shrink-0" />
            <div className="flex-1 space-y-2">
                <div className="h-4 bg-cream-300 rounded w-1/2" />
                <div className="h-3 bg-cream-300 rounded w-2/3" />
            </div>
        </div>
        <div className="h-11 bg-cream-300 rounded-xl mt-4 animate-pulse" />
    </div>
);
