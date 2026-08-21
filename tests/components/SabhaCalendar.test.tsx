/**
 * One card, not a list of near-identical rows.
 *
 * The calendar used to render up to twelve dated rows, each with the same times,
 * the same derived ride window, its own Edit and its own delete button. Under a
 * repeating rule those rows are identical by construction — the screen grew with
 * how far ahead you could see while telling you nothing more, and twelve one-tap
 * deletes beside twelve identical rows is how you cancel the wrong Friday.
 *
 * Now: the next sabha in full, the rest as date chips. What these tests hold onto
 * is that condensing did not cost anything that mattered —
 *
 *   - every upcoming date is still REACHABLE, not just the first;
 *   - the weeks that diverge from the schedule are still called out;
 *   - editing and cancelling still act on the week actually on screen, which is
 *     the way a card can be wrong that a list cannot;
 *   - the closed-calendar warning still fires, because that is the one message on
 *     this screen that a congregation notices the absence of.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const editOccurrence = vi.fn(
    async (_date: string, _fields: unknown, _uid: string, _source: string) => undefined);
const previewDeleteSabhaEvent = vi.fn(async () => ({ responseCount: 0, requestedRideCount: 0 }));
const deleteSabhaEvent = vi.fn(async () => ({ success: true }));

let calendarStatus: 'ok' | 'no-scheduled-event' = 'ok';
let upcoming: any[] = [];

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'manager_1' } }),
}));
vi.mock('../../hooks/useEvents', () => ({
    useUpcomingEvents: () => ({
        events: upcoming, loading: false, error: null,
        rule: { enabled: true, daysOfWeek: [5], startTime: '20:30', endTime: '22:00', venue: null, agenda: '' },
    }),
    editOccurrence: (...a: unknown[]) =>
        editOccurrence(...(a as [string, unknown, string, string])),
    createOneOff: vi.fn(async () => undefined),
}));
vi.mock('../../hooks/useCurrentEvent', () => ({
    useCurrentEvent: () => ({ calendarStatus }),
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    previewDeleteSabhaEvent: (...a: unknown[]) => previewDeleteSabhaEvent(...(a as [])),
    deleteSabhaEvent: (...a: unknown[]) => deleteSabhaEvent(...(a as [])),
}));
// The repeating-schedule control is its own screen with its own tests; stubbed so
// its Firestore subscription is not dragged into these.
vi.mock('../../components/manager/RecurringSabha', () => ({
    RecurringSabha: () => <div>recurring-sabha</div>,
}));
vi.mock('../../components/auth/AddressAutocomplete', () => ({
    AddressAutocomplete: ({ value, onChange }: any) => (
        <input aria-label="Venue" value={value} onChange={e => onChange(e.target.value)} />
    ),
}));
// `formatTime` is a pure helper that happens to live beside the settings hook, so
// the real one is kept — the times on screen are what these tests read.
vi.mock('../../hooks/useSettings', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../hooks/useSettings')>();
    return {
        ...real,
        useSettings: () => ({
            sabhaLocation: { lat: 42.34, lng: -71.09, address: '346 Huntington Ave' },
            sabhaStartTime: '20:30',
            sabhaEndTime: '22:00',
        }),
    };
});
// Auto-confirms. What the delete tests assert is which DATE was sent, not the
// dialog — useConfirm has its own tests.
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask: vi.fn(async () => true), confirmDialog: null }),
}));

import { SabhaCalendar } from '../../components/manager/SabhaCalendar';

/** A week as the rule produces it, unless a test says otherwise. */
const week = (date: string, over: Record<string, unknown> = {}) => ({
    id: date, date, startTime: '20:30', endTime: '22:00',
    venue: null, agenda: '', source: 'rule', ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    calendarStatus = 'ok';
    upcoming = [
        week('2026-08-28'),
        week('2026-09-04'),
        week('2026-09-11', { source: 'override', startTime: '19:00' }),
        week('2026-09-18'),
        week('2026-09-25'),
        week('2026-10-02'),
    ];
});

describe('the next sabha gets the space', () => {
    it('shows it in full, once', async () => {
        render(<SabhaCalendar />);

        expect(screen.getByText('Next sabha')).toBeTruthy();
        expect(screen.getByText('Friday, Aug 28')).toBeTruthy();
        expect(screen.getByText(/8:30 PM – 10:00 PM/)).toBeTruthy();
    });

    it('spells out when rides actually open, which is not the sabha time', async () => {
        render(<SabhaCalendar />);

        expect(screen.getByText(/Requests open/)).toBeTruthy();
    });

    it('does not repeat the ride window six times', async () => {
        // The old list printed it on every row. One card, one copy.
        render(<SabhaCalendar />);

        expect(screen.getAllByText(/Requests open/)).toHaveLength(1);
    });

    it('says rides are open only from the app own answer', async () => {
        render(<SabhaCalendar />);
        expect(screen.getByText('Rides open')).toBeTruthy();
    });

    it('says nothing of the sort when the calendar is closed', async () => {
        calendarStatus = 'no-scheduled-event';
        render(<SabhaCalendar />);

        expect(screen.queryByText('Rides open')).toBeNull();
    });
});

describe('every other week is still reachable', () => {
    it('offers a chip for each upcoming date', async () => {
        render(<SabhaCalendar />);

        for (const label of ['Aug 28', 'Sep 4', 'Sep 11', 'Sep 18', 'Sep 25', 'Oct 2']) {
            expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
        }
    });

    it('brings a later week into the card when its chip is tapped', async () => {
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /Sep 25/ }));

        expect(screen.getByText('Friday, Sep 25')).toBeTruthy();
        expect(screen.getByText('Selected week')).toBeTruthy();
        expect(screen.queryByText('Next sabha')).toBeNull();
    });

    it('marks the week the card is showing', async () => {
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /Sep 25/ }));

        expect(screen.getByRole('button', { name: /Sep 25/ }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: /Sep 4/ }).getAttribute('aria-pressed')).toBe('false');
    });

    it('calls out the weeks that diverge from the schedule', async () => {
        // The only ones worth a manager's attention — the rest are the rule.
        render(<SabhaCalendar />);

        expect(screen.getByRole('button', { name: /Sep 11.*edited/i })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Sep 4.*edited/i })).toBeNull();
    });

    it('shows no chips at all when there is only the one date', async () => {
        upcoming = [week('2026-08-28')];
        render(<SabhaCalendar />);

        expect(screen.getByText('Friday, Aug 28')).toBeTruthy();
        expect(screen.queryByText(/tap a date/i)).toBeNull();
    });
});

describe('editing and cancelling act on the week on screen', () => {
    it('edits the selected week, not the next one', async () => {
        // The way a card can be wrong that a list cannot: the buttons are shared,
        // so they have to follow the selection.
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /Sep 25/ }));
        await userEvent.click(screen.getByRole('button', { name: /edit this week/i }));
        await userEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence.mock.calls[0][0]).toBe('2026-09-25');
    });

    it('cancels the selected week, not the next one', async () => {
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /Oct 2/ }));
        await userEvent.click(screen.getByRole('button', { name: /cancel this week/i }));

        await waitFor(() => expect(previewDeleteSabhaEvent).toHaveBeenCalledWith('2026-10-02'));
    });

    it('re-seeds the edit fields when the week changes', async () => {
        // 11 Sep was moved to 19:00. Carrying 20:30 over from the previous
        // selection would silently rewrite that week back to the rule time.
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /Sep 11/ }));
        await userEvent.click(screen.getByRole('button', { name: /edit this week/i }));

        const times = screen.getAllByDisplayValue('19:00');
        expect(times.length).toBeGreaterThan(0);
    });

    it('carries the source through, so a one-off stays a one-off', async () => {
        upcoming = [week('2026-08-25', { source: 'one-off' }), week('2026-08-28')];
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /edit this week/i }));
        await userEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence.mock.calls[0][3]).toBe('one-off');
    });
});

describe('the message worth never losing', () => {
    it('still says rides are closed when nothing is scheduled', async () => {
        calendarStatus = 'no-scheduled-event';
        upcoming = [];
        render(<SabhaCalendar />);

        expect(screen.getByText(/Rides are closed/)).toBeTruthy();
        expect(screen.getByText(/nobody can request a ride/)).toBeTruthy();
    });

    it('still invites a date when the list is empty', async () => {
        upcoming = [];
        render(<SabhaCalendar />);

        expect(screen.getByText(/No sabhas scheduled/)).toBeTruthy();
    });

    it('shows the standing schedule in words', async () => {
        render(<SabhaCalendar />);

        expect(screen.getByText(/Every Friday/)).toBeTruthy();
    });
});
