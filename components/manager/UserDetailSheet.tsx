import React, { useState } from 'react';
import { Loader2, Car, GraduationCap, ArrowUpCircle, ShieldAlert } from 'lucide-react';
import { Sheet } from '../shared/Sheet';
import { useConfirm } from '../shared/useConfirm';
import { useToast } from '../../contexts/ToastContext';
import { managerSetUserRole } from '../../src/utils/cloudFunctions';
import { recordedRoles, statesRoleConsistently } from '../../src/roles';
import { formatRole } from '../../src/utils/formatters';

/**
 * One person, everything about them, and the two buttons that change what they are.
 *
 * WHY THE WHOLE RECORD IS HERE RATHER THAN IN THE TABLE
 * ----------------------------------------------------
 * The Records table used to show name-and-email, role, status and home address as
 * columns. Four of those are a child's contact details spread across a screen a
 * manager leaves open, and only two of them are ever the reason they are looking.
 * So the table narrowed to name / role / status / action and the rest moved in
 * here, behind a deliberate tap. Same information, far less of it on display by
 * accident.
 *
 * WHY THE ROLE IS COMPUTED AND NOT READ
 * -------------------------------------
 * `recordedRoles()`, not `user.role`. A role lives in four fields, and the raw
 * editor beside this one could always write them one at a time — so a document may
 * say `role: 'driver'` and `roles: ['student']` at once. Reading `role` alone
 * renders that as a tidy "Sarthi" and hides the very inconsistency a manager
 * opened this dialog to fix. When the fields disagree, say so.
 */

interface UserDetailSheetProps {
    user: Record<string, any> | null;
    onClose: () => void;
    /** In-flight rides this person is driving. Drives the confirm wording. */
    activeRideCount?: number;
}

/**
 * The role-change button, in one place for both directions.
 *
 * WHY THIS IS A COMPONENT AND NOT TWO BUTTONS
 * -------------------------------------------
 * It was two, written separately, and they drifted exactly as separately-written
 * things do: promote was a FILLED green button with a car icon, demote was an
 * OUTLINED red one with a generic down-arrow. Same act, same screen, same level of
 * consequence — and only ever one of them visible at a time, so the difference did
 * not read as "one of these is the safe option", it read as two unrelated controls.
 * Which weight a manager saw depended purely on which direction they happened to
 * be going.
 *
 * Now: identical geometry and weight, and the only things that vary are the ones
 * that carry meaning — the colour, and the icon of the role the person is
 * BECOMING. `Car` for Sarthi and `GraduationCap` for Bhulku are not new here; they
 * are the app's existing role language, from RoleSwitcher's roleConfig.
 *
 * Filled in both directions rather than outlined in both. `--danger-fill` is the
 * established weight for a consequential manager action — the bulk delete in this
 * very console, the destructive arm of useConfirm — and a demotion frees a car and
 * puts riders back in the queue, so it is not the lighter of the two.
 */
const RoleChangeButton: React.FC<{
    to: 'driver' | 'student';
    busy: boolean;
    onClick: () => void;
}> = ({ to, busy, onClick }) => (
    <button
        onClick={onClick}
        disabled={busy}
        className={`w-full min-h-11 rounded-xl font-semibold text-sm
                    text-[rgb(var(--text-on-accent))]
                    hover:opacity-90 transition-opacity disabled:opacity-50
                    flex items-center justify-center gap-2 ${
            to === 'driver'
                ? 'bg-[rgb(var(--success-fill))]'
                : 'bg-[rgb(var(--danger-fill))]'
        }`}
    >
        {busy
            ? <Loader2 className="animate-spin" size={16} />
            : to === 'driver' ? <Car size={16} /> : <GraduationCap size={16} />}
        {to === 'driver' ? 'Make Sarthi' : 'Return to Bhulku'}
    </button>
);

const Fact: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-hairline/10 last:border-0">
        <span className="text-[11px] font-bold text-coffee-500 uppercase tracking-wider shrink-0">
            {label}
        </span>
        <span className="text-sm text-coffee text-right break-words min-w-0">
            {value || <span className="text-coffee-500">Not set</span>}
        </span>
    </div>
);

export const UserDetailSheet: React.FC<UserDetailSheetProps> = ({
    user, onClose, activeRideCount = 0,
}) => {
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busy, setBusy] = useState(false);

    // Hooks must run unconditionally, so the null check comes after them.
    if (!user) return null;

    const roles = recordedRoles(user as any);
    const name = String(user.name || 'Unnamed');
    const isManager = roles.includes('manager');
    const drives = roles.includes('driver');

    // A document whose four role fields disagree. Named rather than smoothed over:
    // the fix is one tap on the button below, and a manager who cannot see the
    // problem will not know to make it.
    //
    // NOT `roles.length > 1`. A healthy Sarthi records two roles — driver implies
    // student — so that test called every Sarthi in the congregation broken. The
    // question is whether all four fields agree on the TOP recorded role, which is
    // the same predicate the callable uses to decide it has nothing to do.
    const inconsistent = roles.length > 0 && !statesRoleConsistently(user as any, roles[0]!);

    const holdsCar = !!(user.currentVehicleId || user.currentCarId);

    const change = async (role: 'driver' | 'student') => {
        const promoting = role === 'driver';

        // Everything the manager cannot see from a table of names. Assembled here
        // rather than left to the server's refusal, because a confirm that only
        // says "are you sure" makes them find out by trying.
        const consequences = promoting
            ? `${name} will be able to volunteer as a Sarthi and be given riders. `
              + 'They can still ask for a lift themselves.'
            : [
                `${name} will no longer be offered riders.`,
                holdsCar ? 'The car they are holding goes back to the fleet.' : '',
                activeRideCount > 0
                    ? `${activeRideCount} ride(s) already assigned to them will be `
                      + 'returned to the waiting queue.'
                    : '',
                'If a run is already under way this will be refused.',
            ].filter(Boolean).join('\n');

        const ok = await ask({
            title: promoting ? `Make ${name} a Sarthi?` : `Return ${name} to Bhulku?`,
            message: consequences,
            confirmLabel: promoting ? 'Make Sarthi' : 'Return to Bhulku',
            cancelLabel: 'Go back',
            destructive: !promoting,
        });
        if (!ok) return;

        setBusy(true);
        try {
            const result = await managerSetUserRole(user.id, role);

            if (!result.changed) {
                // The document already said exactly this. Not an error, and not a
                // success worth a tick either — say what is true.
                toast.info(`${name} is already ${promoting ? 'a Sarthi' : 'a Bhulku'}.`);
            } else {
                toast.success(promoting
                    ? `${name} is now a Sarthi.`
                    : `${name} is now a Bhulku.`);
            }
            onClose();
        } catch (error) {
            // The SERVER's words, verbatim. "Nilesh is out on a run with 2 rides —
            // Asha, Ravi" is something a manager can act on; "could not update" is
            // not. callFunction rethrows the server message for exactly this.
            toast.error(error instanceof Error
                ? error.message
                : `Could not change ${name}'s role. Please try again.`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Sheet
                open={!!user}
                onClose={onClose}
                title={name}
                variant="sheet"
                // Not dismissible mid-write: closing the sheet while the role
                // change is in flight leaves the manager with no idea whether it
                // landed.
                dismissible={!busy}
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <img
                            src={user.avatarUrl
                                || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff`}
                            alt=""
                            className="w-12 h-12 rounded-xl shrink-0"
                        />
                        <div className="min-w-0">
                            <p className="font-bold text-coffee truncate">{name}</p>
                            <p className="text-sm text-coffee-500">
                                {roles.map(r => formatRole(r)).join(' + ') || 'No role recorded'}
                            </p>
                        </div>
                    </div>

                    {inconsistent && (
                        <div
                            role="note"
                            className="flex items-start gap-2 p-3 rounded-2xl text-xs leading-snug
                                       bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]"
                        >
                            <ShieldAlert size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                            <p>
                                This record disagrees with itself — it says{' '}
                                {roles.map(r => formatRole(r)).join(' and ')} in different
                                fields. Setting the role below rewrites all of them together
                                and fixes it.
                            </p>
                        </div>
                    )}

                    <section className="clay-card p-4">
                        <Fact label="Role" value={roles.map(r => formatRole(r)).join(' + ')} />
                        <Fact label="Account" value={String(user.accountStatus || 'approved')} />
                        <Fact label="Email" value={user.email} />
                        <Fact label="Phone" value={user.phone} />
                        <Fact
                            label="Address"
                            value={user.address || user.location?.formattedAddress}
                        />
                        <Fact
                            label="Joined"
                            value={user.createdAt
                                ? new Date(user.createdAt).toLocaleDateString()
                                : null}
                        />
                    </section>

                    {drives && (
                        <section className="clay-card p-4">
                            <Fact
                                label="Car"
                                value={holdsCar
                                    ? `${user.currentVehicleName || 'A vehicle'}${
                                        user.currentVehiclePlate ? ` · ${user.currentVehiclePlate}` : ''}`
                                    : 'Not holding one'}
                            />
                            <Fact
                                label="Shift"
                                value={String(user.status || 'offline')}
                            />
                            {activeRideCount > 0 && (
                                <Fact label="Rides now" value={`${activeRideCount} in flight`} />
                            )}
                        </section>
                    )}

                    {user.roleUpgrade?.status === 'pending' && (
                        <div className="flex items-start gap-2 p-3 rounded-2xl text-xs leading-snug
                                        bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]">
                            <ArrowUpCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                            <p>They have asked to become a Sarthi.</p>
                        </div>
                    )}

                    {isManager ? (
                        // No control at all, rather than a disabled one. A button
                        // that cannot work is the thing this app keeps removing —
                        // and the manager role genuinely is granted elsewhere.
                        <p className="text-xs text-coffee-500 leading-snug px-1">
                            This is a manager. Manager roles are granted and removed through
                            single-use invites, not from here — removing one also has to clear
                            their access token, which this screen does not do.
                        </p>
                    ) : inconsistent ? (
                        // BOTH directions, for a record that disagrees with
                        // itself. Its "current" role is not a fact, so offering
                        // only the opposite of a guess would make the manager
                        // demote and re-promote to land on the answer they wanted.
                        // Either button rewrites all four fields, so either one
                        // repairs it — they just pick which truth it should be.
                        <div className="space-y-2">
                            <RoleChangeButton to="driver" busy={busy} onClick={() => change('driver')} />
                            <RoleChangeButton to="student" busy={busy} onClick={() => change('student')} />
                        </div>
                    ) : drives ? (
                        <RoleChangeButton to="student" busy={busy} onClick={() => change('student')} />
                    ) : (
                        <RoleChangeButton to="driver" busy={busy} onClick={() => change('driver')} />
                    )}
                </div>
            </Sheet>

            {confirmDialog}
        </>
    );
};
