import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle, Phone, Plane } from 'lucide-react';
import { Disclosure } from '../shared/Disclosure';
import { useConfirm } from '../shared/useConfirm';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { updateAirportPickup } from '../../src/utils/cloudFunctions';
import { airportLabel, canRun, changeSummary, urgencyOf } from '../../src/utils/arrival';
import type { ArrivalAction, UrgencyLevel } from '../../src/utils/arrival';
import { familyReassuranceMessage, waLink } from '../../src/utils/whatsapp';
import { formatTime } from '../../src/constants/schedule';
import type { AirportPickup } from '../../types';

/**
 * One arrival, collapsed to what a Sarthi needs to decide and expanded to everything.
 *
 * PROGRESSIVE DISCLOSURE, on the owner's instruction: the row carries the logistics
 * that answer "could I do this one" — when, which airport, how many people, how much
 * luggage, whether anyone has it — and the panel carries the person. Putting a date of
 * birth and a home address on a collapsed row would make a scrollable list of them.
 *
 * Built on the existing `Disclosure`, so one row is open at a time and a closed row's
 * contents are out of the accessibility tree and out of Ctrl-F. That last part is the
 * point rather than a side effect: a collapsed card genuinely does not publish a
 * traveller's address to the page.
 *
 * EVERY BUTTON HERE IS DECIDED BY THE SHARED TRANSITION TABLE, not by a hand-written
 * condition. `canRun` comes from src/utils/arrival.ts, which is pinned to its server
 * mirror — so a control that renders is one the server will accept, and there is no
 * second list to fall out of step.
 */

/**
 * The urgency chip, in the design system's own semantic pairs.
 *
 * NOT hand-mixed tints, which is what these were first. Measured in a browser
 * against the real stylesheet, `bg-saffron/20 text-saffron-dark` came out at
 * **2.24:1** and a 15%-opacity danger tint at **2.95:1** — on `text-[10px]`
 * uppercase, which is small text and needs 4.5:1. The ramp's own notes
 * (tailwind.config.js) give per-shade ratios AGAINST THE CANVAS, and a tinted chip
 * background is not the canvas, so a shade that is AA on the page is not
 * automatically AA in here.
 *
 * `--warning-bg`/`--warning-text` and the rest are designed as pairs and are what
 * ManagerRecords and UserDetailSheet already use for the same job. Reusing them means
 * one place decides these contrasts and dark mode comes for free.
 *
 * 'overdue' shares the danger pair with 'critical' and separates itself with a RING
 * rather than a stronger fill. A solid `--danger` with white text measures 3.76:1 —
 * the more alarming option was the less readable one.
 */
/**
 * 'done' is NOT an urgency and deliberately does not come from `urgencyOf`, which is a
 * pure function of the clock and is mirrored to the server. A completed trip was still
 * being measured against its landing time, so a pickup that had already been delivered
 * wore a red "Landing soon" chip — the card shouting about a job that was finished.
 * Status decides first; the clock only speaks when the trip is still live.
 *
 * The success pair, same as the calendar's "everyone has a Sarthi" badge: 6.99:1 light
 * and 6.72:1 dark on its own fill, so it clears AA at this 10px size.
 */
const DONE_FMT = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long' });

const DONE_STYLE = {
    chip: 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]',
    label: 'Dropped off',
};

const URGENCY_STYLE: Record<UrgencyLevel, { chip: string; label: string }> = {
    calm: { chip: 'bg-cream-400 text-coffee-700', label: 'Plenty of time' },
    soon: { chip: 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]', label: 'Within 2 days' },
    urgent: { chip: 'bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]', label: 'Within a day' },
    critical: { chip: 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]', label: 'Landing soon' },
    overdue: {
        chip: 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] ring-1 ring-[rgb(var(--danger))]',
        label: 'Already landed',
    },
};

/** Labels the actions a Sarthi or coordinator can take, in the order they happen. */
const ACTION_LABEL: Partial<Record<ArrivalAction, string>> = {
    claim: "I'll collect them",
    met: "I've found them",
    // NOT 'Dropped off' — that is what DONE_STYLE's chip says. One is a state, the
    // other is a thing you tap; sharing a label makes a card that reads twice.
    completed: 'Dropped them off',
    no_show: "Couldn't find them",
    // "I can't go" rather than "Hand this back": it says why the person is tapping,
    // which is what they would say out loud, and it is two words shorter.
    release: "I can't go",
};

/** Which of those need confirming, and what the dialog says. */
const ACTION_CONFIRM: Partial<Record<ArrivalAction, { message: string; destructive?: boolean }>> = {
    release: {
        message: 'This puts the arrival back on the board for another Sarthi. Continue?',
        destructive: true,
    },
    no_show: {
        message: 'Mark that you could not find them? It stays with you until you hand it back.',
        destructive: true,
    },
};

interface ArrivalCardProps {
    arrival: AirportPickup;
    /** Coordinators get the actions on trips they do not hold. */
    isCoordinator: boolean;
    open: boolean;
    onToggle: () => void;
}

export const ArrivalCard: React.FC<ArrivalCardProps> = ({
    arrival, isCoordinator, open, onToggle,
}) => {
    const { currentUser, userProfile, activeRole } = useAuth();
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busy, setBusy] = useState<ArrivalAction | null>(null);

    const uid = currentUser?.uid ?? '';
    const isMine = arrival.claimedByUid === uid;

    /**
     * CLAIMING IS A SARTHI'S ACT, so it is offered to whoever is wearing that hat —
     * not to whoever holds the capability.
     *
     * The role hierarchy expands downward, `manager → driver → student`, so every
     * manager is a granted Sarthi and every manager was being shown "I'll collect
     * them" while doing coordinator work. A manager who wants to drive switches to
     * Sarthi, which is one tap and is what the switcher is for.
     *
     * DELIBERATELY UI-ONLY. `updateAirportPickup` still accepts a claim from any
     * approved driver, which is right: this decides what we OFFER, not what we ALLOW,
     * and a stale tab must not start failing. Every other action is unchanged — a
     * coordinator's oversight buttons are organising work, not driving, and with the
     * picker gone their `release` is the only way to recover an abandoned trip.
     */
    const wearingSarthiHat = activeRole === 'driver';
    const isDone = arrival.status === 'completed';
    const style = isDone ? DONE_STYLE : URGENCY_STYLE[urgencyOf(arrival.arrivalAt)];
    const bags = arrival.largeBags + arrival.cabinBags;

    const run = async (action: ArrivalAction) => {
        const confirm = ACTION_CONFIRM[action];
        if (confirm && !await ask({ ...confirm, confirmLabel: ACTION_LABEL[action] })) return;

        setBusy(action);
        try {
            await updateAirportPickup({ pickupId: arrival.id, action });
            toast.success(ACTION_LABEL[action] ?? 'Updated');
        } catch (err) {
            // The SERVER'S message, not a generic retry prompt. "It is with Kiran" is
            // the one thing a Sarthi who just lost the race needs to read, and
            // callFunction rethrows it for exactly that reason.
            toast.error(err instanceof Error ? err.message : 'That could not be saved');
        } finally {
            setBusy(null);
        }
    };

    /**
     * The actions this person may take, from the shared table plus who they are.
     *
     * `claim` is filtered out for the traveller's own arrival because the server
     * refuses it — rendering it would be a button that always fails.
     */
    const actions = (Object.keys(ACTION_LABEL) as ArrivalAction[]).filter(action => {
        if (!canRun(action, arrival.status)) return false;
        if (action === 'claim') return arrival.requesterUid !== uid && wearingSarthiHat;
        return isMine || isCoordinator;
    });

    // Null unless there is a real number to send to. A wa.me link built from a
    // missing one opens WhatsApp on a blank contact picker, and the Sarthi walks away
    // believing the family was told.
    const family = arrival.passenger.familyContact;
    const familyLink = canRun('familyNotified', arrival.status)
        && (isMine || isCoordinator)
        ? waLink(family?.phone, familyReassuranceMessage({
            sarthiName: userProfile?.name ?? 'a Sarthi',
            travellerName: arrival.passenger.name,
            airportLabel: airportLabel(arrival.airportCode),
            // Optional at the helper, which drops the "on our way to" sentence when
            // it is absent. Guarded because `.split` on an undefined address throws
            // and would take the whole card down with it.
            destination: arrival.dropoffAddress?.split(',')[1]?.trim(),
        }))
        : null;

    const tellFamily = () => {
        if (!familyLink) return;
        window.open(familyLink, '_blank', 'noopener,noreferrer');
        // Stamped so the board can tell "told them" from "meant to". Deliberately not
        // awaited and deliberately silent on failure: the message has already gone,
        // and an error toast about bookkeeping would read as though it had not.
        void updateAirportPickup({ pickupId: arrival.id, action: 'familyNotified' })
            .catch(() => undefined);
    };

    return (
        <>
            <Disclosure
                open={open}
                onToggle={onToggle}
                icon={<Plane size={20} aria-hidden="true" />}
                title={`${formatTime(arrival.arrivalTime)} · ${arrival.airportCode}`}
                summary={[
                    arrival.terminal ? `Terminal ${arrival.terminal}` : null,
                    `${arrival.partySize} ${arrival.partySize === 1 ? 'person' : 'people'}`,
                    `${bags} ${bags === 1 ? 'bag' : 'bags'}`,
                    arrival.claimedByName
                        ? `${isDone ? 'Dropped off by' : 'With'} ${arrival.claimedByName}`
                        : 'Nobody yet',
                ].filter(Boolean).join(' · ')}
                trailing={
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shrink-0 ${style.chip}`}>
                        {style.label}
                    </span>
                }
            >
                <div className="space-y-4">
                    {arrival.changedAt && !isDone && (
                        /* Something changed after somebody claimed it. Loud, because a
                           Sarthi who does not see this drives to an empty barrier — or
                           turns up in a car that will not hold the luggage.

                           NAMES WHAT CHANGED, from the same shared table the server
                           diffed against, so the card and the push say the same thing
                           and there is no second list to drift. The old version said
                           only "the flight time has changed", which was all it could
                           ever detect. */
                        <p className="flex items-start gap-2 text-sm font-bold text-[rgb(var(--danger))]">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                            {changeSummary(arrival.changedFields ?? []).length > 0
                                ? `Changed since you claimed this: ${
                                    changeSummary(arrival.changedFields ?? []).join(', ')}.`
                                : 'This request changed after it was claimed.'}
                        </p>
                    )}

                    {/* WHY THERE ARE NO BUTTONS. Without it a finished trip renders
                        as a live one with its actions missing, which reads as a broken
                        card rather than a delivered passenger — and that is exactly how
                        it was read. Nothing transitions out of 'completed', so the
                        absence is correct and only the explanation was missing. */}
                    {/* WHY THIS IS BACK ON THE BOARD. `releaseReason` has been written
                        since the feature shipped and read by nothing — a Sarthi typed
                        "car trouble" into a field no human ever saw. Shown only while
                        the trip is open again, because once somebody else has taken it
                        the previous holder's reason is history. */}
                    {arrival.status === 'open' && arrival.releaseReason && (
                        <p className="flex items-start gap-2 text-sm text-[rgb(var(--warning-text))]">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                            Handed back: {arrival.releaseReason}
                        </p>
                    )}

                    {isDone && (
                        <p className="flex items-center gap-2 text-sm font-bold text-[rgb(var(--success-text))]">
                            <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                            {arrival.completedAt
                                ? `Dropped off safely on ${DONE_FMT.format(new Date(arrival.completedAt))}.`
                                : 'Dropped off safely.'}
                        </p>
                    )}

                    <dl className="grid grid-cols-2 gap-3 text-sm">
                        <Detail label="Traveller" value={arrival.passenger.name} />
                        <Detail label="Arriving" value={`${arrival.arrivalDate} · ${formatTime(arrival.arrivalTime)}`} />
                        <Detail label="Airport" value={airportLabel(arrival.airportCode)} />
                        <Detail
                            label="Flight"
                            value={[arrival.airline, arrival.flightNumber].filter(Boolean).join(' ') || 'Not given'}
                        />
                        <Detail label="Date of birth" value={arrival.passenger.dateOfBirth} />
                        {arrival.dropoffAddress
                            ? <Detail label="Going to" value={arrival.dropoffAddress} span />
                            : (
                                // LOUD, not an empty row. The address is optional now
                                // because a traveller a month out often does not have
                                // one — but a Sarthi driving to the airport has to know
                                // it is a question they must ask, not a field that
                                // failed to load.
                                <Detail
                                    label="Going to"
                                    value="Not given yet — ask them where they are going before you set off."
                                    span
                                />
                            )}
                        {arrival.isInternational && (
                            <Detail
                                label="Note"
                                value="International arrival — allow 60 to 90 minutes for immigration and baggage."
                                span
                            />
                        )}
                        {!arrival.hasUsWorkingPhone && (
                            <Detail
                                label="No working phone on landing"
                                value={arrival.meetingPointNote || 'No meeting point agreed. Agree one before they fly.'}
                                span
                            />
                        )}
                        {arrival.needsStopOnTheWay && (
                            <Detail label="Stop on the way" value={arrival.needsStopOnTheWay} span />
                        )}
                        {arrival.notes && <Detail label="Notes" value={arrival.notes} span />}
                    </dl>

                    <div className="flex flex-wrap gap-2">
                        <CallButton label="Call" phone={arrival.passenger.phone} />
                        {arrival.passenger.altPhone && (
                            <CallButton label="Call second number" phone={arrival.passenger.altPhone} />
                        )}
                        {family && <CallButton label={`Call ${family.name}`} phone={family.phone} />}
                    </div>

                    {family && (
                        <div className="text-sm text-coffee-500">
                            <span className="font-bold text-coffee">Family: </span>
                            {family.name}
                            {family.relationship ? ` (${family.relationship})` : ''}
                            {family.preferredLanguage ? ` · speaks ${family.preferredLanguage}` : ''}
                        </div>
                    )}

                    {/* Rendered only when there is a real number AND the trip is at a
                        point where telling the family makes sense. No number, no
                        button — never a button that opens WhatsApp on nobody. */}
                    {familyLink && (
                        <button
                            type="button"
                            onClick={tellFamily}
                            // The app's own saffron, NOT WhatsApp's brand green. Two
                            // reasons, and the second is the real one:
                            //
                            //   tests/quality/theme-tokens.test.ts bans a raw hex
                            //   outside HEX_ALLOWED, and
                            //
                            //   white on #25D366 measures about 2:1. That is nowhere
                            //   near AA, on the one button in this feature a person
                            //   taps while walking through an airport. Borrowing a
                            //   brand colour is not worth an unreadable label; the
                            //   icon and the words say where it goes.
                            //
                            // Never appears beside the claim button, which is also
                            // saffron: claim only renders on an `open` trip and this
                            // only on a claimed or met one.
                            className="clay-button w-full py-3 rounded-xl font-bold text-[rgb(var(--text-on-accent))] bg-gradient-to-r from-[rgb(var(--cta))] to-[rgb(var(--cta-dark))] flex items-center justify-center gap-2"
                        >
                            <MessageCircle size={18} aria-hidden="true" />
                            {arrival.familyNotifiedAt ? 'Message them again' : 'Tell the family'}
                        </button>
                    )}
                    {arrival.familyNotifiedAt && (
                        <p className="text-xs text-coffee-500">The family has been messaged.</p>
                    )}

                    {/* WHY THE CLAIM BUTTON IS NOT HERE. Without this line a manager
                        sees a trip nobody has taken, no way to take it, and no reason
                        given — which reads as a broken screen rather than as a role
                        they are not currently wearing. */}
                    {canRun('claim', arrival.status)
                        && arrival.requesterUid !== uid
                        && activeRole !== null
                        && !wearingSarthiHat && (
                        <p className="text-sm text-coffee-500 pt-2 border-t border-hairline/10">
                            Switch to Sarthi to collect someone yourself.
                        </p>
                    )}

                    {actions.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-hairline/10">
                            {actions.map(action => (
                                <button
                                    key={action}
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={() => run(action)}
                                    className={`clay-button w-full py-3 rounded-xl font-bold disabled:opacity-60
                                        ${action === 'claim'
                                            ? 'text-[rgb(var(--text-on-accent))] bg-gradient-to-r from-[rgb(var(--cta))] to-[rgb(var(--cta-dark))]'
                                            : 'text-coffee bg-cream-300'}`}
                                >
                                    {busy === action ? 'Saving…' : ACTION_LABEL[action]}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Disclosure>

            {confirmDialog}
        </>
    );
};

const Detail: React.FC<{ label: string; value: string; span?: boolean }> = ({ label, value, span }) => (
    <div className={span ? 'col-span-2' : ''}>
        <dt className="text-[10px] font-bold uppercase tracking-wide text-coffee-500">{label}</dt>
        <dd className="text-coffee break-words">{value}</dd>
    </div>
);

/**
 * A `tel:` link, or nothing.
 *
 * Same rule as the WhatsApp button: `href="tel:"` with no number is a link that does
 * nothing. Five places in this app build one with a bare template literal and a `||
 * ''` fallback; this one refuses instead.
 */
const CallButton: React.FC<{ label: string; phone?: string }> = ({ label, phone }) => {
    if (!phone?.trim()) return null;
    return (
        <a
            href={`tel:${phone.trim()}`}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-300 text-coffee text-sm font-bold min-h-11"
        >
            <Phone size={16} aria-hidden="true" />
            {label}
        </a>
    );
};
