import React, { useState } from 'react';
import { CalendarDays, Loader2, AlertCircle, Plus, Trash2, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useUpcomingEvents, updateEvent, createEvent, SabhaEvent } from '../../hooks/useEvents';
import { previewDeleteSabhaEvent, deleteSabhaEvent } from '../../src/utils/cloudFunctions';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { useSettings } from '../../hooks/useSettings';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';
import { useConfirm } from '../shared/useConfirm';
import { formatTime } from '../../hooks/useSettings';

/**
 * The sabha calendar, for managers.
 *
 * The date used to be a constant in the Cloud Function — sabha was Friday and
 * that was that. Each gathering now has its own date and times, and a manager can
 * move one, cancel one, or add a one-off.
 *
 * The app seeds ONE sabha on a brand-new project so the service is not closed on
 * day one, and never creates another. How many gatherings exist is the manager's
 * decision — generating eight meant one bad default time was copied eight times.
 *
 * Deleting really deletes — the row goes and so does the record. That is only safe
 * because the app no longer generates events past the first one: it used to treat a
 * missing document as "needs creating", so a deleted date reappeared within 60
 * seconds. The work itself goes through the deleteSabhaEvent callable, because
 * removing a gathering also means removing its attendance responses (a subcollection
 * Firestore leaves behind), cancelling outstanding ride requests, and rewriting the
 * published ride window.
 */

/**
 * A sabha must be longer than the drop-off lead, or the window inverts: drop-off
 * would open before it starts and pickup would flip straight to drop-off. The
 * server clamps this too (buildCurrentEvent), but rejecting it here means the
 * manager finds out at the point of saving rather than never.
 */
const DROPOFF_LEAD_MINUTES = 15;

const minutesOf = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
};

/** Long enough to hold a sabha AND get drivers moving before it ends. */
export const isUsableDuration = (start: string, end: string): boolean => {
    const s = minutesOf(start);
    const e = minutesOf(end);
    if (s === null || e === null) return false;
    return e - s > DROPOFF_LEAD_MINUTES;
};

/** Ride requests open this many days before a sabha. Mirrors PICKUP_LEAD_DAYS. */
const PICKUP_LEAD_DAYS = 2;

/** "2026-08-14" -> "Friday 14 Aug". Uses the date parts directly, so no timezone shift. */
function formatDate(dateKey: string): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long', day: 'numeric', month: 'short',
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

const EventRow: React.FC<{
    event: SabhaEvent;
    isNext: boolean;
}> = ({ event, isNext }) => {
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

            await updateEvent(
                event.id,
                { startTime: start, endTime: end, agenda, venue },
                currentUser.uid,
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
        <div className="px-3 py-2.5 border-b border-hairline/10 last:border-0">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-coffee">
                            {formatDate(event.date)}
                        </span>
                        {isNext && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-saffron/15 text-saffron-800 px-1.5 py-0.5 rounded">
                                Next
                            </span>
                        )}
                    </div>
                    {!editing && (
                        <>
                            <p className="text-xs text-coffee-500 mt-0.5">
                                {formatTime(event.startTime)} – {formatTime(event.endTime)}
                                {event.agenda ? ` · ${event.agenda}` : ''}
                            </p>
                            {event.venue?.address && (
                                <p className="text-[10px] text-saffron-800 mt-0.5 truncate">
                                    at {event.venue.address}
                                </p>
                            )}
                            <p className="text-[10px] text-coffee-500 mt-0.5">
                                {windowSummary(event)}
                            </p>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {!editing && (
                        <button
                            onClick={() => setEditing(true)}
                            disabled={busy}
                            className="text-xs font-semibold text-saffron-800 px-2 py-1 rounded hover:bg-cream-300 disabled:opacity-50"
                        >
                            Edit
                        </button>
                    )}
                    <button
                        onClick={remove}
                        disabled={busy}
                        title="Delete this sabha"
                        className="p-1.5 rounded transition-colors disabled:opacity-50 text-[rgb(var(--danger-text))] hover:bg-[rgb(var(--danger-bg))]"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                </div>
            </div>

            {editing && (
                <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="time" value={start} onChange={(e) => { setStart(e.target.value); setError(null); }}
                            disabled={busy}
                            className="px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                        />
                        <input
                            type="time" value={end} onChange={(e) => { setEnd(e.target.value); setError(null); }}
                            disabled={busy}
                            className="px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                        />
                    </div>
                    <input
                        type="text" value={agenda} onChange={(e) => setAgenda(e.target.value)}
                        placeholder="Agenda (optional)" disabled={busy}
                        className="w-full px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
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
    const { events, loading, error } = useUpcomingEvents();
    const { calendarStatus } = useCurrentEvent();

    const [adding, setAdding] = useState(false);
    const [date, setDate] = useState('');
    const [start, setStart] = useState('19:00');
    const [end, setEnd] = useState('22:00');
    const [agenda, setAgenda] = useState('');
    const [newVenueText, setNewVenueText] = useState('');
    const [newVenuePlace, setNewVenuePlace] = useState<PlaceDetails | null>(null);
    const [busy, setBusy] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const { sabhaLocation } = useSettings();

    // Cancelled documents are filtered out upstream, so every row here is live.
    const nextScheduled = events[0];

    const add = async () => {
        if (!currentUser) return;
        if (!date) { setAddError('Pick a date.'); return; }
        if (!isUsableDuration(start, end)) { setAddError(`Sabha must run for more than ${DROPOFF_LEAD_MINUTES} minutes.`); return; }

        setBusy(true);
        setAddError(null);
        try {
            await createEvent(
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
        <div className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <CalendarDays size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Sabha Calendar</h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    The calendar is yours. Add each sabha, change its time or venue, or
                    delete one.
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

            {!loading && events.map(event => (
                <EventRow
                    key={event.id}
                    event={event}
                    isNext={event.id === nextScheduled?.id}
                />
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
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="time" value={start} onChange={(e) => { setStart(e.target.value); setAddError(null); }}
                                disabled={busy}
                                className="px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                            />
                            <input
                                type="time" value={end} onChange={(e) => { setEnd(e.target.value); setAddError(null); }}
                                disabled={busy}
                                className="px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
                            />
                        </div>
                        <input
                            type="text" value={agenda} onChange={(e) => setAgenda(e.target.value)}
                            placeholder="Agenda (optional)" disabled={busy}
                            className="w-full px-2 py-1.5 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron"
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
    );
};
