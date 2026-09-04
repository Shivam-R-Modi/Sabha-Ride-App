/**
 * Two cards: the weekly sabha, and the extra ones.
 *
 * The calendar once rendered up to twelve dated rows, each with the same times,
 * the same derived ride window and its own delete button; that became one card
 * plus a row of date chips. The chips are gone too, because a sabha ADDED
 * alongside the weekly one appeared among them as though it were part of the
 * pattern — an added Saturday sitting between two Mondays.
 *
 * What these tests hold onto:
 *
 *   - an added sabha renders in its own card, and an EDITED week does not — an
 *     override is this week with its time or venue changed, not an extra event;
 *   - whichever gathering is genuinely soonest is the one called "Next sabha",
 *     since an extra one can fall before the next weekly one;
 *   - Edit and Cancel now repeat across cards, so each must act on the gathering
 *     in ITS card — the way two cards can be wrong that one could not;
 *   - a one-off stays a one-off through an edit. Writing `override` instead makes
 *     it inert off the weekly pattern, which silently removed the gathering;
 *   - the closed-calendar warning still fires, because that is the one message on
 *     this screen whose absence a congregation notices.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const editOccurrence = vi.fn(
    async (..._a: any[]) => undefined);
const previewDeleteSabhaEvent = vi.fn(async (..._a: any[]) => ({
    responseCount: 0, requestedRideCount: 0, locationId: null as string | null,
    locationName: null as string | null,
}));
const deleteSabhaEvent = vi.fn(async (..._a: any[]) => ({ success: true }));
/**
 * The confirmation, hoisted rather than created per render.
 *
 * The dialog's markup is useConfirm's own business and has its own tests. What belongs
 * here is the TEXT this screen composes, because that text is what a manager reads
 * before cancelling something — so it is asserted against the options handed to `ask`.
 */
const ask = vi.fn(async (_options: any) => true);

let calendarStatus: 'ok' | 'no-scheduled-event' = 'ok';
/** The halls open for business. One is production today; two is the feature. */
let openHalls: Array<{ id: string; name: string }> = [];
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
    editOccurrence: (...a: unknown[]) => editOccurrence(...a),
    createOneOff: vi.fn(async () => undefined),
}));
vi.mock('../../hooks/useCurrentEvent', () => ({
    useCurrentEvent: () => ({ calendarStatus }),
}));
// Left unmocked this runs a real Firestore subscription against the stub `db: {}`,
// which throws inside collection() and fails every test in the file.
vi.mock('../../hooks/useLocations', () => ({
    useLocations: () => ({
        locations: openHalls, active: openHalls, loading: false, error: null,
        updateLocationVenue: vi.fn(),
    }),
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
    useConfirm: () => ({ ask: (o: any) => ask(o), confirmDialog: null }),
}));

import { SabhaCalendar } from '../../components/manager/SabhaCalendar';

/** A week as the rule produces it, unless a test says otherwise. */
const week = (date: string, over: Record<string, unknown> = {}) => ({
    id: date, date, startTime: '20:30', endTime: '22:00',
    venue: null, agenda: '', source: 'rule',
    // What each hall says on top of this evening. Empty is the ordinary case — every
    // hall takes the evening as it stands — and it is what a single-hall project
    // always has. `useUpcomingEvents` always sets this, so it is not optional here
    // either: a fixture without it is a fixture of a shape the hook cannot produce.
    hallOverrides: {},
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    calendarStatus = 'ok';
    openHalls = [];
    ask.mockResolvedValue(true);
    previewDeleteSabhaEvent.mockResolvedValue({
        responseCount: 0, requestedRideCount: 0, locationId: null, locationName: null,
    });
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

describe('the weekly sabha and the extra ones are kept apart', () => {
    /**
     * The reported bug: an added Saturday appeared in the chip row between two
     * Mondays, reading as part of the weekly pattern. It is a separate event, and
     * now it is a separate card.
     */
    const oneOff = (date: string) => week(date, { source: 'one-off' });

    it('puts an added sabha in the extra card, not the weekly one', async () => {
        // The one-off is SOONEST here on purpose. With it second, dropping the
        // filter altogether still leaves the weekly card showing the right date by
        // luck, and this case would pass over the bug it is named for.
        upcoming = [oneOff('2026-08-26'), week('2026-08-28')];
        render(<SabhaCalendar />);

        const weekly = within(screen.getByRole('region', { name: 'Sabha calendar' }));
        const extra = within(screen.getByRole('region', { name: 'Extra sabhas' }));

        expect(weekly.getByText('Friday, Aug 28')).toBeTruthy();
        expect(weekly.queryByText('Wednesday, Aug 26')).toBeNull();
        expect(extra.getByText('Wednesday, Aug 26')).toBeTruthy();
        expect(extra.queryByText('Friday, Aug 28')).toBeNull();
    });

    it('keeps an EDITED week on the weekly side — it is this week, not an extra one', async () => {
        // An override is the weekly sabha with its time or venue changed. Moving it
        // out would tell a manager their schedule had grown an event it has not.
        upcoming = [week('2026-08-28', { source: 'override', startTime: '19:00' })];
        render(<SabhaCalendar />);

        const weekly = within(screen.getByRole('region', { name: 'Sabha calendar' }));
        expect(weekly.getByText('Friday, Aug 28')).toBeTruthy();
        expect(weekly.getByText('Edited')).toBeTruthy();
        expect(within(screen.getByRole('region', { name: 'Extra sabhas' }))
            .queryByText('Friday, Aug 28')).toBeNull();
    });

    it('shows one weekly sabha, not the whole pattern back', async () => {
        render(<SabhaCalendar />);

        // Six weeks are upcoming; only the first is drawn, and there are no chips.
        expect(screen.getByText('Friday, Aug 28')).toBeTruthy();
        for (const later of ['Friday, Sep 4', 'Friday, Sep 11', 'Friday, Oct 2']) {
            expect(screen.queryByText(later)).toBeNull();
        }
        expect(screen.queryByText(/tap a date/i)).toBeNull();
    });

    it('offers the add form even when there are no extra sabhas', async () => {
        upcoming = [week('2026-08-28')];
        render(<SabhaCalendar />);

        const extra = within(screen.getByRole('region', { name: 'Extra sabhas' }));
        expect(extra.getByRole('button', { name: /add a sabha/i })).toBeTruthy();
        expect(extra.getByText(/none coming up/i)).toBeTruthy();
    });

    it('gives "Next sabha" to whichever is genuinely soonest', async () => {
        // An extra sabha can fall before the next weekly one. The weekly card
        // headlining "Next sabha" over a later date would be quietly wrong.
        upcoming = [oneOff('2026-08-26'), week('2026-08-28')];
        render(<SabhaCalendar />);

        const weekly = within(screen.getByRole('region', { name: 'Sabha calendar' }));
        const extra = within(screen.getByRole('region', { name: 'Extra sabhas' }));

        expect(extra.getByText('Next sabha')).toBeTruthy();
        expect(weekly.getByText('Next weekly sabha')).toBeTruthy();
        expect(weekly.queryByText('Next sabha')).toBeNull();
    });
});

describe('editing and cancelling act on the card they sit in', () => {
    it('edits the weekly sabha from the weekly card', async () => {
        upcoming = [week('2026-08-28'), week('2026-08-29', { source: 'one-off' })];
        render(<SabhaCalendar />);

        const weekly = within(screen.getByRole('region', { name: 'Sabha calendar' }));
        await userEvent.click(weekly.getByRole('button', { name: /edit this week/i }));
        await userEvent.click(weekly.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence.mock.calls[0][0]).toBe('2026-08-28');
    });

    it('edits an extra sabha from its own card, without touching the weekly one', async () => {
        upcoming = [week('2026-08-28'), week('2026-08-29', { source: 'one-off' })];
        render(<SabhaCalendar />);

        const extra = within(screen.getByRole('region', { name: 'Extra sabhas' }));
        await userEvent.click(extra.getByRole('button', { name: /edit this week/i }));
        await userEvent.click(extra.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence).toHaveBeenCalledTimes(1);
        expect(editOccurrence.mock.calls[0][0]).toBe('2026-08-29');
    });

    it('carries the source through, so a one-off stays a one-off', async () => {
        // Writing `override` for a one-off makes it inert off the weekly pattern,
        // which silently removed the gathering. The regression this names.
        upcoming = [week('2026-08-25', { source: 'one-off' }), week('2026-08-28')];
        render(<SabhaCalendar />);

        const extra = within(screen.getByRole('region', { name: 'Extra sabhas' }));
        await userEvent.click(extra.getByRole('button', { name: /edit this week/i }));
        await userEvent.click(extra.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence.mock.calls[0][3]).toBe('one-off');
    });

    it('seeds the edit fields from the week actually on screen', async () => {
        // 28 Aug was moved to 19:00. Seeding from the rule instead would silently
        // rewrite that week back to the schedule time on the next save.
        upcoming = [week('2026-08-28', { source: 'override', startTime: '19:00' })];
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /edit this week/i }));

        expect(screen.getAllByDisplayValue('19:00').length).toBeGreaterThan(0);
    });

    it('cancels the weekly sabha on screen', async () => {
        render(<SabhaCalendar />);

        await userEvent.click(screen.getByRole('button', { name: /cancel this week/i }));

        await waitFor(() => expect(previewDeleteSabhaEvent).toHaveBeenCalledWith('2026-08-28', null));
    });

    it('cancels an extra sabha from its own card', async () => {
        upcoming = [week('2026-08-28'), week('2026-08-29', { source: 'one-off' })];
        render(<SabhaCalendar />);

        const extra = within(screen.getByRole('region', { name: 'Extra sabhas' }));
        await userEvent.click(extra.getByRole('button', { name: /cancel this week/i }));

        await waitFor(() => expect(previewDeleteSabhaEvent).toHaveBeenCalledWith('2026-08-29', null));
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

/**
 * Cancelling ONE HALL of an evening.
 *
 * The dangerous mistake is not failing to offer the choice — it is offering a button
 * whose label does not match what it cancels. So each case here pins the label to the
 * argument, and the single-hall case pins that nothing changed at all.
 */
describe('SabhaCalendar — cancelling one hall', () => {
    const TWO = [
        { id: 'boston-huntington', name: 'Huntington Ave' },
        { id: 'somerville', name: 'Elm Street' },
    ];

    it('draws the one button it always drew when a single hall is open', async () => {
        // Production today. A per-hall button here would be a choice with one option,
        // and a hall name on a screen that has never had one.
        openHalls = [{ id: 'boston-huntington', name: 'Huntington Ave' }];
        render(<SabhaCalendar />);

        expect(await screen.findAllByRole('button', { name: /Cancel this week/ }))
            .not.toHaveLength(0);
        expect(screen.queryByRole('button', { name: /Cancel Huntington/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /whole evening/ })).toBeNull();
    });

    it('offers one button per hall plus the whole evening', async () => {
        openHalls = TWO;
        render(<SabhaCalendar />);

        expect(await screen.findAllByRole('button', { name: /Cancel Huntington Ave/ }))
            .not.toHaveLength(0);
        expect(screen.getAllByRole('button', { name: /Cancel Elm Street/ })).not.toHaveLength(0);
        expect(screen.getAllByRole('button', { name: /Cancel the whole evening/ })).not.toHaveLength(0);
        // And the ambiguous one is gone, because with two halls "this week" does not
        // say which room.
        expect(screen.queryByRole('button', { name: /Cancel this week/ })).toBeNull();
    });

    it('sends the HALL the button names, not the first one', async () => {
        openHalls = TWO;
        render(<SabhaCalendar />);

        const button = (await screen.findAllByRole('button', { name: /Cancel Elm Street/ }))[0];
        await userEvent.click(button);

        await waitFor(() => expect(previewDeleteSabhaEvent).toHaveBeenCalled());
        expect(previewDeleteSabhaEvent.mock.calls[0][1]).toBe('somerville');
    });

    it('sends null for the whole evening', async () => {
        openHalls = TWO;
        render(<SabhaCalendar />);

        const button = (await screen.findAllByRole('button', { name: /Cancel the whole evening/ }))[0];
        await userEvent.click(button);

        await waitFor(() => expect(previewDeleteSabhaEvent).toHaveBeenCalled());
        expect(previewDeleteSabhaEvent.mock.calls[0][1]).toBeNull();
    });

    it('NAMES THE HALL in the confirmation, from the server\'s answer', async () => {
        // From the preview, not from this component's own idea of what it sent. A
        // dialog that says "the sabha at Elm Street" over a request the server read as
        // the whole evening is how somebody cancels both rooms believing they cancelled
        // one.
        openHalls = TWO;
        previewDeleteSabhaEvent.mockResolvedValue({
            responseCount: 0, requestedRideCount: 0,
            locationId: 'somerville', locationName: 'Elm Street',
        });
        render(<SabhaCalendar />);

        await userEvent.click((await screen.findAllByRole('button', { name: /Cancel Elm Street/ }))[0]);

        await waitFor(() => expect(ask).toHaveBeenCalled());
        expect(ask.mock.calls[0][0].message).toContain('This cancels the sabha at Elm Street');
        expect(ask.mock.calls[0][0].confirmLabel).toBe('Cancel this sabha');
    });

    it('says the whole evening when that is what it is', async () => {
        openHalls = TWO;
        render(<SabhaCalendar />);

        await userEvent.click((await screen.findAllByRole('button', { name: /Cancel the whole evening/ }))[0]);

        await waitFor(() => expect(ask).toHaveBeenCalled());
        expect(ask.mock.calls[0][0].message).toContain('This cancels the whole evening');
        expect(ask.mock.calls[0][0].confirmLabel).toBe('Cancel the evening');
    });

    it('passes the hall through to the real deletion, not just the preview', async () => {
        // The preview taking the hall and the deletion not is a silent widening: the
        // manager reads "the sabha at Elm Street" and both rooms get cancelled.
        openHalls = TWO;
        previewDeleteSabhaEvent.mockResolvedValue({
            responseCount: 0, requestedRideCount: 0,
            locationId: 'somerville', locationName: 'Elm Street',
        });
        render(<SabhaCalendar />);

        await userEvent.click((await screen.findAllByRole('button', { name: /Cancel Elm Street/ }))[0]);

        await waitFor(() => expect(deleteSabhaEvent).toHaveBeenCalled());
        expect(deleteSabhaEvent.mock.calls[0][2]).toBe('somerville');
    });

    it('cancels nothing when the manager backs out', async () => {
        openHalls = TWO;
        ask.mockResolvedValue(false);
        render(<SabhaCalendar />);

        await userEvent.click((await screen.findAllByRole('button', { name: /Cancel Elm Street/ }))[0]);

        await waitFor(() => expect(ask).toHaveBeenCalled());
        expect(deleteSabhaEvent).not.toHaveBeenCalled();
    });
});

/**
 * Changing ONE HALL's time, and seeing that it changed.
 *
 * These belong together because either half alone is a defect. An edit the row cannot
 * show is a write-only control: the manager saves a time, the row keeps showing the
 * evening's, and nothing says whether it worked or how to undo it. A row that shows a
 * divergence with no way to edit it is the mirror.
 */
describe('SabhaCalendar — one hall diverging', () => {
    const TWO = [
        { id: 'boston-huntington', name: 'Huntington Ave' },
        { id: 'somerville', name: 'Elm Street' },
    ];
    /** One evening, with Elm Street an hour and a half earlier. */
    const diverged = () => [week('2026-08-28', {
        hallOverrides: {
            somerville: {
                date: '2026-08-28', startTime: '19:00', endTime: '21:00',
                venue: null, agenda: '', source: 'hall-override',
            },
        },
    })];

    it('lists every open hall with its own times', async () => {
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        // The evening's own times appear TWICE — once as the evening's, once as
        // Huntington's, which is on them. Elm Street's appear once.
        expect(await screen.findAllByText(/8:30 PM – 10:00 PM/)).toHaveLength(2);
        expect(screen.getAllByText(/7:00 PM – 9:00 PM/)).toHaveLength(1);
    });

    it('shows a hall on the evening\'s times with no "Changed" badge', async () => {
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await screen.findByText('Huntington Ave');
        // One badge, for the one hall that has a document of its own.
        expect(screen.getAllByText('Changed')).toHaveLength(1);
    });

    it('draws a CANCELLED hall as cancelled, with no Edit button', async () => {
        // `null` is a real entry meaning "not this hall tonight". Falling back to the
        // evening for it would quietly reopen a room the manager had shut.
        openHalls = TWO;
        upcoming = [week('2026-08-28', { hallOverrides: { somerville: null } })];
        render(<SabhaCalendar />);

        expect(await screen.findByText('Cancelled')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Edit Elm Street/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Edit Huntington Ave/ })).toBeTruthy();
    });

    it('shows no hall list at all when one hall is open', async () => {
        openHalls = [{ id: 'boston-huntington', name: 'Huntington Ave' }];
        upcoming = [week('2026-08-28')];
        render(<SabhaCalendar />);

        await screen.findByRole('button', { name: /Edit this week/ });
        expect(screen.queryByText('Huntington Ave')).toBeNull();
    });

    it('SEEDS the editor from the hall being edited, not the evening', async () => {
        // Two identical-looking forms writing different documents. Seeded from the
        // evening, saving Elm Street would silently move it back to 8:30.
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await userEvent.click(await screen.findByRole('button', { name: /Edit Elm Street/ }));

        const times = screen.getAllByDisplayValue('19:00');
        expect(times).not.toHaveLength(0);
    });

    it('names the scope on the open editor', async () => {
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await userEvent.click(await screen.findByRole('button', { name: /Edit Elm Street/ }));
        expect(screen.getByText('Editing Elm Street')).toBeTruthy();
    });

    it('names the evening when that is the scope', async () => {
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await userEvent.click(await screen.findByRole('button', { name: /Edit this week/ }));
        expect(screen.getByText('Editing the whole evening')).toBeTruthy();
    });

    it('SAVES AGAINST THE HALL, not the evening', async () => {
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await userEvent.click(await screen.findByRole('button', { name: /Edit Elm Street/ }));
        await userEvent.click(screen.getByRole('button', { name: /Save/ }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence.mock.calls[0][4]).toBe('somerville');
    });

    it('saves against the evening when that is the scope', async () => {
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await userEvent.click(await screen.findByRole('button', { name: /Edit this week/ }));
        await userEvent.click(screen.getByRole('button', { name: /Save/ }));

        await waitFor(() => expect(editOccurrence).toHaveBeenCalled());
        expect(editOccurrence.mock.calls[0][4]).toBeNull();
    });

    it('reseeds when the manager switches from a hall to the evening', async () => {
        // The reason the scope is one tri-state and not a boolean plus an id: a form
        // left holding the previous scope's values writes them to the new one.
        openHalls = TWO;
        upcoming = diverged();
        render(<SabhaCalendar />);

        await userEvent.click(await screen.findByRole('button', { name: /Edit Elm Street/ }));
        await userEvent.click(screen.getByRole('button', { name: /Discard/ }));
        await userEvent.click(await screen.findByRole('button', { name: /Edit this week/ }));

        expect(screen.getAllByDisplayValue('20:30')).not.toHaveLength(0);
        expect(screen.queryByDisplayValue('19:00')).toBeNull();
    });
});
