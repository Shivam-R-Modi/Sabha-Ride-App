import React, { useState } from 'react';
import { Download, Loader2, Plane, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../shared/useConfirm';
import { downloadCSV, exportMembers } from '../../src/utils/cloudFunctions';
import { isApprovedManager } from '../../src/roles';

/**
 * The member directory as a spreadsheet, in one of three scopes.
 *
 * Airport, Sabha, or everyone — because the two services have different populations
 * and somebody running airport pickups wants that list rather than the union with a
 * column to filter on.
 *
 * IT LIVES WITH THE MANAGER'S OTHER EXPORTS, not inside Airport Seva, because it spans
 * both services. Duplicating it into each would mean two screens to keep in step over
 * the most sensitive output this app produces.
 *
 * THE AIRPORT SCOPE IS COORDINATOR-ONLY, and it is hidden rather than disabled for
 * anyone else. That scope reads `airportProfiles`, which carries an exact date of
 * birth and a family contact for every traveller who has ever asked — the server
 * refuses it without the flag, so a visible button would be one that always fails.
 *
 * Every scope is confirmed before it runs. Not ceremony: each one puts every family's
 * name, phone number and home address into a file on somebody's laptop, and a
 * one-tap download makes that feel like nothing.
 */

type Scope = 'airport' | 'sabha' | 'all';

const SCOPES: Array<{ scope: Scope; label: string; blurb: string; coordinatorOnly?: boolean }> = [
    {
        scope: 'sabha',
        label: 'Sabha Seva',
        blurb: 'Everyone who has asked for a lift to a gathering.',
    },
    {
        scope: 'airport',
        label: 'Airport Seva',
        blurb: 'Everyone who has asked to be collected. Includes dates of birth.',
        coordinatorOnly: true,
    },
    {
        scope: 'all',
        label: 'Everyone',
        blurb: 'The whole directory, with a column for each service.',
    },
];

export const MemberExportCard: React.FC = () => {
    const { userProfile } = useAuth();
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busy, setBusy] = useState<Scope | null>(null);

    const isCoordinator = isApprovedManager(userProfile) && userProfile?.airportCoordinator === true;

    const run = async (scope: Scope, label: string) => {
        const ok = await ask({
            title: `Download the ${label} list?`,
            message: 'This file holds names, phone numbers and home addresses, including '
                + 'for minors. It is recorded in the audit log.',
            confirmLabel: 'Download',
        });
        if (!ok) return;

        setBusy(scope);
        try {
            const result = await exportMembers(scope);
            if (result.rowCount === 0) {
                // Said out loud instead of handing over a file with one header row.
                // An empty download reads as "the export is broken".
                toast.info('Nobody matches that list yet, so there is nothing to download.');
                return;
            }
            downloadCSV(result.csv, `${scope}-members-${new Date().toISOString().slice(0, 10)}.csv`);
            // A truncated export that looks complete is how somebody concludes half the
            // congregation has left.
            if (result.truncated) {
                toast.error(`Only the first ${result.rowCount} rows are in that file — there are more.`);
            } else {
                toast.success(`${result.rowCount} rows downloaded`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'That could not be exported');
        } finally {
            setBusy(null);
        }
    };

    const visible = SCOPES.filter(s => !s.coordinatorOnly || isCoordinator);

    return (
        <section className="clay-card p-4 space-y-3" aria-label="Export the member directory">
            <div className="flex items-center gap-2">
                <Users size={18} className="text-coffee-500" aria-hidden="true" />
                <h2 className="font-header font-bold text-coffee">Download member lists</h2>
            </div>

            <ul className="space-y-2">
                {visible.map(({ scope, label, blurb }) => (
                    <li key={scope}>
                        <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => run(scope, label)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl bg-cream-300 text-left
                                       hover:bg-cream-400 transition-colors disabled:opacity-60 min-h-11"
                        >
                            {busy === scope
                                ? <Loader2 size={18} className="animate-spin shrink-0 text-coffee-500" aria-hidden="true" />
                                : scope === 'airport'
                                    ? <Plane size={18} className="shrink-0 text-coffee-500" aria-hidden="true" />
                                    : <Download size={18} className="shrink-0 text-coffee-500" aria-hidden="true" />}
                            <span className="min-w-0">
                                <span className="block text-sm font-bold text-coffee">{label}</span>
                                <span className="block text-xs text-coffee-500">{blurb}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>

            {!isCoordinator && (
                // Explained rather than silently absent, so a manager does not conclude
                // the feature is missing. The gate is real: that list carries dates of
                // birth.
                <p className="text-xs text-coffee-500">
                    The Airport Seva list is for airport coordinators only.
                </p>
            )}
            {confirmDialog}
        </section>
    );
};
