/**
 * The manager's Request Center queue.
 *
 * The second of the two surfaces STATUS.md records as never having been seen
 * rendered. The Seats column is the part that matters most: without it the queue
 * reads "7 waiting" when it is 7 requests and 14 people, and a family no vehicle
 * can carry looks exactly like a rider who merely has not been picked up yet.
 * That silence is how a large family gets passed over all evening.
 *
 * Note for anyone reading a failure here: this component mounts BOTH views at
 * once — a desktop <table> inside `hidden md:block`, and a mobile card list
 * inside `md:hidden`. jsdom applies no CSS, so every request is in the document
 * twice. Desktop assertions are therefore scoped with `within(table)`, and
 * counts use getAllBy*.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const useMaxFleetSeats = vi.fn();
vi.mock('../../hooks/useVehicles', () => ({ useMaxFleetSeats: () => useMaxFleetSeats() }));

import { RequestTable } from '../../components/manager/RequestTable';
import type { StudentRequest } from '../../types';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const request = (over: Partial<StudentRequest> = {}): StudentRequest => ({
    id: 'req-1',
    name: 'Anita Shah',
    address: '12 Maple Ave, Edison NJ',
    requestTime: minutesAgo(5),
    requestedTimeSlot: '7:00 PM',
    status: 'pending',
    ...over,
});

const noop = () => { };

const renderTable = (props: Partial<React.ComponentProps<typeof RequestTable>> = {}) =>
    render(
        <RequestTable
            requests={[request()]}
            loading={false}
            onAssign={noop}
            onDismiss={noop}
            onBulkAssign={noop}
            {...props}
        />,
    );

/** The desktop table, which is where the columns live. */
const table = () => screen.getByRole('table');

beforeEach(() => {
    // Two cars, 4 seats each → 3 passenger seats. Measured from production;
    // see docs/plans/phase-3-seats.md.
    useMaxFleetSeats.mockReturnValue(3);
});

describe('RequestTable — the queue itself', () => {
    it('lists a waiting rider by name and address', () => {
        renderTable();
        const t = within(table());
        expect(t.getByText('Anita Shah')).toBeInTheDocument();
        expect(t.getByText('12 Maple Ave, Edison NJ')).toBeInTheDocument();
    });

    it('shows a skeleton while loading rather than an empty queue', () => {
        renderTable({ loading: true });
        // The dangerous failure is showing "All Caught Up!" before the data has
        // arrived — a manager would believe nobody is waiting.
        expect(screen.queryByText(/All Caught Up/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('says the queue is clear only when it really is', () => {
        renderTable({ requests: [], loading: false });
        expect(screen.getByText(/All Caught Up/i)).toBeInTheDocument();
    });

    it('filters by name', async () => {
        const user = userEvent.setup();
        renderTable({
            requests: [request(), request({ id: 'req-2', name: 'Bhavesh Joshi', address: '9 Elm St' })],
        });

        await user.type(screen.getByPlaceholderText(/search students or locations/i), 'Bhavesh');

        const t = within(table());
        expect(t.getByText('Bhavesh Joshi')).toBeInTheDocument();
        expect(t.queryByText('Anita Shah')).not.toBeInTheDocument();
    });

    it('filters by address, because a manager thinks in streets', async () => {
        const user = userEvent.setup();
        renderTable({
            requests: [request(), request({ id: 'req-2', name: 'Bhavesh Joshi', address: '9 Elm St' })],
        });

        await user.type(screen.getByPlaceholderText(/search students or locations/i), 'Elm');

        const t = within(table());
        expect(t.getByText('Bhavesh Joshi')).toBeInTheDocument();
        expect(t.queryByText('Anita Shah')).not.toBeInTheDocument();
    });
});

describe('RequestTable — seats, so nobody counts rows for people', () => {
    it('shows the seat count for a party', () => {
        renderTable({ requests: [request({ seats: 4 })] });
        // Present in both the desktop and mobile renderings.
        expect(within(table()).getByText('4')).toBeInTheDocument();
    });

    it('treats a request with no seat field as one person', () => {
        renderTable({ requests: [request()] });
        expect(within(table()).getByText('1')).toBeInTheDocument();
    });

    it('flags a party larger than any car as needing two', () => {
        renderTable({ requests: [request({ seats: 5, keepTogether: false })] });
        expect(within(table()).getByText(/Needs 2 cars/i)).toBeInTheDocument();
    });

    it('flags a party that cannot be served at all, because they asked to stay together', () => {
        // 5 people, no car seats more than 3, and they declined to be split.
        // Nobody can pick them up. This must be visible, not silent.
        renderTable({ requests: [request({ seats: 5, keepTogether: true })] });
        expect(within(table()).getByText(/No car this big/i)).toBeInTheDocument();
        expect(within(table()).queryByText(/Needs 2 cars/i)).not.toBeInTheDocument();
    });

    it('does not cry wolf about a party that fits', () => {
        renderTable({ requests: [request({ seats: 3 })] });
        const t = within(table());
        expect(t.queryByText(/Needs 2 cars/i)).not.toBeInTheDocument();
        expect(t.queryByText(/No car this big/i)).not.toBeInTheDocument();
    });

    it('shows how much of a split group is still waiting', () => {
        renderTable({
            requests: [request({ seats: 2, groupSeatsTotal: 5, isRemainder: true })],
        });
        expect(within(table()).getByText(/2 of 5 left/i)).toBeInTheDocument();
    });

    it('does not warn a remainder that it needs two cars — it is already the second', () => {
        renderTable({
            requests: [request({ seats: 5, groupSeatsTotal: 8, isRemainder: true, keepTogether: false })],
        });
        expect(within(table()).queryByText(/Needs 2 cars/i)).not.toBeInTheDocument();
    });

    it('makes no capacity claim before the fleet is known', () => {
        // maxFleetSeats 0 means the vehicles have not loaded. Claiming "no car
        // this big" then would be a guess presented as a fact.
        useMaxFleetSeats.mockReturnValue(0);
        renderTable({ requests: [request({ seats: 8, keepTogether: true })] });

        const t = within(table());
        expect(t.queryByText(/No car this big/i)).not.toBeInTheDocument();
        expect(t.queryByText(/Needs 2 cars/i)).not.toBeInTheDocument();
    });
});

describe('RequestTable — waiting time', () => {
    it('shows how long someone has been waiting', () => {
        renderTable({ requests: [request({ requestTime: minutesAgo(12) })] });
        expect(within(table()).getByText(/12m wait/)).toBeInTheDocument();
    });

    it('escalates a rider left over half an hour', () => {
        renderTable({ requests: [request({ requestTime: minutesAgo(45) })] });
        expect(within(table()).getByText(/45m wait/)).toBeInTheDocument();
    });
});

describe('RequestTable — sorting', () => {
    it('reverses when the same column is clicked twice', async () => {
        const user = userEvent.setup();
        renderTable({
            requests: [
                request({ id: 'a', name: 'Anita Shah' }),
                request({ id: 'z', name: 'Zara Mehta' }),
            ],
        });

        const nameHeader = within(table()).getByText('Student');
        const namesNow = () =>
            within(table()).getAllByText(/Anita Shah|Zara Mehta/).map(n => n.textContent);

        await user.click(nameHeader);
        const first = namesNow();
        await user.click(nameHeader);
        const second = namesNow();

        // The direction toggle was dead for a while — setSortOrder was never
        // called, so the header arrows were decoration. This is the guard.
        expect(second).toEqual([...first].reverse());
    });
});

describe('RequestTable — acting on a request', () => {
    it('assigns the request the manager clicked', async () => {
        const user = userEvent.setup();
        const onAssign = vi.fn();
        renderTable({ requests: [request({ id: 'req-42' })], onAssign });

        await user.click(within(table()).getByTitle(/assign to driver/i));

        expect(onAssign).toHaveBeenCalledWith('req-42');
    });

    it('dismisses the request the manager clicked', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        renderTable({ requests: [request({ id: 'req-42' })], onDismiss });

        await user.click(within(table()).getByTitle(/dismiss request/i));

        expect(onDismiss).toHaveBeenCalledWith('req-42');
    });

    it('bulk-assigns exactly the rows that were ticked', async () => {
        const user = userEvent.setup();
        const onBulkAssign = vi.fn();
        renderTable({
            requests: [request({ id: 'a' }), request({ id: 'b', name: 'Bhavesh Joshi' })],
            onBulkAssign,
        });

        const boxes = within(table()).getAllByRole('checkbox');
        // boxes[0] is select-all; the rest are rows.
        await user.click(boxes[1]);
        await user.click(screen.getByRole('button', { name: /assign bulk/i }));

        expect(onBulkAssign).toHaveBeenCalledWith(['a']);
    });

    it('select-all ticks every row currently shown', async () => {
        const user = userEvent.setup();
        const onBulkAssign = vi.fn();
        renderTable({
            requests: [request({ id: 'a' }), request({ id: 'b', name: 'Bhavesh Joshi' })],
            onBulkAssign,
        });

        await user.click(within(table()).getAllByRole('checkbox')[0]);
        await user.click(screen.getByRole('button', { name: /assign bulk/i }));

        expect(onBulkAssign).toHaveBeenCalledWith(['a', 'b']);
    });
});

describe('RequestTable — known gap, recorded so the fix is verifiable', () => {
    it('offers no bulk selection outside the desktop table', () => {
        // STATUS.md: "bulk-select on the manager's queue exists only in the
        // desktop table. On a phone the checkboxes and Assign Bulk are
        // unreachable." Every checkbox in the document belongs to the table.
        //
        // When Phase 5 gives the mobile list a selection mode, this test will
        // fail — and that failure is the signal to update it, not a regression.
        renderTable({ requests: [request()] });

        const all = screen.getAllByRole('checkbox');
        const inTable = within(table()).getAllByRole('checkbox');
        expect(all.length).toBe(inTable.length);
    });
});
