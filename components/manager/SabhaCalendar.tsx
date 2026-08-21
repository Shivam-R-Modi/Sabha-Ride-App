import React, { useEffect, useState } from 'react';
import { CalendarDays, Loader2, AlertCircle, Plus, Trash2, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useUpcomingEvents, editOccurrence, createOneOff, SabhaEvent } from '../../hooks/useEvents';
import { describeRule, labelForSource } from '../../src/utils/recurrence';
import { AGENDA_MAX_CHARS, agendaSummary, describeAgendaProblem } from '../../src/utils/agenda';
import { RecurringSabha } from './RecurringSabha';
import { previewDeleteSabhaEvent, deleteSabhaEvent } from '../../src/utils/cloudFunctions';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
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
 * ONE CARD, NOT A LIST
 * --------------------
 * This used to render up to twelve stacked rows, each carrying the same times, the
 * same derived ride window, its own Edit and its own delete button. Under a
 * repeating rule those rows are near-identical by construction, so the screen grew
 * in proportion to how far ahead you could see while telling you nothing more.
 * Twelve one-tap deletes beside twelve identical rows is also how you cancel the
 * wrong Friday.
 *
 * So: the next sabha in full, then the following weeks as date chips. Tap a chip
 * to work on that week. The information that varies gets the space; the
 * information that repeats gets a chip.
 *
 * WHAT THESE DATES ARE
 * --------------------
 * Computed, not stored. The schedule is one rule in `settings/sabhaRecurrence`
 * that repeats with no end date; each date below is an occurrence of it, with any
 * exception for that date applied. Only the ones that DIVERGE carry a badge —
 * "Edited" or "One-off" — because the old version listed up to 26 stored,
 * near-identical dates and labelling all of them would be the same noise again.
 *
 * There is deliberately no "cancelled" chip. `useUpcomingEvents` filters cancelled
 * dates out before they arrive here, so a chip for one could never appear — and a
 * state the UI can render but the data can never reach is the dead-control bug
 * this codebase keeps removing.
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

/** "2026-08-14" -> "Friday 14 Aug". Uses the date parts directly, so no timezone shift. */
function formatDate(dateKey: string): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long', day: 'numeric', month: 'short',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** "2026-08-29" -> "29 Aug". The chips carry the date and nothing else. */
function shortDate(dateKey: string): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        day: 'numeric', month: 'short',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

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
 * One week, in full. Exactly one of these is on screen at a time — the week the
 * manager has selected, which starts as the next one.
 *
 * Keyed on the date by its caller, so selecting a different week remounts it and
 * the edit fields re-seed from that week rather than keeping the last one's.
 */
const EventDetail: React.FC<{
    event: SabhaEvent;
    isNext: boolean;
    ridesOpen: boolean;
}> = ({ event, isNext, ridesOpen }) => {
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

    const remove = async () => {
        if (!currentUser) return;

        setBusy(true);
        setError(null);
        try {
            // Ask the server what this would affect BEFORE showing the dialog, so
            // the manager sees real numbers rather than a generic warning.
            const preview = await previewDeleteSabhaEvent(event.id);

            const affected: string[] = [];
            if (preview.responseCount > 0) {
                affected.push(`${preview.responseCount} ${preview.responseCount === 1 ? 'person has' : 'people have'} responded`);
            }
            if (preview.requestedRideCount > 0) {
                affected.push(`${preview.requestedRideCount} ride ${preview.requestedRideCount === 1 ? 'request' : 'requests'} will be cancelled`);
            }

            const ok = await ask({
                title: `Delete ${formatDate(event.date)}?`,
                message: affected.length > 0
                    ? `${affected.join(' and ')}. They will be notified.\n\nThis cannot be undone.`
                    : 'Nobody has responded or requested a ride yet.\n\nThis cannot be undone.',
                confirmLabel: 'Delete sabha',
                cancelLabel: 'Keep it',
                destructive: true,
            });
            if (!ok) {
                setBusy(false);
                return;
            }

            await deleteSabhaEvent(event.id, true);
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
                            {isNext ? 'Next sabha' : 'Selected week'}
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
                        <button
                            onClick={remove}
                            disabled={busy}
                            className="min-h-11 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 text-[rgb(var(--danger-text))] border border-[rgb(var(--danger))]/35 hover:bg-[rgb(var(--danger-bg))] disabled:opacity-50"
                        >
                            {busy
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Trash2 size={14} />}
                            Cancel this week
                        </button>
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
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-saffron text-white rounded-lg text-xs font-bold disabled:opacity-50"
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
     * Which week the card is showing. Null means "the next one", which is what a
     * manager wants nine times in ten — and it stays correct on its own as weeks
     * pass, where storing the date would leave the card pinned to a sabha that has
     * already happened.
     */
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const selected = events.find(e => e.date === selectedDate) ?? nextScheduled;

    // A selection can outlive what it pointed at — cancel the week you are looking
    // at and it leaves the list. Falling back above keeps the card populated; this
    // clears the stale pointer so the chips do not show a selection that is gone.
    useEffect(() => {
        if (selectedDate && !events.some(e => e.date === selectedDate)) setSelectedDate(null);
    }, [events, selectedDate]);

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

        <div className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden mb-4">
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

            {!loading && selected && (
                <>
                    {/* Keyed on the date so switching weeks re-seeds the edit
                        fields instead of carrying the previous week's values. */}
                    <EventDetail
                        key={selected.id}
                        event={selected}
                        isNext={selected.id === nextScheduled?.id}
                        ridesOpen={calendarStatus === 'ok'}
                    />

                    {events.length > 1 && (
                        <div className="px-4 pb-4 pt-1">
                            <p className="text-[11px] text-coffee-500 mb-2">
                                Then, from the schedule — tap a date to change just that week
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {events.map(event => {
                                    const isSelected = event.id === selected.id;
                                    const diverges = labelForSource(event.source);
                                    return (
                                        <button
                                            key={event.id}
                                            onClick={() => setSelectedDate(event.date)}
                                            aria-pressed={isSelected}
                                            className={`min-h-11 px-2.5 rounded-lg text-xs transition-colors ${isSelected
                                                ? 'bg-saffron text-[rgb(var(--text-on-accent))] font-bold'
                                                : diverges
                                                    ? 'bg-[rgb(var(--accent-tint-badge-1))] text-saffron-800 font-semibold hover:bg-[rgb(var(--accent-tint-badge-2))]'
                                                    : 'bg-cream-300 text-coffee-700 hover:bg-cream-400'
                                                }`}
                                        >
                                            {shortDate(event.date)}
                                            {diverges && <span className="ml-1 font-normal">· {diverges.toLowerCase()}</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}

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
                                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-saffron text-white rounded-lg text-xs font-bold disabled:opacity-50"
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
        </div>
        </>
    );
};
