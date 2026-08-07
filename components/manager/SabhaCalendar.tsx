import React, { useState } from 'react';
import { CalendarDays, Loader2, AlertCircle, Plus, RotateCcw, Ban, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useUpcomingEvents, updateEvent, setEventStatus, createEvent, SabhaEvent } from '../../hooks/useEvents';
import { formatTime } from '../../hooks/useSettings';

/**
 * The sabha calendar, for managers.
 *
 * The date used to be a constant in the Cloud Function — sabha was Friday and
 * that was that. Each gathering now has its own date and times, and a manager can
 * move one, cancel one, or add a one-off.
 *
 * Upcoming Fridays are generated automatically, so this list is never empty and
 * nobody has to remember to create next week. Editing or cancelling one marks it
 * as manager-owned, and the generator then leaves it alone.
 */

/** "2026-08-14" -> "Friday 14 Aug". Uses the date parts directly, so no timezone shift. */
function formatDate(dateKey: string): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long', day: 'numeric', month: 'short',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

const EventRow: React.FC<{ event: SabhaEvent; isNext: boolean }> = ({ event, isNext }) => {
    const { currentUser } = useAuth();
    const [editing, setEditing] = useState(false);
    const [start, setStart] = useState(event.startTime);
    const [end, setEnd] = useState(event.endTime);
    const [agenda, setAgenda] = useState(event.agenda);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cancelled = event.status === 'cancelled';
    const valid = !!start && !!end && end > start;

    const save = async () => {
        if (!currentUser) return;
        if (!valid) { setError('Sabha must end after it starts.'); return; }

        setBusy(true);
        setError(null);
        try {
            await updateEvent(event.id, { startTime: start, endTime: end, agenda }, currentUser.uid);
            setEditing(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const toggleCancelled = async () => {
        if (!currentUser) return;
        const next = cancelled ? 'scheduled' : 'cancelled';
        if (next === 'cancelled' && !confirm(`Cancel the sabha on ${formatDate(event.date)}? Rides will not open for it.`)) return;

        setBusy(true);
        setError(null);
        try {
            await setEventStatus(event.id, next, currentUser.uid);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not update.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={`px-3 py-2.5 border-b border-gray-100 last:border-0 ${cancelled ? 'bg-gray-50' : ''}`}>
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${cancelled ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                            {formatDate(event.date)}
                        </span>
                        {isNext && !cancelled && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-saffron/15 text-saffron-800 px-1.5 py-0.5 rounded">
                                Next
                            </span>
                        )}
                        {cancelled && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                Cancelled
                            </span>
                        )}
                    </div>
                    {!editing && (
                        <p className="text-xs text-gray-500 mt-0.5">
                            {formatTime(event.startTime)} – {formatTime(event.endTime)}
                            {event.agenda ? ` · ${event.agenda}` : ''}
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {!editing && !cancelled && (
                        <button
                            onClick={() => setEditing(true)}
                            disabled={busy}
                            className="text-xs font-semibold text-saffron-800 px-2 py-1 rounded hover:bg-orange-50 disabled:opacity-50"
                        >
                            Edit
                        </button>
                    )}
                    <button
                        onClick={toggleCancelled}
                        disabled={busy}
                        title={cancelled ? 'Restore this sabha' : 'Cancel this sabha'}
                        className={`p-1.5 rounded transition-colors disabled:opacity-50 ${cancelled
                            ? 'text-green-700 hover:bg-green-50'
                            : 'text-red-600 hover:bg-red-50'}`}
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" />
                            : cancelled ? <RotateCcw size={14} /> : <Ban size={14} />}
                    </button>
                </div>
            </div>

            {editing && (
                <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="time" value={start} onChange={(e) => { setStart(e.target.value); setError(null); }}
                            disabled={busy}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                        />
                        <input
                            type="time" value={end} onChange={(e) => { setEnd(e.target.value); setError(null); }}
                            disabled={busy}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                        />
                    </div>
                    <input
                        type="text" value={agenda} onChange={(e) => setAgenda(e.target.value)}
                        placeholder="Agenda (optional)" disabled={busy}
                        className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                    />
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
                            className="flex-1 px-2 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-bold"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p className="text-xs text-red-600 font-semibold mt-1.5">{error}</p>
            )}
        </div>
    );
};

export const SabhaCalendar: React.FC = () => {
    const { currentUser } = useAuth();
    const { events, loading, error } = useUpcomingEvents();

    const [adding, setAdding] = useState(false);
    const [date, setDate] = useState('');
    const [start, setStart] = useState('19:00');
    const [end, setEnd] = useState('22:00');
    const [agenda, setAgenda] = useState('');
    const [busy, setBusy] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    const nextScheduled = events.find(e => e.status === 'scheduled');

    const add = async () => {
        if (!currentUser) return;
        if (!date) { setAddError('Pick a date.'); return; }
        if (!(end > start)) { setAddError('Sabha must end after it starts.'); return; }

        setBusy(true);
        setAddError(null);
        try {
            await createEvent(date, start, end, agenda, currentUser.uid);
            setAdding(false);
            setDate(''); setAgenda('');
        } catch (err: unknown) {
            setAddError(err instanceof Error ? err.message : 'Could not add.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                    <CalendarDays size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-gray-800">Sabha Calendar</h3>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Fridays are added automatically. Change a time, cancel one, or add a one-off.
                </p>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-6">
                    <Loader2 size={20} className="animate-spin text-saffron" />
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 m-3 rounded-lg">
                    <AlertCircle size={14} />
                    <span className="text-xs">{error}</span>
                </div>
            )}

            {!loading && !error && events.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-gray-500">
                    No sabhas scheduled yet. One will be added automatically within a minute,
                    or add one below.
                </p>
            )}

            {!loading && events.map(event => (
                <EventRow key={event.id} event={event} isNext={event.id === nextScheduled?.id} />
            ))}

            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60">
                {!adding ? (
                    <button
                        onClick={() => setAdding(true)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg text-xs font-bold hover:border-saffron hover:text-saffron-800 transition-colors"
                    >
                        <Plus size={14} /> Add a sabha
                    </button>
                ) : (
                    <div className="space-y-2">
                        <input
                            type="date" value={date}
                            onChange={(e) => { setDate(e.target.value); setAddError(null); }}
                            disabled={busy}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="time" value={start} onChange={(e) => { setStart(e.target.value); setAddError(null); }}
                                disabled={busy}
                                className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                            />
                            <input
                                type="time" value={end} onChange={(e) => { setEnd(e.target.value); setAddError(null); }}
                                disabled={busy}
                                className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                            />
                        </div>
                        <input
                            type="text" value={agenda} onChange={(e) => setAgenda(e.target.value)}
                            placeholder="Agenda (optional)" disabled={busy}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-saffron"
                        />
                        {addError && <p className="text-xs text-red-600 font-semibold">{addError}</p>}
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
                                className="flex-1 px-2 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-bold"
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
