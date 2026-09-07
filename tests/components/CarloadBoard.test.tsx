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

const renderBoard = (over: Partial<React.ComponentProps<typeof CarloadBoard>> = {}) =>
    render(
        <CarloadBoard
            requests={REQUESTS}
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
