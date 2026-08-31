import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, CalendarCheck, ChevronLeft, ChevronRight, Loader2, Plane } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useArrivalsBetween } from '../../hooks/useArrivals';
import { isApprovedManager } from '../../src/roles';
import { formatTime } from '../../src/constants/schedule';
import { TERMINAL } from '../../src/utils/arrival';
import { ArrivalCard } from './ArrivalCard';
import { PushPrompt } from '../shared/PushPrompt';
import { Disclosure } from '../shared/Disclosure';
import { NotificationSettings } from '../manager/NotificationSettings';
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
 *
 * ONE FACT, ONE CARRIER — the rule this screen was rebuilt around on 2026-08-25.
 *
 * The first version put every state into one `className` ternary chain, and the chain
 * ate itself: `key === today && !isSelected` meant selecting today DELETED the today
 * marker, on the one day it matters. So each fact now has its own carrier, and most of
 * them live on a different DOM node from the cell fill:
 *
 *   today            a filled pill on the numeral's own <span>, plus aria-current
 *   selected         an inset ring on the cell
 *   how many + who   a badge child node: the count, coloured by claim state
 *   past             the numeral's colour
 *   weekend          the column header's colour
 *
 * Fill is the only ordinal cascade left, and nothing depends on fill alone — so a
 * selected day that also has arrivals loses its tint and keeps its badge.
 *
 * NO `text-white` ON A SAFFRON FILL, anywhere, ever. The selected day used to be
 * `bg-saffron text-white font-bold`, which measures 2.84:1 in light and 2.68:1 in dark
 * against the 4.5:1 that 14px text needs — `--accent` is a FILL-ONLY token and
 * tests/quality/theme-contrast.test.ts asserts it stays below AA on purpose. Saffron
 * that carries text uses `--cta` / `--text-on-accent` (5.45:1 and 5.77:1), the pair
 * RequestTable already uses. tests/quality/theme-tokens.test.ts now ratchets this.
 *
 * WHAT THE CELL DELIBERATELY DOES NOT SHOW: urgency. `urgencyOf` is a pure function of
 * `arrivalAt` and now, and in a MONTH GRID the cell's position already encodes
 * time-to-landing — `critical` (≤10h) can only ever be today or tomorrow. Colouring
 * three adjacent cells to say "these are soon" restates their coordinates. Urgency
 * belongs on ArrivalCard, where a card has been lifted out of calendar context.
 */

/** Two letters, because `S M T W T F S` has two S and two T and reads as neither. */
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/**
 * Hoisted, not built per call.
 *
 * `dayLabel` runs once per cell for the aria-labels — 31 times a render, on a phone,
 * during a live Firestore stream — and constructing an `Intl.DateTimeFormat` is the
 * expensive part of using one. Formatting with a built one is cheap.
 */
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_FMT = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
});
/**
 * Weekday only, and the day number is appended by hand.
 *
 * `{ weekday: 'short', day: 'numeric' }` in en-US produces "24 Mon", which reads as a
 * quantity of Mondays. There is no options combination that gives "Mon 24", so the two
 * parts are formatted separately and joined.
 */
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

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

const monthLabel = (year: number, month: number) => MONTH_FMT.format(new Date(Date.UTC(year, month, 12)));
const dayLabel = (key: string) => DAY_FMT.format(atNoon(key));
const shortDayLabel = (key: string) => {
    const at = atNoon(key);
    return `${WEEKDAY_FMT.format(at)} ${at.getUTCDate()}`;
};

/** One day of the visible month, counted once and read by both the grid and the summary. */
interface MonthDay {
    key: string;
    day: number;
    /** Everything on the day that is not cancelled, INCLUDING the finished ones. */
    list: AirportPickup[];
    /** How many of `list` are still work: not completed, not cancelled. */
    arriving: number;
    unclaimed: number;
}

const BADGE = 'inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded-full '
    + 'text-[11px] font-bold leading-none';

/**
 * THE TWO STATES A DAY CAN BE IN, and the whole point of the indicator.
 *
 * Amber whenever ANYTHING that day is unassigned — a mixed day is amber, because a mixed
 * day still needs somebody. Green only when every arrival has a Sarthi.
 *
 * Semantic `-bg`/`-text` pairs, measured rather than eyeballed. Text on its own fill:
 * warning 5.38 light / 7.10 dark, success 6.99 / 6.72. Channel-sum distance from the card
 * surface: warning 62 / 56, success 98 / 51 — so neither can sink into the card. And amber
 * against green is a HUE difference, not just a lightness one, so it survives greyscale
 * and most colour blindness.
 *
 * `--success-bg`/`--success-text` is not invented here: SabhaCalendar's "Rides open" pill
 * is the same pair, so green-means-covered is already this app's vocabulary.
 *
 * NEITHER IS `bg-cream-400`, and that is load-bearing. The assigned badge used to be
 * `bg-cream-400 text-coffee-700` while the SELECTED CELL was also `bg-cream-400` — the
 * same token, channel distance ZERO — so on a day that was both selected and fully
 * assigned the indicator was drawn in exactly the colour behind it and vanished. The
 * day's aria-label stayed correct and tests/components may not assert class names, so
 * nothing caught it. tests/quality/theme-tokens.test.ts now bans cream-400 in this file.
 */
const NEEDS_SOMEBODY = 'bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]';
const ALL_ASSIGNED = 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]';

export const ArrivalBoard: React.FC = () => {
    const { userProfile } = useAuth();
    const isManager = isApprovedManager(userProfile);
    const isCoordinator = isManager && userProfile?.airportCoordinator === true;
    const [settingsOpen, setSettingsOpen] = useState(false);

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
    const monthPrefix = `${cursor.year}-${pad(cursor.month + 1)}`;

    /**
     * THE MONTH, COUNTED ONCE. Both the grid and the summary line read this.
     *
     * Not a reduction over `arrivals`, and that is the point: the query is bounded on
     * `arrivalAt ± 36h`, so `arrivals` contains rows whose `arrivalDate` falls in an
     * ADJACENT month — fetched on purpose, shown by no cell. A summary reducing over
     * `arrivals` would claim an unclaimed arrival that appears nowhere on screen, which
     * is exactly the bug the old bottom strip had.
     */
    const monthDays = useMemo<MonthDay[]>(() => Array.from({ length: daysInMonth }, (_, i) => {
        const key = keyOf(cursor.year, cursor.month, i + 1);
        const list = byDay.get(key) ?? [];
        return {
            key, day: i + 1, list,
            // TERMINAL is ['completed', 'cancelled'] from the shared table — the same
            // list the server refuses every transition out of. Cancelled never reaches
            // here (byDay drops it), so in practice this subtracts the dropped-off.
            arriving: list.filter(a => !TERMINAL.includes(a.status)).length,
            unclaimed: list.filter(a => a.status === 'open').length,
        };
    }), [byDay, cursor, daysInMonth]);

    const monthTotal = monthDays.reduce((n, d) => n + d.arriving, 0);
    const monthUnclaimed = monthDays.reduce((n, d) => n + d.unclaimed, 0);
    const nextUnclaimed = monthDays.find(d => d.unclaimed > 0);

    /**
     * The day whose arrivals are listed below, and there is ALWAYS one.
     *
     * `selectedDay` used to be cleared on every month change, which left the whole area
     * under the grid blank — a screen that had just been asked to show a month and
     * answered with nothing. Deriving instead means paging lands on the first day that
     * needs somebody, or the 1st, and no `null` branch exists below.
     */
    const activeDay = selectedDay?.startsWith(monthPrefix)
        ? selectedDay
        : (nextUnclaimed ?? monthDays[0])?.key ?? today;
    const selected = byDay.get(activeDay) ?? [];
    const selectedUnclaimed = selected.filter(a => a.status === 'open').length;
    const selectedArriving = selected.filter(a => !TERMINAL.includes(a.status)).length;

    const pick = (key: string) => { setSelectedDay(key); setOpenCard(null); };

    const step = (by: number) => {
        setOpenCard(null);
        setCursor(({ year, month }) => {
            const next = new Date(Date.UTC(year, month + by, 1));
            return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
        });
    };

    const goToday = () => {
        const now = new Date();
        setCursor({ year: now.getFullYear(), month: now.getMonth() });
        pick(todayKey());
    };

    // ============================================
    // KEYBOARD
    // ============================================
    //
    // Roving tabindex and arrow keys, and NOT `role="grid"`. A real grid role means
    // restructuring the flat `grid-cols-7` into row wrappers and giving the leading pad
    // divs cell roles or the row lengths lie — and a half-built ARIA grid is worse than
    // none, because it overrides the native button semantics that already work. Every
    // day here is a <button> with a fully spelled-out name. What was actually wrong was
    // a 31-stop tab sequence, and that is what this fixes.
    //
    // Arrow keys CLAMP to the visible month rather than spilling into the next one. The
    // spill version has to change the cursor and then chase focus into a subtree that
    // has not rendered yet; PageUp/PageDown do that job explicitly instead.

    const gridRef = useRef<HTMLDivElement>(null);
    /** A new object per keyboard move, so a click elsewhere can never re-trigger focus. */
    const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);

    useEffect(() => {
        if (!focusRequest) return;
        gridRef.current
            ?.querySelector<HTMLButtonElement>(`[data-day="${focusRequest.key}"]`)
            ?.focus();
    }, [focusRequest]);

    const moveWithinMonth = (dayNumber: number) => {
        const clamped = Math.min(Math.max(dayNumber, 1), daysInMonth);
        const key = keyOf(cursor.year, cursor.month, clamped);
        pick(key);
        setFocusRequest({ key });
    };

    const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const activeNumber = Number(activeDay.slice(-2));
        const byKey: Record<string, number> = {
            ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
        };
        const by = byKey[event.key];

        if (by !== undefined) {
            event.preventDefault();
            moveWithinMonth(activeNumber + by);
            return;
        }
        if (event.key === 'Home') { event.preventDefault(); moveWithinMonth(1); return; }
        if (event.key === 'End') { event.preventDefault(); moveWithinMonth(daysInMonth); return; }

        // Paging: the target month has not rendered yet, so the focus effect runs after
        // the batched state lands and finds the button then.
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            const direction = event.key === 'PageUp' ? -1 : 1;
            const next = new Date(Date.UTC(cursor.year, cursor.month + direction, 1));
            const key = keyOf(next.getUTCFullYear(), next.getUTCMonth(), 1);
            step(direction);
            setSelectedDay(key);
            setFocusRequest({ key });
        }
    };

    return (
        <div className="p-3 xs:p-4 lg:p-6 space-y-4 max-w-2xl mx-auto">
            <header>
                <h1 className="text-xl font-header font-bold text-coffee">Arrivals</h1>
            </header>

            {/* LOUD, not an empty grid. A board that silently shows nothing when the
                read failed is the defect this repo keeps removing — a Sarthi would
                read "nobody is landing" while three people wait. */}
            {error && (
                <div
                    role="alert"
                    className="clay-card p-4 flex items-start gap-3 text-[rgb(var(--danger-text))]"
                >
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-sm font-bold">{error}</p>
                </div>
            )}

            <section className="clay-card p-3 xs:p-4" aria-label="Arrivals calendar">
                <div className="flex items-center justify-between mb-2">
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

                {/* THE MONTH IN ONE LINE, and it is the coordinator's whole question.
                    Also the jump target the old bottom strip should have been: tapping
                    it selects the next day that needs somebody. It replaced a "Pick a
                    day to see who is landing" subtitle — instructions nobody reads,
                    standing where something true could go. */}
                <div className="flex items-center justify-between gap-2 mb-2">
                    {loading ? (
                        <p className="flex items-center gap-2 text-xs text-coffee-500 min-h-11">
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            Loading arrivals…
                        </p>
                    ) : monthUnclaimed > 0 && nextUnclaimed ? (
                        <button
                            type="button"
                            onClick={() => pick(nextUnclaimed.key)}
                            // AN EXPLICIT LABEL, because the computed one is unreadable.
                            // A badge span beside text fragments concatenates with no
                            // separators — this button announced itself as
                            // "2still need a Sarthi· next Wed 26". Found by writing the
                            // first test this screen has ever had.
                            aria-label={`${monthUnclaimed} ${monthUnclaimed === 1 ? 'arrival' : 'arrivals'} `
                                + `this month still ${monthUnclaimed === 1 ? 'needs' : 'need'} a Sarthi. `
                                + `Next on ${shortDayLabel(nextUnclaimed.key)}.`}
                            className="flex-1 min-h-11 flex items-center gap-2 text-left text-xs font-bold
                                       text-coffee-700 rounded-xl px-1 hover:bg-cream-300 transition-colors"
                        >
                            <span className={`${BADGE} ${NEEDS_SOMEBODY}`}>{monthUnclaimed}</span>
                            still {monthUnclaimed === 1 ? 'needs' : 'need'} a Sarthi
                            <span className="text-coffee-500 font-normal">
                                · next {shortDayLabel(nextUnclaimed.key)}
                            </span>
                        </button>
                    ) : monthTotal > 0 ? (
                        <p className="flex items-center gap-2 text-xs font-bold text-coffee-700 min-h-11">
                            <CalendarCheck
                                size={14}
                                className="text-[rgb(var(--success-text))]"
                                aria-hidden="true"
                            />
                            {/* "All 1 arrival has a Sarthi" breaks at every number. This
                                shape has no agreement to get wrong and mirrors the other
                                state, "4 still need a Sarthi · next Mon 24". */}
                            {monthTotal} arriving · everyone has a Sarthi
                        </p>
                    ) : (
                        <p className="text-xs text-coffee-500 min-h-11 flex items-center">
                            Nobody arriving in {monthLabel(cursor.year, cursor.month)}
                        </p>
                    )}

                    {/* Only when it would do something. A Today button on the current
                        month is a control that cannot change anything. */}
                    {!today.startsWith(monthPrefix) && (
                        <button
                            type="button"
                            onClick={goToday}
                            className="shrink-0 min-h-11 px-3 rounded-xl text-xs font-bold
                                       text-saffron-800 hover:bg-cream-300 transition-colors"
                        >
                            Today
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden="true">
                    {WEEKDAYS.map((label, i) => (
                        <div
                            key={label}
                            // Saturday is permanently the rightmost column and Sunday the
                            // leftmost, so "I'm free at the weekend" is answered by looking
                            // at an edge. A header colour is all that needs spending on it:
                            // tinting the columns would cost the fill channel, and
                            // cream-200 against cream-300 is the weakest pair in the ramp.
                            className={`text-center text-[10px] font-bold uppercase ${
                                i === 0 || i === 6 ? 'text-saffron-800' : 'text-coffee-500'}`}
                        >
                            {label}
                        </div>
                    ))}
                </div>

                <div
                    ref={gridRef}
                    onKeyDown={onGridKeyDown}
                    aria-busy={loading}
                    className="grid grid-cols-7 gap-1"
                >
                    {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad-${i}`} />)}
                    {monthDays.map(({ key, day, list, unclaimed, arriving }) => {
                        const isActive = key === activeDay;
                        const isToday = key === today;
                        // Date keys sort lexicographically, so "before today" is a string
                        // comparison — no Date maths and no timezone to get wrong.
                        const isPast = key < today;

                        return (
                            <button
                                key={key}
                                type="button"
                                data-day={key}
                                onClick={() => pick(key)}
                                tabIndex={isActive ? 0 : -1}
                                aria-pressed={isActive}
                                aria-current={isToday ? 'date' : undefined}
                                // Spelled out because "3" beside a date is not a label.
                                aria-label={`${dayLabel(key)} — ${
                                    arriving === 0
                                        ? (list.length === 0 ? 'nobody arriving' : 'all dropped off')
                                        : unclaimed > 0
                                            ? `${arriving} arriving, ${unclaimed} still `
                                              + `${unclaimed === 1 ? 'needs' : 'need'} a Sarthi`
                                            : `${arriving} arriving, all with a Sarthi`}`}
                                // NO FILL ON A DAY CELL AT ALL, and selection is a ring
                                // with no fill either. Both tints are gone on purpose: the
                                // indicator is a saturated pill and needs no wash behind
                                // it, the grid is calmer for losing two layers, and — the
                                // real reason — a badge can no longer sit on a cell of its
                                // own colour.
                                className={`h-12 sm:h-14 rounded-xl flex flex-col items-center justify-center
                                    gap-0.5 text-sm leading-none transition-colors
                                    focus-visible:outline focus-visible:outline-2
                                    focus-visible:outline-offset-1 focus-visible:outline-[rgb(var(--cta))]
                                    ${isActive ? 'ring-2 ring-inset ring-[rgb(var(--cta))]'
                                        : 'hover:bg-cream-300/50'}
                                    ${isPast && arriving === 0 ? 'text-coffee-500' : 'text-coffee'}`}
                            >
                                {/* INDICATOR ABOVE, DATE BELOW, and the row is reserved on
                                    EVERY cell even when empty. Rendering it only on busy
                                    days would drop their numerals lower than their
                                    neighbours', and a calendar whose dates do not share a
                                    baseline reads as broken rather than as informative.
                                    No time here: it was a third row that earned nothing and
                                    disappeared the moment a day had two arrivals. */}
                                <span className="h-4 flex items-center" aria-hidden="true">
                                    {arriving > 0 && (
                                        <span className={`${BADGE} ${
                                            unclaimed > 0 ? NEEDS_SOMEBODY : ALL_ASSIGNED}`}>
                                            {arriving}
                                        </span>
                                    )}
                                </span>

                                {/* The today pill lives on the NUMERAL, not the cell, which
                                    is what makes today-and-selected impossible to collapse:
                                    both true gives a ring at the edge and a pill inside it. */}
                                <span
                                    className={isToday
                                        ? 'inline-flex h-6 w-6 items-center justify-center rounded-full '
                                          + 'bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] '
                                          + 'text-xs font-bold'
                                        : arriving > 0 ? 'font-bold' : ''}
                                >
                                    {day}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            {/* ALWAYS RENDERED. This used to be gated on `!loading`, so the whole section
                vanished on every month change and the layout jumped. The date is known
                before the query returns, so the heading is honest immediately and only
                the list needs a placeholder. */}
            <section className="space-y-3" aria-label={`Arrivals on ${dayLabel(activeDay)}`}>
                <div>
                    <h2 className="font-header font-bold text-coffee">{dayLabel(activeDay)}</h2>
                    {selected.length > 0 && (
                        <p className="text-sm text-coffee-500">
                            {/* A day whose only trips are finished said "1 arriving ·
                                everyone has a Sarthi", which read as work still to come.
                                The cards stay listed — a Sarthi who has just tapped
                                "dropped off" needs to see that it took — but the count
                                above them is about what is left to do. */}
                            {selectedArriving === 0
                                ? `${selected.length} ${selected.length === 1 ? 'arrival' : 'arrivals'}`
                                  + ' · all dropped off'
                                : `${selectedArriving} arriving`
                                  + (selectedUnclaimed > 0
                                      ? ` · ${selectedUnclaimed} ${selectedUnclaimed === 1 ? 'needs' : 'need'} a Sarthi`
                                      : ' · everyone has a Sarthi')}
                        </p>
                    )}
                </div>

                {loading ? (
                    <div className="space-y-3" aria-hidden="true">
                        <div className="h-16 bg-cream-200 rounded-2xl animate-pulse" />
                        <div className="h-16 bg-cream-200 rounded-2xl animate-pulse" />
                    </div>
                ) : selected.length === 0 ? (
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
                            // Finished first out, then unclaimed to the top: only one of
                            // those is a job, and a dropped-off trip is a receipt.
                            const done = Number(TERMINAL.includes(a.status)) - Number(TERMINAL.includes(b.status));
                            if (done !== 0) return done;
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

            {/* Under the board, because the board is the thing it is talking about.
                Airport Seva had NO push prompt at all until 2026-08-25 — the whole
                mechanism existed and was offered only on the two sabha screens, so a
                Sarthi who never used Sabha Seva was never asked, and every airport
                notification the server sent went nowhere.

                The wording is what this person actually receives: the change alert on
                a trip they hold, and — coordinators only — the unclaimed sweep. It
                does not promise a coordinator alert to somebody who will not get one. */}
            <PushPrompt
                title="Get told when an airport pickup needs you"
                detail={isCoordinator
                    ? 'One notification if something changes on a pickup you are collecting, '
                      + 'and one if an arrival still has nobody. Nothing else.'
                    : 'One notification if something changes on a pickup you are collecting. '
                      + 'Nothing else.'}
            />

            <PressingStrip days={monthDays} onPick={pick} />

            {/*
              * THE AIRPORT HALF OF THE NOTIFICATION PANEL, and it lives here rather
              * than in the manager's Setup tab because this is the service it is
              * about. A coordinator being woken at 5am by the unclaimed escalation
              * should be able to retune it without leaving Airport Seva — Setup is a
              * sabha tab, two navigations away behind a service switch.
              *
              * MANAGERS ONLY. `isApprovedManager` reads the RECORDED role, so a
              * manager wearing the Sarthi hat keeps it and a plain Sarthi — who
              * reaches this same board — never sees it. The callable enforces the same
              * thing server-side; this only decides whether to render a control that
              * would otherwise fail on tap.
              *
              * Collapsed, like every section in Setup: somebody opening the board came
              * to look at arrivals, not at settings.
              */}
            {isManager && (
                <Disclosure
                    icon={<Bell size={20} />}
                    title="Notifications"
                    summary="Which airport messages go out, and how often"
                    open={settingsOpen}
                    onToggle={() => setSettingsOpen(open => !open)}
                >
                    <NotificationSettings service="airport" />
                </Disclosure>
            )}
        </div>
    );
};

/**
 * The days in THIS MONTH that still need somebody, as jump targets.
 *
 * MONTH-SCOPED, and this comment is the correction: the old version claimed to work
 * "regardless of which month is showing" and never did — it reduced over the fetched
 * array, which is one month plus 36 hours. The owner's call on 2026-08-25 was to keep
 * the scope and fix the claim rather than widen it, because the honest wide version needs
 * an unbounded `status == 'open'` plus `orderBy(arrivalAt)`: two fields, therefore a
 * composite index, and a missing index fails as an EMPTY RESULT rather than an error
 * (see hooks/useArrivals.ts). Silently empty is the one failure this list must not have.
 * The summary line at the top of the card covers the whole month anyway.
 *
 * Rows are BUTTONS. The old ones were inert <li>s printing a raw ISO date and a raw
 * 24-hour time — a list that told a Sarthi what needed doing and gave them no way to
 * act on it.
 */
const PressingStrip: React.FC<{
    days: MonthDay[];
    onPick: (key: string) => void;
}> = ({ days, onPick }) => {
    // Capped, because a busy month should not push the calendar off the screen it is
    // meant to summarise. The count in the header stays honest about the remainder.
    const pressing = useMemo(() => days.filter(d => d.unclaimed > 0), [days]);
    const shown = pressing.slice(0, 6);

    if (pressing.length === 0) return null;

    return (
        <section className="clay-card p-4" aria-label="Arrivals still needing a Sarthi">
            <h2 className="font-header font-bold text-coffee text-sm mb-2">
                Still needs a Sarthi this month
            </h2>
            <ul className="space-y-1">
                {shown.map(({ key, list, unclaimed }) => {
                    const first = list.find(a => a.status === 'open')!;
                    return (
                        <li key={key}>
                            <button
                                type="button"
                                onClick={() => onPick(key)}
                                // Explicit, for the same reason as the summary line: the
                                // computed name was "2Wed 2610:00 PM · BOS · Ramesh".
                                aria-label={`${shortDayLabel(key)}: ${unclaimed} still `
                                    + `${unclaimed === 1 ? 'needs' : 'need'} a Sarthi. First at `
                                    + `${formatTime(first.arrivalTime)} from ${first.airportCode}, `
                                    + `${first.requesterName}.`}
                                className="w-full min-h-11 flex items-center gap-2 text-left text-sm
                                           text-coffee-700 rounded-xl px-2 hover:bg-cream-300 transition-colors"
                            >
                                <span className={`${BADGE} ${NEEDS_SOMEBODY}`}>{unclaimed}</span>
                                <span className="font-bold shrink-0">{shortDayLabel(key)}</span>
                                <span className="text-coffee-500 truncate">
                                    {formatTime(first.arrivalTime)} · {first.airportCode} · {first.requesterName}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {pressing.length > shown.length && (
                <p className="text-xs text-coffee-500 mt-2 px-2">
                    and {pressing.length - shown.length} more {
                        pressing.length - shown.length === 1 ? 'day' : 'days'} this month
                </p>
            )}
        </section>
    );
};
