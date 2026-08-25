import React, { useState } from 'react';
import { AlertTriangle, MessageCircle, Phone, Plane } from 'lucide-react';
import { Disclosure } from '../shared/Disclosure';
import { useConfirm } from '../shared/useConfirm';
import { DriverPicker } from '../manager/DriverPicker';
import { useAvailableDrivers } from '../../hooks/useUsers';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { updateAirportPickup } from '../../src/utils/cloudFunctions';
import { airportLabel, canRun, urgencyOf } from '../../src/utils/arrival';
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
    claim: 'I will collect them',
    met: 'I have met them',
    completed: 'Dropped off safely',
    no_show: 'Could not find them',
    release: 'Hand this back',
};

/** Which of those need confirming, and what the dialog says. */
const ACTION_CONFIRM: Partial<Record<ArrivalAction, { message: string; destructive?: boolean }>> = {
    release: {
        message: 'This puts the arrival back on the board for another Sarthi. Continue?',
        destructive: true,
    },
    no_show: {
        message: 'Mark that you could not find them? A coordinator will be able to reassign it.',
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
    const { currentUser, userProfile } = useAuth();
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busy, setBusy] = useState<ArrivalAction | null>(null);
    const [picking, setPicking] = useState(false);
    const [reassigningTo, setReassigningTo] = useState<string | null>(null);

    // Every approved Sarthi, not only the ones on shift for a sabha tonight — an
    // airport run is weeks out and has nothing to do with a Friday rota. The hook
    // already queries the GRANTED role set, which is why it finds the managers who
    // drive; querying `role == 'driver'` listed nobody in this congregation.
    const { drivers, loading: driversLoading } = useAvailableDrivers();

    const uid = currentUser?.uid ?? '';
    const isMine = arrival.claimedByUid === uid;
    const urgency = urgencyOf(arrival.arrivalAt);
    const style = URGENCY_STYLE[urgency];
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

    const reassign = async (toUid: string, toName: string) => {
        setReassigningTo(toUid);
        try {
            await updateAirportPickup({ pickupId: arrival.id, action: 'reassign', toUid });
            toast.success(`Given to ${toName}`);
            setPicking(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'That could not be reassigned');
        } finally {
            setReassigningTo(null);
        }
    };

    // Coordinator-only, and the server checks the same thing — the flag is the one
    // place it really is a gate. Rendered on the CARD rather than on a separate
    // oversight screen: the trip you want to move is the one you are looking at, and
    // a second list of the same arrivals would be a screen to keep in step.
    const canReassign = isCoordinator && canRun('reassign', arrival.status);

    /**
     * The actions this person may take, from the shared table plus who they are.
     *
     * `claim` is filtered out for the traveller's own arrival because the server
     * refuses it — rendering it would be a button that always fails.
     */
    const actions = (Object.keys(ACTION_LABEL) as ArrivalAction[]).filter(action => {
        if (!canRun(action, arrival.status)) return false;
        if (action === 'claim') return arrival.requesterUid !== uid;
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
                    arrival.claimedByName ? `With ${arrival.claimedByName}` : 'Nobody yet',
                ].filter(Boolean).join(' · ')}
                trailing={
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shrink-0 ${style.chip}`}>
                        {style.label}
                    </span>
                }
            >
                <div className="space-y-4">
                    {arrival.arrivalTimeChangedAt && (
                        // The flight moved after somebody claimed it. Loud, because a
                        // Sarthi who does not see this drives to an empty barrier.
                        <p className="flex items-start gap-2 text-sm font-bold text-[rgb(var(--danger))]">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                            The flight time has changed since this was claimed.
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
                            <CallButton label="Call other number" phone={arrival.passenger.altPhone} />
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
                            {arrival.familyNotifiedAt ? 'Message the family again' : 'Tell the family they are safe'}
                        </button>
                    )}
                    {arrival.familyNotifiedAt && (
                        <p className="text-xs text-coffee-500">The family has been messaged.</p>
                    )}

                    {canReassign && (
                        <button
                            type="button"
                            onClick={() => setPicking(true)}
                            className="clay-button w-full py-3 rounded-xl font-bold text-coffee bg-cream-300"
                        >
                            Give this to another Sarthi
                        </button>
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

            {/* The manager's existing picker, unchanged. `seats` is the party size
                here rather than a rider count, so the capacity hint beside each name
                still answers the right question: will they all fit. */}
            <DriverPicker
                open={picking}
                onClose={() => setPicking(false)}
                riderName={arrival.passenger.name}
                seats={arrival.partySize}
                drivers={drivers.filter(d => d.id !== arrival.claimedByUid)}
                loading={driversLoading}
                assigningId={reassigningTo}
                onPick={d => reassign(d.id, String(d.name ?? 'a Sarthi'))}
            />
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
