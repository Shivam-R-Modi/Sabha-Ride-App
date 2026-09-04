import React, { useEffect, useState } from 'react';
import { CalendarDays, CalendarPlus, Loader2, AlertCircle, Plus, Trash2, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useUpcomingEvents, editOccurrence, createOneOff, SabhaEvent } from '../../hooks/useEvents';
import { describeRule, labelForSource } from '../../src/utils/recurrence';
import { formatDateLong as formatDate } from '../../src/constants/schedule';
import { AGENDA_MAX_CHARS, agendaSummary, describeAgendaProblem } from '../../src/utils/agenda';
import { RecurringSabha } from './RecurringSabha';
import { previewDeleteSabhaEvent, deleteSabhaEvent } from '../../src/utils/cloudFunctions';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { useLocations } from '../../hooks/useLocations';
import type { SabhaLocationRecord } from '../../src/utils/locations';
import { useSettings } from '../../hooks/useSettings';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';
import { useConfirm } from '../shared/useConfirm';
import { formatTime } from '../../hooks/useSettings';
import {
    DROPOFF_LEAD_MINUTES, PICKUP_LEAD_DAYS, minutesOf, isUsableDuration, newSabhaTimes,
} from '../../src/constants/schedule';

/**
 * The sabha calendar, for managers.
 *
 * The date used to be a constant in the Cloud Function — sabha was Friday and
 * that was that. Each gathering now has its own date and times, and a manager can
 * move one, cancel one, or add a one-off.
 *
 * TWO CARDS: THE WEEKLY SABHA, AND THE EXTRA ONES
 * -----------------------------------------------
 * This once rendered up to twelve stacked rows, each carrying the same times, the
 * same derived ride window and its own delete button — near-identical by
 * construction under a repeating rule, and twelve one-tap deletes is how you
 * cancel the wrong week. That became one card plus a row of date chips.
 *
 * The chips are gone too. They listed the pattern back to a manager who had just
 * set it, and — worse — an added Saturday appeared between two Mondays as though
 * it were part of the schedule. It is not: it is a separate event.
 *
 * So: the next weekly sabha in full, and each extra sabha as its own card below.
 * An OVERRIDE stays on the weekly side (that is this week, edited), only a
 * one-off moves out, and whichever gathering is genuinely soonest is the one
 * labelled "Next sabha".
 *
 * The cost, deliberately accepted: only the NEXT weekly sabha can be edited or
 * cancelled. Cancelling a week that is a month out now needs a date field here
 * rather than a chip to tap.
 *
 * WHAT THESE DATES ARE
 * --------------------
 * Computed, not stored. The schedule is one rule in `settings/sabhaRecurrence`
 * that repeats with no end date; each date below is an occurrence of it, with any
 * exception for that date applied. Only the ones that DIVERGE carry a badge —
 * "Edited" or "One-off" — because the old version listed up to 26 stored,
 * near-identical dates and labelling all of them would be the same noise again.
 *
 * A cancelled date is never rendered at all. `useUpcomingEvents` filters
 * cancellations out before they arrive here, so there is no "cancelled" state to
 * draw — and a state the UI can render but the data can never reach is the
 * dead-control bug this codebase keeps removing.
 *
 * Editing one week writes an exception for that week alone: it keeps its own time
 * and venue and will not follow a later change to the rule. Cancelling goes
 * through the deleteSabhaEvent callable, which writes the cancellation AND removes
 * attendance responses (a subcollection Firestore leaves behind), cancels
 * outstanding ride requests and rewrites the published ride window.
 *
 * Note that cancelling writes a document rather than deleting one. Under the rule
 * model a missing document means "follows the schedule", so deleting would let the
 * rule place the gathering again and the cancellation would evaporate.
 */

/** Same date arithmetic as the server: pure calendar maths, no DST involvement. */
function shiftDate(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day + days));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * When rides actually open for this gathering, spelled out.
 *
 * The two lead times are deliberately NOT per-event fields — they are the only
 * settings that fail silently, so they stay policy. Showing the derived result
 * gives the manager the visibility without the footgun.
 */
function windowSummary(event: SabhaEvent): string {
    const requestsOpen = formatDate(shiftDate(event.date, -PICKUP_LEAD_DAYS));

    const endMinutes = minutesOf(event.endTime);
    const startMinutes = minutesOf(event.startTime);
    if (endMinutes === null || startMinutes === null) return `Requests open ${requestsOpen}`;

    const dropoff = Math.max(endMinutes - DROPOFF_LEAD_MINUTES, startMinutes + 1);
    const hh = String(Math.floor(dropoff / 60)).padStart(2, '0');
    const mm = String(dropoff % 60).padStart(2, '0');

    return `Requests open ${requestsOpen} · Drop-off ${formatTime(`${hh}:${mm}`)}`;
}

/**
 * One gathering, in full, with its own Edit and Cancel.
 *
 * Used for both kinds: the next weekly sabha at the top, and each extra sabha in
 * the card below. Keyed on the date by its caller, so when the weekly one rolls
 * over to the following week the edit fields re-seed from that week rather than
 * keeping the last one's.
 */
const EventDetail: React.FC<{
    event: SabhaEvent;
    /**
     * What this gathering is, in the caller's words — "Next sabha", "Next weekly
     * sabha", "Extra sabha".
     *
     * Passed in rather than derived. It used to be `isNext ? 'Next sabha' :
     * 'Selected week'`, which stopped being true the moment there was no
     * selection to speak of, and only the parent knows whether a one-off happens
     * to be the very next gathering.
     */
    label: string;
    /** Genuinely the next gathering of any kind — governs the "Rides open" pill. */
    isNext: boolean;
    ridesOpen: boolean;
    /**
     * The halls open for business, from the parent's ONE subscription.
     *
     * Passed down rather than read per row: the calendar draws up to eight of these,
     * and eight listeners on a two-document collection is eight for nothing.
     *
     * FEWER THAN TWO AND THIS ROW IS UNCHANGED — one "Cancel this week" button, no
     * hall names, nothing new to read. That is production today, and it is why a
     * single-hall project cannot see this feature at all. A choice with one option is
     * not a choice, and a hall name on a screen that has never carried one is noise.
     */
    halls: SabhaLocationRecord[];
}> = ({ event, label, isNext, ridesOpen, halls }) => {
    const { currentUser } = useAuth();
    const [editing, setEditing] = useState(false);
    const [start, setStart] = useState(event.startTime);
    const [end, setEnd] = useState(event.endTime);
    const [agenda, setAgenda] = useState(event.agenda);
    const [venueText, setVenueText] = useState(event.venue?.address ?? '');
    const [venuePlace, setVenuePlace] = useState<PlaceDetails | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { sabhaLocation } = useSettings();
    const { ask, confirmDialog } = useConfirm();

    const valid = isUsableDuration(start, end);

    const save = async () => {
        if (!currentUser) return;
        if (!valid) { setError(`Sabha must run for more than ${DROPOFF_LEAD_MINUTES} minutes.`); return; }
        // Checked here for a readable message. firestore.rules holds the real
        // ceiling, because this document is written straight from the browser.
        const agendaProblem = describeAgendaProblem(agenda);
        if (agendaProblem) { setError(agendaProblem); return; }

        setBusy(true);
        setError(null);
        try {
            // Only write a venue when it has coordinates. Clearing the box means
            // "use the default", which is null — not an address with no lat/lng.
            const venue = venuePlace
                ? {
                    lat: venuePlace.latitude,
                    lng: venuePlace.longitude,
                    address: venuePlace.formattedAddress,
                }
                : venueText.trim() === ''
                    ? null
                    : event.venue;

            await editOccurrence(
                event.id,
                { startTime: start, endTime: end, agenda, venue },
                currentUser.uid,
                // Carried through so a one-off stays a one-off. Without it this
                // wrote `override` for every row, and an override off the weekly
                // pattern is inert — which silently removed the gathering.
                event.source,
            );
            setEditing(false);
            setVenuePlace(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    /**
     * Cancel this gathering — at ONE hall, or the whole evening.
     *
     * `locationId` null means the evening. The scope is decided by which button was
     * pressed, never inferred here, and it is named in the dialog: a confirmation that
     * says "Cancel the sabha on the 21st" when the manager picked one room is how
     * somebody cancels both by accident.
     */
    const remove = async (locationId: string | null) => {
        if (!currentUser) return;

        setBusy(true);
        setError(null);
        try {
            // Ask the server what this would affect BEFORE showing the dialog, so
            // the manager sees real numbers rather than a generic warning.
            const preview = await previewDeleteSabhaEvent(event.id, locationId);

            const affected: string[] = [];
            if (preview.responseCount > 0) {
                affected.push(`${preview.responseCount} ${preview.responseCount === 1 ? 'person has' : 'people have'} responded`);
            }
            if (preview.requestedRideCount > 0) {
                affected.push(`${preview.requestedRideCount} ride ${preview.requestedRideCount === 1 ? 'request' : 'requests'} will be cancelled`);
            }

            // The server echoes the hall's NAME back, so the dialog names what the
            // manager actually picked rather than what this component believes it sent.
            const scope = preview.locationName
                ? `the sabha at ${preview.locationName}`
                : 'the whole evening';

            const ok = await ask({
                title: `Cancel ${formatDate(event.date)}?`,
                message: `This cancels ${scope}.\n\n`
                    + (affected.length > 0
                        ? `${affected.join(' and ')}. They will be notified.\n\nThis cannot be undone.`
                        : 'Nobody has responded or requested a ride yet.\n\nThis cannot be undone.'),
                confirmLabel: preview.locationName ? 'Cancel this sabha' : 'Cancel the evening',
                cancelLabel: 'Keep it',
                destructive: true,
            });
            if (!ok) {
                setBusy(false);
                return;
            }

            await deleteSabhaEvent(event.id, true, locationId);
            // The row disappears on its own — useUpcomingEvents is a live listener.
        } catch (err: unknown) {
            // Surfaced, not swallowed. The server refuses for good reasons (today's
            // sabha, a driver already on the road) and the manager needs the reason.
            setError(err instanceof Error ? err.message : 'Could not delete this sabha.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="px-4 py-4">
            {!editing && (
                <>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-coffee-500">
                            {label}
                        </span>
                        {/* Only shown on the next one, and only from the app's own
                            answer — `calendarStatus`. A pill that says rides are
                            open when they are not is worse than no pill. */}
                        {isNext && ridesOpen && (
                            <span className="text-[11px] font-bold bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))] px-2 py-0.5 rounded">
                                Rides open
                            </span>
                        )}
                        {/* Only dates that DIVERGE from the weekly schedule are
                            badged. Labelling every one "from the schedule" is
                            noise, and noise is what made 26 near-identical rows
                            unreadable in the first place. */}
                        {labelForSource(event.source) && (
                            <span className="text-[11px] font-bold uppercase tracking-wider bg-cream-300 text-coffee-700 px-2 py-0.5 rounded">
                                {labelForSource(event.source)}
                            </span>
                        )}
                    </div>

                    <p className="text-xl font-bold text-coffee mt-1">{formatDate(event.date)}</p>
                    <p className="text-sm text-coffee-700 mt-0.5">
                        {formatTime(event.startTime)} – {formatTime(event.endTime)}
                        {event.venue?.address ? ` · ${event.venue.address}` : ''}
                    </p>
                    {agendaSummary(event.agenda) && (
                        <p className="text-xs text-coffee-500 mt-1">{agendaSummary(event.agenda)}</p>
                    )}
                    <p className="text-[11px] text-coffee-500 mt-1.5">{windowSummary(event)}</p>

                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => setEditing(true)}
                            disabled={busy}
                            className="min-h-11 px-3 rounded-lg text-xs font-bold text-saffron-800 border border-saffron-800/35 hover:bg-cream-300 disabled:opacity-50"
                        >
                            Edit this week
                        </button>
                        {/* ONE BUTTON PER SCOPE, and each one says which sabha it
                            cancels. A single button plus a picker would mean the
                            destructive action and the thing it acts on live in two
                            places, and the manager reading the label would not be
                            reading the scope. With one hall open there is only one
                            scope, so this is the button it has always been. */}
                        {halls.length < 2 ? (
                            <button
                                onClick={() => remove(null)}
                                disabled={busy}
                                className="min-h-11 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 text-[rgb(var(--danger-text))] border border-[rgb(var(--danger))]/35 hover:bg-[rgb(var(--danger-bg))] disabled:opacity-50"
                            >
                                {busy
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : <Trash2 size={14} />}
                                Cancel this week
                            </button>
                        ) : (
                            <>
                                {halls.map(h => (
                                    <button
                                        key={h.id}
                                        onClick={() => remove(h.id)}
                                        disabled={busy}
                                        className="min-h-11 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 text-[rgb(var(--danger-text))] border border-[rgb(var(--danger))]/35 hover:bg-[rgb(var(--danger-bg))] disabled:opacity-50"
                                    >
                                        {busy
                                            ? <Loader2 size={14} className="animate-spin" />
                                            : <Trash2 size={14} />}
                                        Cancel {h.name}
                                    </button>
                                ))}
                                <button
                                    onClick={() => remove(null)}
                                    disabled={busy}
                                    className="min-h-11 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 text-[rgb(var(--danger-text))] border border-[rgb(var(--danger))]/35 hover:bg-[rgb(var(--danger-bg))] disabled:opacity-50"
                                >
                                    {busy
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <Trash2 size={14} />}
                                    Cancel the whole evening
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            {editing && (
                <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                            type="time" value={start} onChange={(e) => { setStart(e.target.value); setError(null); }}
                            disabled={busy}
                            className="w-full min-w-0 px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                        />
                        <input
                            type="time" value={end} onChange={(e) => { setEnd(e.target.value); setError(null); }}
                            disabled={busy}
                            className="w-full min-w-0 px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                        />
                    </div>
                    {/* A paragraph, not a line. The agenda is what the congregation
                        reads on their own dashboard, so it holds the evening's
                        detail — `whitespace-pre-line` there keeps the line breaks
                        typed here. */}
                    <textarea
                        value={agenda}
                        onChange={(e) => { setAgenda(e.target.value); setError(null); }}
                        placeholder="Agenda (optional) — shown to everyone on their dashboard"
                        disabled={busy}
                        rows={5}
                        maxLength={AGENDA_MAX_CHARS}
                        className="w-full px-2 py-1.5 rounded-lg border border-hairline/20 text-sm leading-relaxed resize-y focus:outline-none focus:border-saffron"
                    />
                    <div>
                        <AddressAutocomplete
                            value={venueText}
                            onChange={(val) => {
                                setVenueText(val);
                                if (venuePlace && val !== venuePlace.formattedAddress) setVenuePlace(null);
                                setError(null);
                            }}
                            onSelect={(details) => {
                                setVenuePlace(details);
                                setVenueText(details.formattedAddress);
                                setError(null);
                            }}
                            disabled={busy}
                            placeholder="Venue — leave blank for the default"
                        />
                        <p className="text-[10px] text-coffee-500 mt-0.5">
                            {venuePlace
                                ? `Selected — ${venuePlace.latitude.toFixed(5)}, ${venuePlace.longitude.toFixed(5)}`
                                : venueText.trim() === ''
                                    ? `Default: ${sabhaLocation.address}`
                                    : 'Pick from the suggestions to change the venue'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={save} disabled={busy || !valid}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] rounded-lg text-xs font-bold disabled:opacity-50"
                        >
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                        </button>
                        <button
                            onClick={() => {
                                setEditing(false);
                                setStart(event.startTime); setEnd(event.endTime); setAgenda(event.agenda);
                                setError(null);
                            }}
                            disabled={busy}
                            className="flex-1 px-2 py-1.5 border border-hairline/20 text-coffee-700 rounded-lg text-xs font-bold"
                        >
                            Discard
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p className="text-xs text-[rgb(var(--danger-text))] font-semibold mt-1.5">{error}</p>
            )}

            {confirmDialog}
        </div>
    );
};

export const SabhaCalendar: React.FC = () => {
    const { currentUser } = useAuth();
    const { events, loading, error, rule } = useUpcomingEvents();
    const { calendarStatus } = useCurrentEvent();
    /**
     * ONE subscription for the whole calendar, handed to every row.
     *
     * `active` and not `locations`: a retired hall has no gathering to cancel, and a
     * button for one would be a control that cannot work.
     *
     * Passed through as-is. Whether to draw per-hall buttons is `EventDetail`'s
     * decision and it makes it from the length — filtering here as well was a second
     * copy of the same rule, and mutation proved it changed nothing.
     */
    const { active: halls } = useLocations();

    const { sabhaLocation, sabhaStartTime, sabhaEndTime } = useSettings();

    const [adding, setAdding] = useState(false);
    const [date, setDate] = useState('');
    const [start, setStart] = useState(() => newSabhaTimes({ sabhaStartTime, sabhaEndTime }).start);
    const [end, setEnd] = useState(() => newSabhaTimes({ sabhaStartTime, sabhaEndTime }).end);
    const [agenda, setAgenda] = useState('');
    const [newVenueText, setNewVenueText] = useState('');
    const [newVenuePlace, setNewVenuePlace] = useState<PlaceDetails | null>(null);
    const [busy, setBusy] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    // Keep the prefill in step with the saved defaults, but only while the form
    // is CLOSED. `useSettings` hands back the shipped defaults for the first
    // render and the real values when the snapshot lands, so a plain initialiser
    // would freeze on 19:00/22:00 — and syncing under an open form would
    // overwrite whatever the manager was in the middle of typing.
    useEffect(() => {
        if (adding) return;
        const { start: s, end: e } = newSabhaTimes({ sabhaStartTime, sabhaEndTime });
        setStart(s);
        setEnd(e);
    }, [adding, sabhaStartTime, sabhaEndTime]);

    // Cancelled documents are filtered out upstream, so every date here is live.
    const nextScheduled = events[0];

    /**
     * The weekly sabha and the extra ones are different things, and used to share
     * one row of chips — so an added Saturday sat between two Mondays looking like
     * part of the pattern.
     *
     * An OVERRIDE stays on the weekly side: it is this week's sabha with its time
     * or venue changed, not an additional event. Only a one-off is an addition,
     * and `createOneOff` is the only thing "Add a sabha" ever calls, so the two
     * sides line up with how they were made.
     */
    const weekly = events.filter(e => e.source !== 'one-off');
    const oneOffs = events.filter(e => e.source === 'one-off');
    const nextWeekly = weekly[0];

    const add = async () => {
        if (!currentUser) return;
        if (!date) { setAddError('Pick a date.'); return; }
        if (!isUsableDuration(start, end)) { setAddError(`Sabha must run for more than ${DROPOFF_LEAD_MINUTES} minutes.`); return; }
        const agendaProblem = describeAgendaProblem(agenda);
        if (agendaProblem) { setAddError(agendaProblem); return; }

        setBusy(true);
        setAddError(null);
        try {
            await createOneOff(
                date, start, end, agenda, currentUser.uid,
                newVenuePlace
                    ? {
                        lat: newVenuePlace.latitude,
                        lng: newVenuePlace.longitude,
                        address: newVenuePlace.formattedAddress,
                    }
                    : null,
            );
            setAdding(false);
            setDate(''); setAgenda('');
            setNewVenueText(''); setNewVenuePlace(null);
        } catch (err: unknown) {
            setAddError(err instanceof Error ? err.message : 'Could not add.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
        {/* The pattern sits above the list: setting it is what stops the list
            running dry, so it should be read first. */}
        <RecurringSabha />

        {/* Labelled regions, not bare divs: with a gathering in each card the
            Edit and Cancel buttons repeat, and "which card is this one in" has
            to be answerable by a screen reader as much as by a test. */}
        <section
            aria-label="Sabha calendar"
            className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden mb-4"
        >
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <CalendarDays size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Sabha Calendar</h3>
                </div>
                {/* What the list IS, said once. These rows are computed from the
                    repeating schedule above — they are not stored dates a manager
                    has to maintain — and only the ones that diverge are badged. */}
                <p className="text-xs text-coffee-500 mt-1">
                    {rule?.enabled
                        ? <><strong>{describeRule(rule)}</strong>. Change or cancel one week
                            and the rest stay as they are.</>
                        : <>Not repeating yet. Set the schedule above, or add a single date
                            below.</>}
                </p>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-6">
                    <Loader2 size={20} className="animate-spin text-saffron" />
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-[rgb(var(--danger-text))] bg-[rgb(var(--danger-bg))] px-3 py-2 m-3 rounded-lg">
                    <AlertCircle size={14} />
                    <span className="text-xs">{error}</span>
                </div>
            )}

            {calendarStatus === 'no-scheduled-event' && (
                <div className="flex items-start gap-2 text-[rgb(var(--danger-text))] bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 px-3 py-2 m-3 rounded-lg">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span className="text-xs">
                        <span className="font-bold">Rides are closed.</span> There is no sabha
                        on the calendar, so nobody can request a ride. Add a date below.
                    </span>
                </div>
            )}

            {!loading && !error && events.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-coffee-500">
                    No sabhas scheduled. Add one below — rides cannot open without it.
                </p>
            )}

            {!loading && !error && events.length > 0 && !nextWeekly && (
                <p className="px-4 py-6 text-center text-xs text-coffee-500">
                    No weekly sabha coming up. Set the schedule above — the extra
                    sabhas below do not repeat.
                </p>
            )}

            {!loading && nextWeekly && (
                <>
                    {/* Keyed on the date so the next week re-seeds the edit fields
                        instead of carrying the previous one's values. */}
                    <EventDetail
                        key={nextWeekly.id}
                        event={nextWeekly}
                        // Only the truly soonest gathering claims "Next sabha". An
                        // extra sabha can fall before the next Monday, and a weekly
                        // card headlining "Next sabha" over a date that is not next
                        // is the kind of quietly-wrong screen this app keeps fixing.
                        label={nextWeekly.id === nextScheduled?.id ? 'Next sabha' : 'Next weekly sabha'}
                        isNext={nextWeekly.id === nextScheduled?.id}
                        halls={halls}
                        ridesOpen={calendarStatus === 'ok'}
                    />
                </>
            )}
        </section>

        {/* ── Extra sabhas ────────────────────────────────────────────────
            Its own card, because an added sabha is an additional event rather
            than a week of the pattern. Rendered even when there are none, so
            "Add a sabha" is always in the same place — and so the difference
            between the two kinds is stated before a manager has made one. */}
        <section
            aria-label="Extra sabhas"
            className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden mb-4"
        >
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <CalendarPlus size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Extra sabhas</h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    One-off gatherings alongside the weekly sabha. These do not repeat,
                    and changing the schedule above leaves them alone.
                </p>
            </div>

            {!loading && oneOffs.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-coffee-500">
                    None coming up. Add one below for an event that is not part of the
                    weekly schedule.
                </p>
            )}

            {!loading && oneOffs.map((event, index) => (
                <div
                    key={event.id}
                    className={index > 0 ? 'border-t border-hairline/10' : undefined}
                >
                    <EventDetail
                        event={event}
                        label={event.id === nextScheduled?.id ? 'Next sabha' : 'Extra sabha'}
                        isNext={event.id === nextScheduled?.id}
                        ridesOpen={calendarStatus === 'ok'}
                        halls={halls}
                    />
                </div>
            ))}

            <div className="px-4 py-3 border-t border-hairline/10 bg-cream-200/60">
                {!adding ? (
                    <button
                        onClick={() => setAdding(true)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-hairline/20 text-coffee-700 rounded-lg text-xs font-bold hover:border-saffron hover:text-saffron-800 transition-colors"
                    >
                        <Plus size={14} /> Add a sabha
                    </button>
                ) : (
                    <div className="space-y-2">
                        <input
                            type="date" value={date}
                            onChange={(e) => { setDate(e.target.value); setAddError(null); }}
                            disabled={busy}
                            className="w-full px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                                type="time" value={start} onChange={(e) => { setStart(e.target.value); setAddError(null); }}
                                disabled={busy}
                                className="w-full min-w-0 px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                            />
                            <input
                                type="time" value={end} onChange={(e) => { setEnd(e.target.value); setAddError(null); }}
                                disabled={busy}
                                className="w-full min-w-0 px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                            />
                        </div>
                        <textarea
                            value={agenda}
                            onChange={(e) => { setAgenda(e.target.value); setAddError(null); }}
                            placeholder="Agenda (optional) — shown to everyone on their dashboard"
                            disabled={busy}
                            rows={5}
                            maxLength={AGENDA_MAX_CHARS}
                            className="w-full px-2 py-1.5 rounded-lg border border-hairline/20 text-sm leading-relaxed resize-y focus:outline-none focus:border-saffron"
                        />
                        <div>
                            <AddressAutocomplete
                                value={newVenueText}
                                onChange={(val) => {
                                    setNewVenueText(val);
                                    if (newVenuePlace && val !== newVenuePlace.formattedAddress) setNewVenuePlace(null);
                                    setAddError(null);
                                }}
                                onSelect={(details) => {
                                    setNewVenuePlace(details);
                                    setNewVenueText(details.formattedAddress);
                                    setAddError(null);
                                }}
                                disabled={busy}
                                placeholder="Venue — leave blank for the default"
                            />
                            <p className="text-[10px] text-coffee-500 mt-0.5">
                                {newVenuePlace
                                    ? `Selected — ${newVenuePlace.latitude.toFixed(5)}, ${newVenuePlace.longitude.toFixed(5)}`
                                    : `Default: ${sabhaLocation.address}`}
                            </p>
                        </div>
                        {addError && <p className="text-xs text-[rgb(var(--danger-text))] font-semibold">{addError}</p>}
                        <div className="flex gap-2">
                            <button
                                onClick={add} disabled={busy}
                                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] rounded-lg text-xs font-bold disabled:opacity-50"
                            >
                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Add
                            </button>
                            <button
                                onClick={() => { setAdding(false); setAddError(null); }}
                                disabled={busy}
                                className="flex-1 px-2 py-1.5 border border-hairline/20 text-coffee-700 rounded-lg text-xs font-bold"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
        </>
    );
};
