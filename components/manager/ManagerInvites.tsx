import React, { useState } from 'react';
import { KeyRound, Loader2, AlertCircle } from 'lucide-react';
import { createManagerInvite, CreateInviteResult } from '../../src/utils/cloudFunctions';
import { messageOf } from '../../src/utils/errorText';

/** Must match INVITE_TTL_DAYS in functions/src/utils/invites.ts. */
const INVITE_TTL_DAYS = 7;

/**
 * Minting a single-use code that makes someone else a manager.
 *
 * MOVED HERE 2026-08-18. This lived inside the **Venue** section of Setup — under
 * a heading about where drivers are routed to, which is not where anyone would
 * look for it. Granting manager rights is a people decision, so it belongs on the
 * People page beside approving riders and drivers.
 *
 * Extracted rather than inlined because it owns four pieces of state and a
 * callable, and because `newInvite` holds the ONLY copy of the code that will ever
 * exist — Firestore stores a salted hash. That is worth keeping in one named place
 * instead of spread through a page that also lists pending approvals.
 */
export const ManagerInvites: React.FC = () => {
    const [inviteLabel, setInviteLabel] = useState('');
    const [minting, setMinting] = useState(false);
    const [newInvite, setNewInvite] = useState<CreateInviteResult | null>(null);
    const [inviteError, setInviteError] = useState<string | null>(null);

    const handleCreateInvite = async () => {
        setMinting(true);
        setInviteError(null);
        setNewInvite(null);
        try {
            setNewInvite(await createManagerInvite(inviteLabel.trim() || undefined));
            setInviteLabel('');
        } catch (err: unknown) {
            console.error('Error creating manager invite:', err);
            setInviteError(messageOf(err, 'Could not create an invite.'));
        } finally {
            setMinting(false);
        }
    };

    return (
        <section className="clay-card p-4 space-y-3">
            <div className="flex items-center gap-2">
                <KeyRound size={16} className="text-saffron" />
                <h2 className="text-sm font-bold text-coffee">Manager invites</h2>
            </div>

            <p className="text-xs text-coffee-500">
                Creates a single-use code that expires in {INVITE_TTL_DAYS} days. Give it to
                one person. You will see it once — it is stored scrambled, so it cannot be
                looked up later.
            </p>

            <input
                type="text"
                value={inviteLabel}
                onChange={(e) => setInviteLabel(e.target.value)}
                placeholder="Who is this for? (optional, for your records)"
                aria-label="Who is this invite for"
                className="w-full px-3 py-2 rounded-lg border border-mocha/20 text-sm focus:outline-none focus:border-saffron bg-surface"
                disabled={minting}
            />

            <button
                onClick={handleCreateInvite}
                disabled={minting}
                /*
                 * `saffron-800`, NOT `saffron`. `--accent` is the FILL-ONLY rung —
                 * tailwind.config.js says "2.84:1, fills only" right beside it — and it
                 * was being used here for both the LABEL and the boundary of an outline
                 * button, where there is no fill to sit on. Measured on the card in the
                 * rendered page: 2.50:1 for 14px semibold text, against 4.5.
                 *
                 * The same family as the two fixed earlier on 2026-08-25 — saffron fill
                 * under white text, and clay-button-secondary's label taking `--cta-fill`.
                 * A fill token doing a text job.
                 *
                 * The border moves with it: a control's own boundary needs 3:1 under WCAG
                 * 1.4.11, and `--accent` gave 2.84 there too.
                 */
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-saffron-800 text-saffron-800 rounded-lg font-semibold text-sm hover:bg-saffron/5 disabled:opacity-50 transition-all"
            >
                {minting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                {minting ? 'Creating…' : 'Create an invite'}
            </button>

            {inviteError && (
                <div className="flex items-center gap-2 text-[rgb(var(--danger-text))] bg-[rgb(var(--danger-bg))] px-3 py-2 rounded-lg">
                    <AlertCircle size={14} />
                    <span className="text-xs">{inviteError}</span>
                </div>
            )}

            {/* Shown once. Nothing can retrieve it again, so it stays on screen
                until the manager dismisses it rather than auto-hiding. */}
            {newInvite && (
                <div className="bg-[rgb(var(--success-bg))] border-2 border-[rgb(var(--success))]/40 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-bold text-[rgb(var(--success-text))]">
                        Copy this now — it will not be shown again
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-sm bg-surface px-3 py-2 rounded border border-[rgb(var(--success))]/40 tracking-wider select-all break-all">
                            {newInvite.code}
                        </code>
                        <button
                            onClick={() => navigator.clipboard?.writeText(newInvite.code)}
                            className="px-3 py-2 text-xs font-semibold text-[rgb(var(--success-text))] border border-[rgb(var(--success))]/40 rounded hover:bg-[rgb(var(--success-bg))]"
                        >
                            Copy
                        </button>
                    </div>
                    <p className="text-[11px] text-[rgb(var(--success-text))]">
                        Expires {new Date(newInvite.expiresAt).toLocaleDateString()}. Single use.
                    </p>
                    <button
                        onClick={() => setNewInvite(null)}
                        className="text-[11px] text-[rgb(var(--success-text))] underline"
                    >
                        Done, hide it
                    </button>
                </div>
            )}
        </section>
    );
};
