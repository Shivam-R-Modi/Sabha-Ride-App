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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        // Wait for the SELECTION to be committed, not merely for the button to
        // exist. The action bar mounts as soon as one row is ticked, and its
        // onClick closes over selectedIds — so clicking the instant it appears
        // can fire against a half-applied selection.
        await screen.findByText('1 Selected');
        await user.click(screen.getByRole('button', { name: /assign bulk/i }));

        await waitFor(() => expect(onBulkAssign).toHaveBeenCalledWith(['a']));
    });

    it('select-all ticks every row currently shown', async () => {
        const user = userEvent.setup();
        const onBulkAssign = vi.fn();
        renderTable({
            requests: [request({ id: 'a' }), request({ id: 'b', name: 'Bhavesh Joshi' })],
            onBulkAssign,
        });

        await user.click(within(table()).getAllByRole('checkbox')[0]);
        await screen.findByText('2 Selected');
        await user.click(screen.getByRole('button', { name: /assign bulk/i }));

        await waitFor(() => expect(onBulkAssign).toHaveBeenCalledWith(['a', 'b']));
    });
});

describe('RequestTable — bulk select on a phone', () => {
    /**
     * STATUS.md carried this as a known gap: "bulk-select on the manager's queue
     * exists only in the desktop table. On a phone the checkboxes and Assign
     * Bulk are unreachable." Phase 5 closed it with a long-press.
     *
     * The mobile card list is `md:hidden`, and jsdom applies no CSS, so it is in
     * the document alongside the table. Mobile assertions therefore scope
     * OUTSIDE the table.
     */
    const mobileCard = (name: string) => {
        const heading = screen.getAllByText(name)
            .find(el => !table().contains(el));
        // The card is the positioned foreground element, a few levels up.
        let node: HTMLElement | null = heading as HTMLElement;
        while (node && !node.className?.includes?.('rounded-2xl')) node = node.parentElement;
        return node!;
    };

    const longPress = async (element: HTMLElement) => {
        fireEvent.touchStart(element, { touches: [{ clientX: 0 }] });
        await act(() => new Promise(r => setTimeout(r, 500)));
        fireEvent.touchEnd(element);
    };

    it('shows no checkboxes on the cards until asked', () => {
        // A checkbox on every card would cost width where width is scarcest,
        // and triage is one-at-a-time most of the time.
        renderTable({ requests: [request()] });
        const outsideTable = screen.getAllByRole('checkbox')
            .filter(box => !table().contains(box));
        expect(outsideTable).toHaveLength(0);
    });

    it('a long press starts selecting', async () => {
        renderTable({ requests: [request()] });

        await longPress(mobileCard('Anita Shah'));

        expect(screen.getByRole('checkbox', { name: /select anita shah/i })).toBeChecked();
    });

    it('bulk-assigns what was selected on the phone', async () => {
        const user = userEvent.setup();
        const onBulkAssign = vi.fn();
        renderTable({ requests: [request({ id: 'a' })], onBulkAssign });

        await longPress(mobileCard('Anita Shah'));
        await user.click(await screen.findByRole('button', { name: /assign bulk/i }));

        await waitFor(() => expect(onBulkAssign).toHaveBeenCalledWith(['a']));
    });

    it('a swipe is not a long press', async () => {
        // Moving the finger has to cancel the hold, or every swipe-to-assign
        // would also toggle selection.
        renderTable({ requests: [request()] });
        const card = mobileCard('Anita Shah');

        fireEvent.touchStart(card, { touches: [{ clientX: 0 }] });
        fireEvent.touchMove(card, { touches: [{ clientX: 60 }] });
        await act(() => new Promise(r => setTimeout(r, 500)));
        fireEvent.touchEnd(card);

        expect(screen.queryByRole('checkbox', { name: /select anita shah/i }))
            .not.toBeInTheDocument();
    });

    it('suspends swipe actions while selecting, so a sloppy tap cannot dismiss anyone', async () => {
        const onDismiss = vi.fn();
        renderTable({ requests: [request()], onDismiss });
        const card = mobileCard('Anita Shah');

        await longPress(card);

        fireEvent.touchStart(card, { touches: [{ clientX: 200 }] });
        fireEvent.touchMove(card, { touches: [{ clientX: 0 }] });
        fireEvent.touchEnd(card);

        expect(onDismiss).not.toHaveBeenCalled();
    });
});
