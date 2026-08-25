import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plane } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useArrivalsBetween } from '../../hooks/useArrivals';
import { isApprovedManager } from '../../src/roles';
import { urgencyOf } from '../../src/utils/arrival';
import { ArrivalCard } from './ArrivalCard';
import type { AirportPickup } from '../../types';

/**
 * A month of arrivals, and the day you tapped.
 *
 * A REAL GRID, unlike `SabhaCalendar`, which is two stacked cards — and correctly so,
 * because a weekly recurrence has one next occurrence and eleven near-identical ones
 * after it. Arrivals are the opposite shape: scattered, unrelated, one or two a week,
 * and the question a Sarthi actually asks is "which day am I free". That question is
 * answered by a month at a glance and by nothing else.
 *
 * NO DATE LIBRARY. `date-fns` is a dependency but is imported in exactly one file in
 * this repo, and everything else does plain UTC arithmetic with the noon trick below.
 * A month grid needs a first weekday and a day count; both are two lines.
 *
 * THE NOON-UTC TRICK, used in three other files here: a 'YYYY-MM-DD' key parsed as
 * `new Date('2026-09-20')` is midnight UTC, which is the 19th in Boston, so every
 * date renders a day early. `Date.UTC(y, m - 1, d, 12)` puts it far enough from either
 * midnight that no timezone shifts the calendar day.
 */

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** The local calendar day, never derived from a UTC instant. */
function todayKey(): string {
    const now = new Date();
    return keyOf(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Noon UTC, so no timezone can shift which day this is. */
const atNoon = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
};

const monthLabel = (year: number, month: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month, 12)));

const dayLabel = (key: string) =>
    new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
    }).format(atNoon(key));

export const ArrivalBoard: React.FC = () => {
    const { userProfile } = useAuth();
    const isCoordinator = isApprovedManager(userProfile) && userProfile?.airportCoordinator === true;

    const [cursor, setCursor] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    });
    const [selectedDay, setSelectedDay] = useState<string | null>(todayKey);
    const [openCard, setOpenCard] = useState<string | null>(null);

    // The whole month, plus a day either side, because `arrivalAt` is an instant and a
    // 22:00 landing on the last of the month is 02:00 UTC on the first of the next.
    // Trimming to the month exactly would hide it from both months' grids.
    const { from, to } = useMemo(() => ({
        from: new Date(Date.UTC(cursor.year, cursor.month, 1) - 36 * 3600_000).toISOString(),
        to: new Date(Date.UTC(cursor.year, cursor.month + 1, 1) + 36 * 3600_000).toISOString(),
    }), [cursor]);

    const { arrivals, loading, error } = useArrivalsBetween(from, to);

    /** Grouped by the airport-local date, which is what the traveller read off a ticket. */
    const byDay = useMemo(() => {
        const map = new Map<string, AirportPickup[]>();
        for (const arrival of arrivals) {
            if (arrival.status === 'cancelled') continue;
            const list = map.get(arrival.arrivalDate) ?? [];
            list.push(arrival);
            map.set(arrival.arrivalDate, list);
        }
        for (const list of map.values()) list.sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt));
        return map;
    }, [arrivals]);

    const firstWeekday = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const today = todayKey();

    const step = (by: number) => {
        setSelectedDay(null);
        setOpenCard(null);
        setCursor(({ year, month }) => {
            const next = new Date(Date.UTC(year, month + by, 1));
            return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
        });
    };

    const selected = selectedDay ? byDay.get(selectedDay) ?? [] : [];

    return (
        <div className="p-4 lg:p-6 space-y-4 max-w-2xl mx-auto">
            <header>
                <h1 className="text-xl font-header font-bold text-coffee">Arrivals</h1>
                <p className="text-sm text-coffee-500">
                    Pick a day to see who is landing, then take the ones you can do.
                </p>
            </header>

            {/* LOUD, not an empty grid. A board that silently shows nothing when the
                read failed is the defect this repo keeps removing — a Sarthi would
                read "nobody is landing" while three people wait. */}
            {error && (
                <div
                    role="alert"
                    className="clay-card p-4 flex items-start gap-3 text-[rgb(var(--danger))]"
                >
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-sm font-bold">{error}</p>
                </div>
            )}

            <section className="clay-card p-4" aria-label="Arrivals calendar">
                <div className="flex items-center justify-between mb-3">
                    <button
                        type="button"
                        onClick={() => step(-1)}
                        aria-label="Previous month"
                        className="p-2 rounded-xl hover:bg-cream-300 min-h-11 min-w-11 flex items-center justify-center"
                    >
                        <ChevronLeft size={18} className="text-coffee" aria-hidden="true" />
                    </button>
                    <h2 className="font-header font-bold text-coffee" aria-live="polite">
                        {monthLabel(cursor.year, cursor.month)}
                    </h2>
                    <button
                        type="button"
                        onClick={() => step(1)}
                        aria-label="Next month"
                        className="p-2 rounded-xl hover:bg-cream-300 min-h-11 min-w-11 flex items-center justify-center"
                    >
                        <ChevronRight size={18} className="text-coffee" aria-hidden="true" />
                    </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden="true">
                    {WEEKDAY_INITIALS.map((initial, i) => (
                        <div key={i} className="text-center text-[10px] font-bold uppercase text-coffee-500">
                            {initial}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad-${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                        const key = keyOf(cursor.year, cursor.month, i + 1);
                        const onThisDay = byDay.get(key) ?? [];
                        const unclaimed = onThisDay.filter(a => a.status === 'open');
                        const isSelected = key === selectedDay;

                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => { setSelectedDay(key); setOpenCard(null); }}
                                aria-pressed={isSelected}
                                // Spelled out because "3" beside a date is not a label.
                                aria-label={`${dayLabel(key)} — ${onThisDay.length === 0
                                    ? 'nobody arriving'
                                    : `${onThisDay.length} arriving, ${unclaimed.length} unclaimed`}`}
                                className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5
                                    text-sm transition-colors
                                    ${isSelected ? 'bg-saffron text-white font-bold'
                                        : onThisDay.length > 0 ? 'bg-cream-300 text-coffee font-bold hover:bg-cream-400'
                                            : 'text-coffee-500 hover:bg-cream-300/50'}
                                    ${key === today && !isSelected ? 'ring-2 ring-saffron/60' : ''}`}
                            >
                                <span>{i + 1}</span>
                                {/* A dot per arrival, up to three, then a count. The dot
                                    is red only for the ones nobody has taken — a claimed
                                    arrival is not a thing anybody needs to act on. */}
                                {onThisDay.length > 0 && (
                                    <span className="flex items-center gap-0.5" aria-hidden="true">
                                        {onThisDay.length <= 3
                                            ? onThisDay.map(a => (
                                                <span
                                                    key={a.id}
                                                    className={`w-1.5 h-1.5 rounded-full ${a.status === 'open'
                                                        ? 'bg-[rgb(var(--danger))]' : 'bg-coffee-500/50'}`}
                                                />
                                            ))
                                            : <span className="text-[9px] font-bold">{onThisDay.length}</span>}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </section>

            {loading && (
                <p className="flex items-center gap-2 text-sm text-coffee-500">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Loading arrivals…
                </p>
            )}

            {selectedDay && !loading && (
                <section className="space-y-3" aria-label={`Arrivals on ${dayLabel(selectedDay)}`}>
                    <h2 className="font-header font-bold text-coffee">{dayLabel(selectedDay)}</h2>

                    {selected.length === 0 ? (
                        <div className="clay-card p-6 text-center">
                            <Plane size={24} className="mx-auto text-coffee-500 mb-2" aria-hidden="true" />
                            <p className="text-sm text-coffee-500">Nobody is arriving on this day.</p>
                        </div>
                    ) : (
                        // Sorted so whatever needs somebody soonest is at the top. An
                        // unclaimed arrival always outranks a claimed one at the same
                        // time, because only one of them is a job.
                        [...selected]
                            .sort((a, b) => {
                                const open = Number(b.status === 'open') - Number(a.status === 'open');
                                return open !== 0 ? open : a.arrivalAt.localeCompare(b.arrivalAt);
                            })
                            .map(arrival => (
                                <ArrivalCard
                                    key={arrival.id}
                                    arrival={arrival}
                                    isCoordinator={isCoordinator}
                                    open={openCard === arrival.id}
                                    onToggle={() => setOpenCard(openCard === arrival.id ? null : arrival.id)}
                                />
                            ))
                    )}
                </section>
            )}

            {/* What needs somebody, regardless of which month is showing. Derived from
                `arrivalAt` on the client, so it is correct whether or not any push was
                ever delivered — STATUS.md records that push has reached one phone once. */}
            <UnclaimedStrip arrivals={arrivals} />
        </div>
    );
};

const UnclaimedStrip: React.FC<{ arrivals: AirportPickup[] }> = ({ arrivals }) => {
    const pressing = useMemo(
        () => arrivals
            .filter(a => a.status === 'open' && urgencyOf(a.arrivalAt) !== 'calm')
            .sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt)),
        [arrivals],
    );

    if (pressing.length === 0) return null;

    return (
        <section className="clay-card p-4" aria-label="Arrivals still needing a Sarthi">
            <h2 className="font-header font-bold text-coffee text-sm mb-2">
                Still needs a Sarthi
            </h2>
            <ul className="space-y-1 text-sm text-coffee-500">
                {pressing.map(a => (
                    <li key={a.id}>
                        {a.arrivalDate} · {a.arrivalTime} · {a.airportCode} · {a.requesterName}
                    </li>
                ))}
            </ul>
        </section>
    );
};
