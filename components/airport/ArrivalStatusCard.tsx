import React, { useState } from 'react';
import { AlertTriangle, Check, Loader2, Phone, Plane } from 'lucide-react';
import { useConfirm } from '../shared/useConfirm';
import { useToast } from '../../contexts/ToastContext';
import { updateAirportPickup } from '../../src/utils/cloudFunctions';
import { airportLabel, canRun } from '../../src/utils/arrival';
import { formatTime } from '../../src/constants/schedule';
import { PushPrompt } from '../shared/PushPrompt';
import type { ArrivalStatus } from '../../src/utils/arrival';
import type { AirportPickup } from '../../types';

/**
 * What the traveller sees after they have asked.
 *
 * The one question this screen answers is "is somebody coming for me", and it has to
 * answer it before they board a plane. So the top line is the status in words, and
 * everything a Sarthi has told us — their name, when they claimed it — is next to it.
 *
 * IT IS ALSO THE THING THEY SCREENSHOT. Most people land on a dead SIM with no data,
 * which means whatever is on this screen before they fly is all they have at the
 * barrier. Hence the plain summary block rather than anything that needs a live
 * connection to make sense.
 */

const STATUS_LINE: Record<ArrivalStatus, { title: string; body: string; tone: 'wait' | 'good' | 'bad' }> = {
    open: {
        title: 'Waiting for a Sarthi',
        body: 'Your request is on the board. You will see a name here as soon as somebody takes it.',
        tone: 'wait',
    },
    claimed: {
        title: 'A Sarthi is coming',
        body: 'They have your flight details and will meet you at arrivals.',
        tone: 'good',
    },
    met: {
        title: 'You have been met',
        body: 'Your Sarthi has you and can message your family to say you are safe.',
        tone: 'good',
    },
    completed: {
        title: 'Dropped off',
        body: 'This pickup is finished. Jai Swaminarayan.',
        tone: 'good',
    },
    cancelled: {
        title: 'Cancelled',
        body: 'This request was withdrawn. You can ask again if you still need collecting.',
        tone: 'bad',
    },
    no_show: {
        title: 'You were not found',
        body: 'Your Sarthi could not find you at the airport. A coordinator can send somebody else — call them.',
        tone: 'bad',
    },
};

/**
 * What to say about the Sarthi, per status. Absent means say nothing — on a
 * cancelled, no-show or completed trip the status block above already carries the
 * whole truth, and naming a Sarthi beside it only invites the wrong reading.
 */
const CLAIMED_LINE: Partial<Record<ArrivalStatus, string>> = {
    claimed: 'is collecting you.',
    met: 'has met you.',
    completed: 'dropped you off.',
};

/**
 * SEMANTIC PAIRS, not hand-mixed tints — and this is the same lesson ArrivalCard's
 * URGENCY_STYLE already records a paragraph about, which this file never got.
 *
 * Measured with the tint COMPOSITED over the card, which is the only honest way to read
 * a `/15` background:
 *
 *   good  bg-saffron/15 + text-saffron-dark    2.20 light  3.06 dark   ->  6.99 / 6.72
 *   bad   bg-[--danger]/15 + text-[--danger]   2.76 light  3.30 dark   ->  8.25 / 6.74
 *
 * All four were under the 4.5 this 12px text needs, and "You were not found" is on the
 * one card a traveller reads while standing in an airport nobody has come to.
 *
 * The cause is that `--accent` and `--danger` are FILL-ONLY rungs, asserted below AA on
 * purpose, and a 15%-opacity tint of a colour is not a surface that same colour can be
 * read on. The `-bg`/`-text` pairs are designed together and already measured.
 *
 * A NOTE ON THE MEASUREMENT, because it nearly went in wrong: the first pass reported
 * 1.15 and 1.00, from a DOM scan that read each background's colour and ignored its
 * ALPHA — so a 15% tint was scored as a full-strength fill. The verdict happened to be
 * right and the numbers were nonsense. Composite the alpha, or do not quote a figure.
 */
const TONE_CLASS = {
    wait: 'bg-cream-300 text-coffee',
    good: 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]',
    bad: 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]',
} as const;

interface ArrivalStatusCardProps {
    /** Open the request form, pre-filled from this trip. */
    onEdit: () => void;
    arrival: AirportPickup;
    /** Lets the traveller start a new request once this one is cancelled. */
    onCancelled: () => void;
}

export const ArrivalStatusCard: React.FC<ArrivalStatusCardProps> = ({ arrival, onCancelled, onEdit }) => {
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busy, setBusy] = useState(false);

    const status = STATUS_LINE[arrival.status];
    const canCancel = canRun('cancel', arrival.status);
    // Same shared table the server checks. Once the Sarthi has them, the details
    // are settled and the edit disappears rather than failing.
    const canEdit = canRun('editRequest', arrival.status);

    const cancel = async () => {
        const ok = await ask({
            title: 'Cancel your pickup?',
            message: arrival.claimedByName
                ? `${arrival.claimedByName} has agreed to collect you. Cancelling tells them not to come.`
                : 'This takes your request off the board.',
            confirmLabel: 'Cancel the pickup',
            destructive: true,
        });
        if (!ok) return;

        setBusy(true);
        try {
            await updateAirportPickup({ pickupId: arrival.id, action: 'cancel' });
            toast.success('Your pickup has been cancelled.');
            onCancelled();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'That could not be cancelled');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="p-4 lg:p-6 space-y-4 max-w-2xl mx-auto">
            <section className="clay-card p-5 space-y-3">
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${TONE_CLASS[status.tone]}`}>
                    {status.tone === 'good' ? <Check size={14} aria-hidden="true" />
                        : status.tone === 'bad' ? <AlertTriangle size={14} aria-hidden="true" />
                            : <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                    {status.title}
                </div>
                <p className="text-sm text-coffee-500">{status.body}</p>

                {/* WORDED PER STATUS, not one line for all of them.
                    Found by the visual harness (preview/airport.tsx): rendering this
                    whenever a Sarthi's name was set said "Nilesh is collecting you"
                    on a trip that was already finished — and, worse, on a `no_show`,
                    where the one thing the traveller knows is that nobody found them.
                    A screen that tells somebody standing in an airport that a Sarthi
                    is on the way when they are not is the worst version of the
                    silently-wrong failure this repo keeps removing. */}
                {arrival.claimedByName && CLAIMED_LINE[arrival.status] && (
                    <p className="text-coffee">
                        <span className="font-bold">{arrival.claimedByName}</span>{' '}
                        {CLAIMED_LINE[arrival.status]}
                    </p>
                )}
            </section>

            {/* The block to screenshot. Deliberately plain text with no icons carrying
                meaning: it has to be readable from a photo, at a barrier, on a phone
                with no data. */}
            <section className="clay-card p-5" aria-label="Your pickup details">
                <h2 className="flex items-center gap-2 font-header font-bold text-coffee mb-3">
                    <Plane size={18} aria-hidden="true" />
                    Show this at arrivals
                </h2>
                <dl className="space-y-2 text-sm">
                    <Row label="Name" value={arrival.passenger.name} />
                    <Row label="Landing" value={`${arrival.arrivalDate} at ${formatTime(arrival.arrivalTime)}`} />
                    <Row label="Airport" value={airportLabel(arrival.airportCode)} />
                    {arrival.terminal && <Row label="Terminal" value={arrival.terminal} />}
                    {(arrival.airline || arrival.flightNumber) && (
                        <Row label="Flight" value={[arrival.airline, arrival.flightNumber].filter(Boolean).join(' ')} />
                    )}
                    {arrival.dropoffAddress && (
                        <Row label="Going to" value={arrival.dropoffAddress} />
                    )}
                    <Row
                        label="Party"
                        value={`${arrival.partySize} ${arrival.partySize === 1 ? 'person' : 'people'}, `
                            + `${arrival.largeBags + arrival.cabinBags} bags`}
                    />
                    {arrival.claimedByName && <Row label="Your Sarthi" value={arrival.claimedByName} />}
                    {arrival.meetingPointNote && <Row label="Meeting point" value={arrival.meetingPointNote} />}
                </dl>
            </section>

            {arrival.status === 'no_show' && (
                <p className="flex items-start gap-2 text-sm text-[rgb(var(--danger-text))]" role="alert">
                    <Phone size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                    {/* Said "needs somebody to reassign it" until 2026-08-25, when the
                        reassign button was removed. Advice naming a control that no
                        longer exists is worse than no advice — it sends somebody
                        standing in an airport looking for it. */}
                    If you are still at the airport, call the seva coordinator so we can
                    put you back on the board for another Sarthi.
                </p>
            )}

            {/* Rendered only when the shared transition table says a cancel is
                possible. A finished or already-cancelled trip shows no button rather
                than one that returns failed-precondition. */}
            {/* Only while the trip is live. Offering notifications for a journey that
                is finished or withdrawn spends the one iOS permission on nothing.

                The promise is exactly one message, which is exactly what the server
                sends: notifyTravellerSarthiAssigned, on claim. Their Sarthi changing
                the flight is not mentioned because the traveller is the one who
                changes it. */}
            {canCancel && (
                <PushPrompt
                    title="Get told when a Sarthi takes your pickup"
                    detail="One notification, when somebody is assigned to collect you. Nothing else."
                />
            )}

            {/* ABOVE the cancel, and worded as the smaller act. A traveller whose
                flight moved was cancelling and re-filing, which loses their Sarthi. */}
            {canEdit && (
                <button
                    type="button"
                    onClick={onEdit}
                    className="clay-button w-full py-3 rounded-xl font-bold text-coffee bg-cream-300"
                >
                    Change my details
                </button>
            )}

            {canCancel && (
                <button
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    className="clay-button w-full py-3 rounded-xl font-bold text-[rgb(var(--danger-text))] bg-cream-300 disabled:opacity-60"
                >
                    {busy ? 'Cancelling…' : 'Cancel this pickup'}
                </button>
            )}
            {confirmDialog}
        </div>
    );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex gap-3">
        <dt className="w-28 shrink-0 text-coffee-500">{label}</dt>
        <dd className="text-coffee font-bold break-words">{value}</dd>
    </div>
);
