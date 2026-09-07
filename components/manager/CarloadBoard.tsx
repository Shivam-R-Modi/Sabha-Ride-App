import React from 'react';
import { AlertCircle, Car, Loader2, RefreshCw, Users, MapPin, Anchor } from 'lucide-react';
import { StudentRequest } from '../../types';
import type { CarloadPreviewResult, CarloadLeftoverReason } from '../../src/utils/cloudFunctions';

/**
 * The waiting queue drawn as the cars dispatch would form, instead of a flat list.
 *
 * ── WHY IT SAYS SO MUCH ABOUT WHAT IT ASSUMED ───────────────────────────────────────
 *
 * There is no single true grouping, and a screen that implies otherwise is worse than
 * the list it replaced. A real carload depends on WHICH Sarthi taps: their car's free
 * seats decide where the load is cut, and dispatch geo-fences the pool to riders within
 * 15 miles of the DRIVER. The server therefore returns the seat count it assumed for
 * every car, and this renders it — "4 seats", not "Car 1".
 *
 * The one line under the heading is doing real work: a manager who reads this as fixed
 * will move somebody by hand to "fix" a grouping that was never going to happen, and
 * `manualAssignStudent` will happily put them in a car they were not near.
 *
 * ── LEFTOVERS CARRY A REASON, NEVER A COUNT ─────────────────────────────────────────
 *
 * "Nobody has collected them yet" and "no vehicle in the fleet seats this many and they
 * asked not to be split" look identical in a list and need completely different things
 * from a manager. The second cannot resolve itself — every driver skips them every
 * round, all evening — and this queue has been bitten by exactly that before.
 */

/** Read-only: this board is for looking at. Assigning stays in the list view. */
interface CarloadBoardProps {
    /** Every waiting request, for joining names onto the server's ride ids. */
    requests: StudentRequest[];
    preview: CarloadPreviewResult | null;
    loading: boolean;
    error: string | null;
    /** The pool has moved on since this grouping was computed. */
    stale: boolean;
    onRefresh: () => void;
}

/**
 * What a manager should DO about a rider no car reached.
 *
 * Phrased as the action, not the state. "waiting-for-bigger-vehicle" is a fact about
 * the fleet; "the 7-seater is out with someone else" is a thing a person can act on.
 */
const LEFTOVER_COPY: Record<CarloadLeftoverReason, { label: string; detail: string; grave: boolean }> = {
    'no-car-left': {
        label: 'No car free',
        detail: 'Every car free right now fills up before reaching them. They travel when a Sarthi finishes a run.',
        grave: false,
    },
    'waiting-for-bigger-vehicle': {
        label: 'Needs a bigger car',
        detail: 'Too many people for the cars free right now, but a vehicle in the fleet can take them together.',
        grave: false,
    },
    'too-large-to-keep-together': {
        label: 'No car this big',
        detail: 'No vehicle in the fleet seats this many and they asked not to be split up. '
            + 'Nobody can collect them until a larger vehicle is registered, or they agree to travel separately.',
        grave: true,
    },
};

export const CarloadBoard: React.FC<CarloadBoardProps> = ({
    requests, preview, loading, error, stale, onRefresh,
}) => {
    const byId = new Map(requests.map(r => [r.id, r]));

    /**
     * A rider in the grouping that this list has never heard of.
     *
     * The two come from different reads — the grouping from a callable, the names from a
     * live subscription — so a request dismissed in between can be in one and not the
     * other. Rendered as the id rather than skipped: a row that quietly disappears is
     * how the board and the queue stop adding up with nothing saying why.
     */
    const nameOf = (id: string) => byId.get(id)?.name ?? `Unknown rider (${id.slice(0, 6)})`;

    if (loading && !preview) {
        return (
            <div className="p-6 flex items-center gap-3 text-sm text-coffee-500">
                <Loader2 size={16} className="animate-spin" />
                Working out the carloads…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        {/* The server's own message. It refuses for reasons a manager can
                            act on, and a generic "try again" would hide them. */}
                        <p className="text-sm font-bold">Could not work out the carloads</p>
                        <p className="text-sm mt-1">{error}</p>
                    </div>
                </div>
                <button
                    onClick={onRefresh}
                    className="mt-3 min-h-11 px-4 rounded-xl text-xs font-bold text-saffron-800 border border-saffron-800/35 hover:bg-cream-300"
                >
                    Try again
                </button>
            </div>
        );
    }

    if (!preview) return null;

    if (preview.status === 'window-closed') {
        // Not an error: rides are simply not open. Said plainly rather than drawn as an
        // empty board, which would read as "the grouping is broken".
        return (
            <div className="p-6 text-sm text-coffee-500">
                <p className="font-bold text-coffee">Rides are not open right now.</p>
                <p className="mt-1">
                    Carloads form once the request window opens for the next sabha.
                </p>
            </div>
        );
    }

    const { groups, leftover, carSeats } = preview;

    return (
        <div className="p-4 space-y-4">
            {/* ── What this is, and what it assumed ───────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-bold text-coffee">
                        {groups.length === 0
                            ? 'No carload forms right now'
                            : `${groups.length} car${groups.length === 1 ? '' : 's'} would take ${
                                groups.reduce((n, g) => n + g.riders.reduce((m, r) => m + r.seats, 0), 0)
                            } of them`}
                    </h3>
                    {/* THE LOAD-BEARING SENTENCE. Without it a manager reads the board as
                        a plan and moves people by hand to correct a split that was never
                        going to happen that way. */}
                    <p className="text-xs text-coffee-500 mt-1 max-w-prose">
                        Worked out the same way a Sarthi&apos;s <strong>Assign Me</strong> works it out, using
                        the {carSeats.length === 0 ? 'cars' : `${carSeats.length} car${carSeats.length === 1 ? '' : 's'}`} free
                        right now{carSeats.length > 0 ? ` (${carSeats.join(', ')} seats)` : ''}.
                        <strong> It re-forms on every tap</strong> — whoever taps first, and how big
                        their car is, changes who travels together.
                    </p>
                </div>

                <button
                    onClick={onRefresh}
                    disabled={loading}
                    className="min-h-11 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 text-saffron-800 border border-saffron-800/35 hover:bg-cream-300 disabled:opacity-50"
                >
                    {loading
                        ? <Loader2 size={14} className="animate-spin" />
                        : <RefreshCw size={14} />}
                    Recalculate
                </button>
            </div>

            {/* `stale` is not `loading`: one says a request is in flight, the other says
                what is on screen describes a different queue. A manager needs to tell
                them apart, or a settled-looking board is quietly out of date. */}
            {stale && (
                <p
                    role="status"
                    className="text-xs font-bold px-3 py-2 rounded-xl bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]"
                >
                    Somebody has asked for a ride since this was worked out. Recalculate to see the new split.
                </p>
            )}

            {/* ── One card per car ────────────────────────────────────────── */}
            {groups.map((group, index) => (
                <div
                    key={`${group.seats}-${index}-${group.riders[0]?.id ?? ''}`}
                    className="rounded-2xl border border-hairline/10 bg-surface overflow-hidden"
                >
                    <div className="flex items-center gap-2 flex-wrap px-4 py-3 bg-cream-200 border-b border-hairline/10">
                        <Car size={15} className="text-saffron-800 shrink-0" />
                        <span className="text-sm font-bold text-coffee">Car {index + 1}</span>
                        {/* The seats are the honesty, so they are on the card and not in
                            a tooltip. */}
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-cream-300 text-coffee-700 tabular-nums">
                            <Users size={11} /> {group.seats} seats
                        </span>
                        <span className="text-[11px] font-bold text-coffee-500 tabular-nums ml-auto">
                            {group.riders.reduce((n, r) => n + r.seats, 0)} of {group.seats} taken
                        </span>
                    </div>

                    <ul className="divide-y divide-hairline/10">
                        {group.riders.map(rider => {
                            const req = byId.get(rider.id);
                            const isAnchor = group.anchorId === rider.id;
                            return (
                                <li key={rider.id} className="px-4 py-3 flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-bold text-coffee truncate">
                                                {nameOf(rider.id)}
                                            </span>
                                            {/* WHY the car looks like this. A manager asking
                                                "why those three" is asking about this rider —
                                                everyone else was chosen by being near them.
                                                Absent when the anchor could not fit in the
                                                car, because a label naming somebody who is
                                                not in the list reads as a bug. */}
                                            {isAnchor && (
                                                <span
                                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]"
                                                    title="This car was built around them — farthest from the sabha, or waiting longest. Everyone else here is near them."
                                                >
                                                    <Anchor size={10} /> Furthest out
                                                </span>
                                            )}
                                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-cream-300 text-coffee-700 tabular-nums">
                                                <Users size={10} /> {rider.seats}
                                            </span>
                                            {/* Half a family in this car and half still
                                                waiting. Silent, this looks like the whole
                                                group has a ride. */}
                                            {rider.split && (
                                                <span
                                                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]"
                                                    title={`${rider.seats} of ${rider.totalSeats} travel in this car. The rest wait for another.`}
                                                >
                                                    {rider.seats} of {rider.totalSeats} — rest still waiting
                                                </span>
                                            )}
                                        </div>
                                        {req?.address && (
                                            <p className="text-xs text-coffee-500 truncate mt-0.5 flex items-center gap-1">
                                                <MapPin size={11} className="shrink-0" /> {req.address}
                                            </p>
                                        )}
                                        {req?.locationName && (
                                            <p className="text-xs font-semibold text-[rgb(var(--accent-text))] truncate mt-0.5">
                                                {req.locationName}
                                            </p>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}

            {/* ── Everyone no car reached, with the reason ─────────────────── */}
            {leftover.length > 0 && (
                <div className="rounded-2xl border border-hairline/10 bg-surface overflow-hidden">
                    <div className="px-4 py-3 bg-cream-200 border-b border-hairline/10">
                        <span className="text-sm font-bold text-coffee">
                            Still waiting after these cars
                        </span>
                    </div>
                    <ul className="divide-y divide-hairline/10">
                        {leftover.map(item => {
                            const copy = LEFTOVER_COPY[item.reason] ?? LEFTOVER_COPY['no-car-left'];
                            return (
                                <li key={item.id} className="px-4 py-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-bold text-coffee truncate">
                                            {nameOf(item.id)}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-cream-300 text-coffee-700 tabular-nums">
                                            <Users size={10} /> {item.seats}
                                        </span>
                                        {/* The grave one gets the danger token AND says so
                                            in words — colour alone is not a signal. */}
                                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${
                                            copy.grave
                                                ? 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]'
                                                : 'bg-cream-300 text-coffee-700'
                                        }`}>
                                            {copy.grave && <AlertCircle size={10} />} {copy.label}
                                        </span>
                                    </div>
                                    <p className="text-xs text-coffee-500 mt-1 max-w-prose">{copy.detail}</p>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};
