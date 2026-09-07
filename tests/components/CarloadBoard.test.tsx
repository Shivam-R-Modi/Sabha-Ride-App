/**
 * The carload board — the waiting queue drawn as the cars dispatch would form.
 *
 * WHAT THESE TESTS ARE FOR is narrower than "does it render". The grouping arithmetic is
 * the server's and is tested there. What can go wrong HERE is the board claiming more
 * than it knows:
 *
 *   - a grouping that reads as fixed, when it re-forms on every tap;
 *   - a settled-looking board that describes a queue two riders out of date;
 *   - a rider left off the screen entirely, which is this codebase's recurring defect;
 *   - "no car this big" — the one leftover reason that cannot resolve itself — looking
 *     the same as "nobody has got to them yet".
 *
 * Each of those is somebody waiting outside on a Friday night, so each has a test.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { CarloadBoard } from '../../components/manager/CarloadBoard';
import type { StudentRequest } from '../../types';
import type { CarloadPreviewResult } from '../../src/utils/cloudFunctions';

const rider = (id: string, name: string, over: Partial<StudentRequest> = {}): StudentRequest => ({
    id,
    name,
    address: `${name} Street`,
    requestTime: new Date().toISOString(),
    requestedTimeSlot: '7:00 PM',
    status: 'pending',
    ...over,
});

const REQUESTS = [
    rider('r1', 'Anita'),
    rider('r2', 'Bhavin'),
    rider('r3', 'Chirag'),
    rider('r4', 'Deepa'),
];

const ok = (over: Partial<CarloadPreviewResult> = {}): CarloadPreviewResult => ({
    status: 'ok',
    carSeats: [3],
    groups: [{
        seats: 3,
        anchorId: 'r1',
        riders: [
            { id: 'r1', seats: 1, totalSeats: 1, split: false },
            { id: 'r2', seats: 1, totalSeats: 1, split: false },
        ],
    }],
    leftover: [],
    ...over,
});

/** One hall — production today, and the state in which no picker renders. */
const ONE_HALL = [{
    id: 'boston-huntington', name: 'Huntington Ave', active: true, order: 0,
    venue: { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' },
}] as any;

const TWO_HALLS = [
    ...ONE_HALL,
    {
        id: 'somerville', name: 'Elm Street', active: true, order: 1,
        venue: { lat: 42.387, lng: -71.099, address: '5 Elm Street' },
    },
] as any;

const renderBoard = (over: Partial<React.ComponentProps<typeof CarloadBoard>> = {}) =>
    render(
        <CarloadBoard
            requests={REQUESTS}
            halls={ONE_HALL}
            selectedHall="boston-huntington"
            onSelectHall={() => {}}
            preview={ok()}
            loading={false}
            error={null}
            stale={false}
            onRefresh={() => {}}
            {...over}
        />,
    );

describe('CarloadBoard — the grouping', () => {
    it('draws one card per car, with the riders in it', async () => {
        renderBoard();

        expect(await screen.findByText('Car 1')).toBeTruthy();
        expect(screen.getByText('Anita')).toBeTruthy();
        expect(screen.getByText('Bhavin')).toBeTruthy();
    });

    it('SHOWS THE SEAT COUNT it assumed, on the card', async () => {
        // The whole of this screen's honesty. A card reading only "Car 1" implies the
        // grouping is absolute; the seats are what say it depended on an assumption.
        renderBoard();
        expect(await screen.findByText('3 seats')).toBeTruthy();
    });

    it('says in words that the split re-forms on every tap', async () => {
        /**
         * The load-bearing sentence. Read as a plan, a manager will move somebody by
         * hand to "fix" a grouping that was never going to happen that way — and
         * `manualAssignStudent` will put them in a car they are nowhere near.
         */
        renderBoard();
        expect(await screen.findByText(/re-forms on every tap/i)).toBeTruthy();
    });

    it('marks the anchor, so "why those two" has an answer on screen', async () => {
        renderBoard();
        expect(await screen.findByText(/Furthest out/i)).toBeTruthy();
    });

    it('marks NO anchor when the server could not name one', async () => {
        // Null means the anchor did not fit in the car. A label naming somebody who is
        // not in the list reads as a bug and a manager would chase it.
        renderBoard({ preview: ok({
            groups: [{
                seats: 2, anchorId: null,
                riders: [{ id: 'r2', seats: 1, totalSeats: 1, split: false }],
            }],
        }) });

        expect(await screen.findByText('Bhavin')).toBeTruthy();
        expect(screen.queryByText(/Furthest out/i)).toBeNull();
    });

    it('shows how much of a split family travels and that the rest do not', async () => {
        // Silent, this looks like the whole group has a ride.
        renderBoard({ preview: ok({
            groups: [{
                seats: 3, anchorId: 'r1',
                riders: [{ id: 'r1', seats: 3, totalSeats: 6, split: true }],
            }],
        }) });

        expect(await screen.findByText(/3 of 6 — rest still waiting/)).toBeTruthy();
    });
});

describe('CarloadBoard — everyone is accounted for', () => {
    it('lists the riders no car reached', async () => {
        renderBoard({ preview: ok({
            leftover: [
                { id: 'r3', seats: 1, reason: 'no-car-left' },
                { id: 'r4', seats: 2, reason: 'waiting-for-bigger-vehicle' },
            ],
        }) });

        expect(await screen.findByText('Chirag')).toBeTruthy();
        expect(screen.getByText('Deepa')).toBeTruthy();
        expect(screen.getByText(/Still waiting after these cars/i)).toBeTruthy();
    });

    it('DISTINGUISHES the reason that cannot resolve itself', async () => {
        /**
         * "No vehicle seats this many and they asked not to be split" needs a manager to
         * register a bigger car or talk to the rider — every driver will skip them every
         * round, all evening, otherwise. Rendered identically to "nobody has got to them
         * yet" it is invisible, which is how a large family gets passed over.
         */
        renderBoard({ preview: ok({
            leftover: [{ id: 'r3', seats: 6, reason: 'too-large-to-keep-together' }],
        }) });

        expect(await screen.findByText('No car this big')).toBeTruthy();
        expect(screen.getByText(/larger vehicle is registered/i)).toBeTruthy();
    });

    it('does not use colour alone to say which leftover is grave', async () => {
        // Each reason carries its own words. A manager who cannot distinguish the two
        // reds — or is reading a printout — still gets the difference.
        renderBoard({ preview: ok({
            leftover: [
                { id: 'r3', seats: 6, reason: 'too-large-to-keep-together' },
                { id: 'r4', seats: 1, reason: 'no-car-left' },
            ],
        }) });

        expect(await screen.findByText('No car this big')).toBeTruthy();
        expect(screen.getByText('No car free')).toBeTruthy();
    });

    it('names a rider it has no record of, rather than dropping the row', async () => {
        /**
         * The grouping and the names come from different reads — a callable and a live
         * subscription — so a request dismissed in between is in one and not the other.
         * A row that quietly vanishes is how the board and the queue stop adding up with
         * nothing on screen saying why.
         */
        renderBoard({ preview: ok({
            groups: [{
                seats: 3, anchorId: 'ghost',
                riders: [{ id: 'ghost', seats: 1, totalSeats: 1, split: false }],
            }],
        }) });

        expect(await screen.findByText(/Unknown rider/i)).toBeTruthy();
    });
});

describe('CarloadBoard — states that are not a grouping', () => {
    it('says rides are not open, rather than drawing an empty board', async () => {
        // Not an error. A manager looking at the queue on a Tuesday has done nothing
        // wrong, and an empty board would read as "the grouping is broken".
        renderBoard({ preview: { status: 'window-closed', groups: [], leftover: [], carSeats: [] } });

        expect(await screen.findByText(/Rides are not open right now/i)).toBeTruthy();
    });

    it('surfaces the SERVER\'s error message, not a generic one', async () => {
        // It refuses for reasons a manager can act on — a revoked account, a hall that
        // is no longer open — and "please try again" hides every one of them.
        renderBoard({ preview: null, error: 'Manager access has been revoked.' });

        expect(await screen.findByText('Manager access has been revoked.')).toBeTruthy();
    });

    it('offers a way out of the error, not just the news', async () => {
        const onRefresh = vi.fn();
        renderBoard({ preview: null, error: 'Something broke', onRefresh });

        await userEvent.click(screen.getByRole('button', { name: /Try again/i }));
        expect(onRefresh).toHaveBeenCalled();
    });

    it('SAYS SO when the queue has moved on since it was worked out', async () => {
        /**
         * `stale` is not `loading`. Loading means a request is in flight; stale means
         * what you are reading describes a different queue. Conflated, a settled-looking
         * board is quietly out of date — and the manager acting on it is the whole
         * failure.
         */
        renderBoard({ stale: true });

        expect(await screen.findByText(/Somebody has asked for a ride since this was worked out/i))
            .toBeTruthy();
    });

    it('does not cry stale when it is up to date', async () => {
        renderBoard({ stale: false });
        expect(screen.queryByText(/since this was worked out/i)).toBeNull();
    });

    it('recalculates on demand', async () => {
        const onRefresh = vi.fn();
        renderBoard({ onRefresh });

        await userEvent.click(screen.getByRole('button', { name: /Recalculate/i }));
        expect(onRefresh).toHaveBeenCalled();
    });

    it('says nothing forms, rather than nothing at all, when no car can take anybody', async () => {
        // Every car in use. An empty board with no words is indistinguishable from a
        // fault.
        renderBoard({ preview: ok({ groups: [], carSeats: [], leftover: [
            { id: 'r1', seats: 1, reason: 'no-car-left' },
        ] }) });

        expect(await screen.findByText(/No carload forms right now/i)).toBeTruthy();
        expect(screen.getByText('Anita')).toBeTruthy();
    });
});

/**
 * ONE HALL AT A TIME, and nobody vanishes because of it.
 *
 * Cars never mix halls, so a grouping is per hall. That creates the hazard this block
 * exists for: every rider bound for the OTHER hall is in neither the cars nor the
 * leftovers, so without a word on screen they are simply absent from the board a manager
 * uses to check who is waiting. Same principle the CSV export already follows — dispatch
 * refuses the ambiguous, a view shows it and says so.
 */
describe('CarloadBoard — the hall picker', () => {
    it('shows NO picker with one hall open', async () => {
        // Production today. A choice with one option, and a hall name on a screen that
        // has never carried one.
        renderBoard({ halls: ONE_HALL });

        await screen.findByText('Car 1');
        expect(screen.queryByText(/Carloads for/i)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Huntington Ave' })).toBeNull();
    });

    it('offers one button per hall, and marks which is showing', async () => {
        renderBoard({ halls: TWO_HALLS, selectedHall: 'somerville' });

        expect(await screen.findByRole('button', { name: 'Elm Street' }))
            .toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Huntington Ave' }))
            .toHaveAttribute('aria-pressed', 'false');
    });

    it('reports the pick', async () => {
        const onSelectHall = vi.fn();
        renderBoard({ halls: TWO_HALLS, onSelectHall });

        await userEvent.click(await screen.findByRole('button', { name: 'Elm Street' }));
        expect(onSelectHall).toHaveBeenCalledWith('somerville');
    });

    it('SAYS HOW MANY ARE WAITING AT THE OTHER HALL', async () => {
        // The line that stops a rider disappearing. Without it, Chirag and Deepa are
        // nowhere on this screen at all.
        renderBoard({
            halls: TWO_HALLS,
            selectedHall: 'boston-huntington',
            requests: [
                rider('r1', 'Anita', { locationId: 'boston-huntington' }),
                rider('r3', 'Chirag', { locationId: 'somerville' }),
                rider('r4', 'Deepa', { locationId: 'somerville' }),
            ],
        });

        expect(await screen.findByText(/2 waiting at Elm Street/i)).toBeTruthy();
    });

    it('says nothing about a hall with nobody waiting at it', async () => {
        // A zero would be noise on every quiet evening.
        renderBoard({
            halls: TWO_HALLS,
            selectedHall: 'boston-huntington',
            requests: [rider('r1', 'Anita', { locationId: 'boston-huntington' })],
        });

        await screen.findByText('Car 1');
        expect(screen.queryByText(/waiting at Elm Street/i)).toBeNull();
    });

    it('FLAGS a request that names no sabha at all', async () => {
        /**
         * Dispatch refuses these once two halls are open — genuinely unknowable, and
         * guessing sends a car to the wrong building. So they belong to no hall's board
         * and are invisible on every one of them. A rider no Sarthi can be sent to is
         * exactly the one a manager needs to see, and the fix is on the request.
         */
        renderBoard({
            halls: TWO_HALLS,
            selectedHall: 'boston-huntington',
            requests: [
                rider('r1', 'Anita', { locationId: 'boston-huntington' }),
                rider('r9', 'Unstamped'),
            ],
        });

        expect(await screen.findByText(/1 request names no sabha/i)).toBeTruthy();
        expect(screen.getByText(/no Sarthi can be sent/i)).toBeTruthy();
    });

    it('does not flag an unstamped request when only one hall is open', async () => {
        // With one hall there is no ambiguity: dispatch serves it, so there is nothing
        // to warn about and a warning would be a false alarm every evening.
        renderBoard({
            halls: ONE_HALL,
            requests: [rider('r1', 'Anita'), rider('r9', 'Unstamped')],
        });

        await screen.findByText('Car 1');
        expect(screen.queryByText(/names no sabha/i)).toBeNull();
    });

    it('keeps the picker reachable when THIS hall has no window open', async () => {
        // Precisely when a manager wants the other hall. A picker that disappears on a
        // quiet hall is a control that vanishes when it is needed.
        renderBoard({
            halls: TWO_HALLS,
            preview: { status: 'window-closed', groups: [], leftover: [], carSeats: [] },
        });

        expect(await screen.findByRole('button', { name: 'Elm Street' })).toBeTruthy();
        expect(screen.getByText(/Rides are not open right now/i)).toBeTruthy();
    });

    it('keeps the picker reachable through an error', async () => {
        renderBoard({ halls: TWO_HALLS, preview: null, error: 'Something broke' });

        expect(await screen.findByRole('button', { name: 'Elm Street' })).toBeTruthy();
        expect(screen.getByText('Something broke')).toBeTruthy();
    });

    it('keeps the picker reachable while the first grouping loads', async () => {
        renderBoard({ halls: TWO_HALLS, preview: null, loading: true });

        expect(await screen.findByRole('button', { name: 'Elm Street' })).toBeTruthy();
        expect(screen.getByText(/Working out the carloads/i)).toBeTruthy();
    });

    it('SAYS SO while it is still showing the hall you switched away from', async () => {
        /**
         * The moment between tapping a hall and the new grouping landing. Left unsaid,
         * the board shows Huntington's cars under a picker reading Elm Street — nothing
         * loading-looking, nothing stale, and completely wrong. The server echoes the
         * hall it answered for, which is what makes this checkable rather than assumed.
         */
        renderBoard({
            halls: TWO_HALLS,
            selectedHall: 'somerville',
            preview: ok({ locationId: 'boston-huntington' }),
        });

        expect(await screen.findByText(/Still showing Huntington Ave/i)).toBeTruthy();
    });

    it('does not say that when the answer IS for the hall showing', async () => {
        renderBoard({
            halls: TWO_HALLS,
            selectedHall: 'somerville',
            preview: ok({ locationId: 'somerville' }),
        });

        await screen.findByText('Car 1');
        expect(screen.queryByText(/Still showing/i)).toBeNull();
    });

    it('does not say that when the server did not name a hall', async () => {
        // An older function revision, mid-rollout. Silence beats a warning built on a
        // field that is simply absent.
        renderBoard({
            halls: TWO_HALLS,
            selectedHall: 'somerville',
            preview: ok({ locationId: undefined }),
        });

        await screen.findByText('Car 1');
        expect(screen.queryByText(/Still showing/i)).toBeNull();
    });
});
