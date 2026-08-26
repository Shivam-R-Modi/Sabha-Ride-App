/**
 * The arrivals month grid — the screen the whole service is browsed through, and it had
 * NO TESTS AT ALL until the 2026-08-25 redesign rewrote most of it.
 *
 * `tests/setup.ts` forbids class-name assertions here ("assert on TEXT, ROLES and
 * BEHAVIOUR, never on class names"), which is right and also shapes this file: the
 * redesign was largely visual, so almost everything below is asserted through the
 * ACCESSIBLE NAME of each day. That turns out to be the better test anyway — the label
 * is what a screen reader says and what a colour-blind user relies on, so pinning it
 * pins the meaning rather than the paint. The one thing that genuinely is a class-level
 * invariant — never `text-white` on `bg-saffron` — lives in tests/quality/theme-tokens.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is "today survives being selected". The shipped
 * code applied the today marker as `key === today && !isSelected`, so selecting today
 * DELETED it, on the one day it matters. Nothing caught that for as long as it existed.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../firebase/config', () => ({ db: {}, auth: {}, app: {} }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask: vi.fn(async () => true), confirmDialog: null }),
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    updateAirportPickup: vi.fn(async () => ({ success: true, status: 'claimed' as const })),
}));
vi.mock('../../hooks/useUsers', () => ({
    useAvailableDrivers: () => ({ drivers: [], loading: false }),
}));

/**
 * jsdom has no PushManager, so the real hook reports 'unsupported' and `PushPrompt`
 * correctly renders nothing — which would make the assertions below pass for the wrong
 * reason if they were written against absence. Forced to 'off' so the offer is actually
 * on screen and its WORDING can be checked.
 */
vi.mock('../../hooks/usePush', () => ({
    usePush: () => ({
        availability: 'off', busy: false, error: null,
        enable: vi.fn(), disable: vi.fn(),
    }),
}));


let profile: Record<string, unknown> = {
    name: 'Kiran', role: 'driver', roles: ['driver', 'student'], accountStatus: 'approved',
};
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'sarthi_1' }, userProfile: profile }),
}));

/** What the board's one query returns. Set per test. */
let feed: { arrivals: unknown[]; loading: boolean; error: string | null } = {
    arrivals: [], loading: false, error: null,
};
vi.mock('../../hooks/useArrivals', () => ({
    useArrivalsBetween: () => feed,
}));

import { ArrivalBoard } from '../../components/airport/ArrivalBoard';

/**
 * A fixed "now" so the grid, `todayKey()` and the past/future split are all deterministic.
 * 2026-08-25 is a Tuesday, and August 2026 starts on a Saturday — so the leading pad is
 * six cells, which is the widest case and the one an off-by-one would show up in.
 */
const NOW = new Date('2026-08-25T12:00:00Z');
const TODAY = '2026-08-25';

const arrival = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    id,
    requesterUid: `rider_${id}`,
    requesterName: 'Ramesh',
    direction: 'arrival',
    arrivalDate: date,
    arrivalTime: '22:00',
    arrivalAt: `${date}T22:00:00.000Z`,
    airportCode: 'BOS',
    isInternational: true,
    partySize: 1,
    largeBags: 1,
    cabinBags: 1,
    hasUsWorkingPhone: true,
    passenger: {
        name: 'Ramesh Patel', dateOfBirth: '2007-04-11', phone: '+16175550123',
        whatsappOn: 'primary', email: 'r@example.com', familyContact: null,
    },
    status: 'open',
    retainUntil: '2033-01-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
});

const CLAIMED = { status: 'claimed', claimedByUid: 'other', claimedByName: 'Nilesh' };
const DONE = {
    status: 'completed', claimedByUid: 'other', claimedByName: 'Nilesh',
    completedAt: '2026-08-26T23:10:00.000Z',
};

const show = () => render(<ArrivalBoard />);

/** A day cell, by its accessible name's date part. */
const day = (n: number) => screen.getByRole('button', { name: new RegExp(`August ${n} —`) });
const nameOf = (n: number) => day(n).getAttribute('aria-label') ?? '';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    profile = { name: 'Kiran', role: 'driver', roles: ['driver', 'student'], accountStatus: 'approved' };
    feed = { arrivals: [], loading: false, error: null };
});

describe('the grid itself', () => {
    it('renders one button per day of the month and no more', () => {
        show();
        // August has 31. The leading pads are plain divs, so they must not be counted.
        const grid = document.querySelector('[aria-busy]') as HTMLElement;
        expect(within(grid).getAllByRole('button')).toHaveLength(31);
    });

    it('opens on today, and says so in two separate attributes', () => {
        show();
        // aria-current for "this is today", aria-pressed for "this is the one selected".
        // Two facts, two attributes — the whole point of the rebuild.
        expect(day(25)).toHaveAttribute('aria-current', 'date');
        expect(day(25)).toHaveAttribute('aria-pressed', 'true');
    });

    it('KEEPS the today marker while today is selected', () => {
        // THE REGRESSION GUARD. The shipped code wrote `key === today && !isSelected`,
        // so selecting today erased its marker. Selecting another day and coming back
        // must leave today marked throughout.
        show();
        expect(day(25)).toHaveAttribute('aria-current', 'date');
        expect(day(20)).not.toHaveAttribute('aria-current');
    });

    it('marks exactly one day as selected at a time', async () => {
        show();
        await userEvent.click(day(20));

        expect(day(20)).toHaveAttribute('aria-pressed', 'true');
        expect(day(25)).toHaveAttribute('aria-pressed', 'false');
        // ...and today is STILL today.
        expect(day(25)).toHaveAttribute('aria-current', 'date');
    });
});

describe('what a day announces', () => {
    it('says nobody is arriving when nothing is', () => {
        show();
        expect(nameOf(20)).toMatch(/nobody arriving/i);
    });

    it('names the count and how many still need somebody', () => {
        feed = { arrivals: [arrival('a', '2026-08-26'), arrival('b', '2026-08-26')], loading: false, error: null };
        show();
        expect(nameOf(26)).toMatch(/2 arriving, 2 still need a Sarthi/i);
    });

    it('gets the singular right, because "1 still need" reads as broken', () => {
        feed = { arrivals: [arrival('a', '2026-08-26')], loading: false, error: null };
        show();
        expect(nameOf(26)).toMatch(/1 arriving, 1 still needs a Sarthi/i);
    });

    it('says so when every arrival that day already has a Sarthi', () => {
        feed = { arrivals: [arrival('a', '2026-08-26', CLAIMED)], loading: false, error: null };
        show();
        expect(nameOf(26)).toMatch(/1 arriving, all with a Sarthi/i);
    });

    it('does not count a cancelled arrival', () => {
        // A withdrawn request is not a job and must not put a badge on the calendar.
        feed = {
            arrivals: [arrival('a', '2026-08-26', { status: 'cancelled' })],
            loading: false, error: null,
        };
        show();
        expect(nameOf(26)).toMatch(/nobody arriving/i);
    });

    /**
     * A COMPLETED TRIP IS NOT AN UPCOMING ONE — reported from production on
     * 2026-08-25, where the only pickup in the database had been dropped off hours
     * earlier and the calendar still announced "1 arriving, all with a Sarthi".
     *
     * Only `cancelled` was filtered. `completed` is the other half of the shared
     * TERMINAL list and was being counted as work, so a coordinator scanning the month
     * saw a green day that had, in fact, nothing left on it at all.
     */
    it('does not count a completed arrival as arriving', () => {
        feed = {
            arrivals: [arrival('a', '2026-08-26', { ...DONE })],
            loading: false, error: null,
        };
        show();
        expect(nameOf(26)).toMatch(/all dropped off/i);
        expect(nameOf(26)).not.toMatch(/arriving,/i);
    });

    it('counts only what is left on a day that is half done', () => {
        feed = {
            arrivals: [
                arrival('a', '2026-08-26', { ...DONE }),
                arrival('b', '2026-08-26'),
            ],
            loading: false, error: null,
        };
        show();
        // One arriving, not two — the finished one is a receipt, not a job.
        expect(nameOf(26)).toMatch(/1 arriving, 1 still needs a Sarthi/i);
    });
});

describe('the month summary', () => {
    it('counts the month and offers the next day that needs somebody', () => {
        feed = {
            arrivals: [arrival('a', '2026-08-26'), arrival('b', '2026-08-30')],
            loading: false, error: null,
        };
        show();
        expect(screen.getByRole('button', { name: /2 arrivals this month still need a Sarthi/i }))
            .toBeInTheDocument();
        expect(screen.getByText(/next Wed 26/)).toBeInTheDocument();
    });

    it('jumps to that day when tapped', async () => {
        feed = { arrivals: [arrival('a', '2026-08-30')], loading: false, error: null };
        show();
        // Matched on the summary's OWN wording. Scoping to the calendar card does not
        // disambiguate — the day cells are inside it and their labels end with the same
        // phrase ("Sunday, August 30 — 1 arriving, 1 still needs a Sarthi") — so the
        // summary line was given an explicit aria-label, which this pins.
        await userEvent.click(screen.getByRole('button', { name: /this month still needs a Sarthi/i }));

        expect(day(30)).toHaveAttribute('aria-pressed', 'true');
    });

    it('says everything is covered rather than going quiet', () => {
        // Reworded 2026-08-25: "All 1 arrival has a Sarthi" breaks at every number, and
        // "All 6 arrivals have" needs the verb to agree too. This shape has no agreement.
        feed = { arrivals: [arrival('a', '2026-08-26', CLAIMED)], loading: false, error: null };
        show();
        expect(screen.getByText(/1 arriving · everyone has a Sarthi/i)).toBeInTheDocument();
    });

    it('and reads the same way at any number', () => {
        feed = {
            arrivals: [arrival('a', '2026-08-26', CLAIMED), arrival('b', '2026-08-30', CLAIMED)],
            loading: false, error: null,
        };
        show();
        expect(screen.getByText(/2 arriving · everyone has a Sarthi/i)).toBeInTheDocument();
    });

    it('says the month is empty rather than showing a blank card', () => {
        show();
        expect(screen.getByText(/Nobody arriving in August 2026/i)).toBeInTheDocument();
    });

    /**
     * THE ±36h LEAK. The query is bounded on `arrivalAt` plus and minus 36 hours, so the
     * fetched array contains rows whose `arrivalDate` is in an ADJACENT month. Reducing
     * the summary over that array instead of over the visible month would claim an
     * unclaimed arrival that no cell shows.
     */
    it('ignores an arrival that belongs to the next month', () => {
        feed = {
            arrivals: [arrival('a', '2026-08-26'), arrival('spill', '2026-09-01')],
            loading: false, error: null,
        };
        show();

        expect(screen.getByRole('button', { name: /1 arrival this month still needs a Sarthi/i }))
            .toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /2 arrivals this month/i })).not.toBeInTheDocument();
    });
});

describe('the indicator above the date', () => {
    /**
     * The colour coding is asserted through the LABEL, not the class, because
     * tests/setup.ts forbids class assertions here — and because the label is what a
     * screen reader says and what somebody colour-blind relies on, so it is the better
     * thing to pin anyway. The class-level half (never `bg-cream-400`, the colour the
     * indicator used to vanish into) lives in tests/quality/theme-tokens.test.ts.
     */
    it('distinguishes a day that needs somebody from one that is covered', () => {
        feed = {
            arrivals: [arrival('a', '2026-08-26'), arrival('b', '2026-08-28', CLAIMED)],
            loading: false, error: null,
        };
        show();
        expect(nameOf(26)).toMatch(/still needs a Sarthi/i);
        expect(nameOf(28)).toMatch(/all with a Sarthi/i);
    });

    it('treats a MIXED day as still needing somebody', () => {
        // The rule worth pinning: one unassigned arrival among three assigned ones still
        // means a Sarthi is needed, so a mixed day must not read as covered.
        feed = {
            arrivals: [
                arrival('a', '2026-08-26', CLAIMED),
                arrival('b', '2026-08-26', CLAIMED),
                arrival('c', '2026-08-26'),
            ],
            loading: false, error: null,
        };
        show();
        expect(nameOf(26)).toMatch(/3 arriving, 1 still needs a Sarthi/i);
        expect(nameOf(26)).not.toMatch(/all with a Sarthi/i);
    });

    it('shows the count, so a busy day is not just "something here"', () => {
        feed = {
            arrivals: [arrival('a', '2026-08-26'), arrival('b', '2026-08-26'), arrival('c', '2026-08-26')],
            loading: false, error: null,
        };
        show();
        expect(within(day(26)).getByText('3')).toBeInTheDocument();
    });

    it('renders no indicator on an empty day', () => {
        feed = { arrivals: [arrival('a', '2026-08-26')], loading: false, error: null };
        show();
        // The row is reserved on every cell so the dates share a baseline, but it must
        // stay EMPTY — a reserved slot that quietly renders something is worse than none.
        expect(within(day(20)).queryByText(/\d/)).toHaveTextContent('20');
        expect(day(20).textContent?.trim()).toBe('20');
    });

    /**
     * THE THING JUST REMOVED. A per-cell time was a third stacked row that earned nothing
     * and vanished the moment a day had two arrivals, so the grid carried a row of
     * inconsistent information. Without this test it creeps back the next time somebody
     * wants "just a bit more" in the cell.
     */
    it('raises no indicator for a day whose only trip is finished', () => {
        // The badge is a workload indicator. A dropped-off passenger is not workload,
        // and a green "1" on that day sent a coordinator looking for a job that had
        // already been done.
        feed = { arrivals: [arrival('a', '2026-08-26', { ...DONE })], loading: false, error: null };
        show();
        expect(day(26).textContent?.trim()).toBe('26');
    });

    it('never puts a time in a day cell, not even on a single-arrival day', () => {
        feed = { arrivals: [arrival('a', '2026-08-26')], loading: false, error: null };
        show();
        expect(day(26).textContent).not.toMatch(/AM|PM/);
        expect(day(26).textContent?.trim()).toBe('126');
    });
});

describe('the day list below the grid', () => {
    it('lists the selected day and puts what needs somebody first', async () => {
        feed = {
            arrivals: [
                arrival('claimed', '2026-08-26', { ...CLAIMED, arrivalAt: '2026-08-26T10:00:00.000Z', arrivalTime: '10:00' }),
                arrival('open', '2026-08-26', { arrivalAt: '2026-08-26T22:00:00.000Z' }),
            ],
            loading: false, error: null,
        };
        show();
        await userEvent.click(day(26));

        const section = screen.getByRole('region', { name: /Arrivals on Wednesday, August 26/i });
        const headings = within(section).getAllByRole('heading', { level: 2 });
        // The unclaimed 22:00 outranks the claimed 10:00: only one of them is a job.
        expect(headings[1]!.textContent).toMatch(/10:00 PM/);
    });

    /**
     * STILL LISTED, deliberately. Filtering finished trips out of the list as well as
     * out of the counts would make a card vanish under the Sarthi's finger the instant
     * they tapped "Dropped off safely" — no confirmation, just a gap. So the count above
     * the list is about work remaining and the list itself is the receipt.
     */
    it('still lists a finished trip, under a heading that says it is done', async () => {
        feed = { arrivals: [arrival('a', '2026-08-26', { ...DONE })], loading: false, error: null };
        show();
        await userEvent.click(day(26));

        const section = screen.getByRole('region', { name: /Arrivals on Wednesday, August 26/i });
        expect(within(section).getByText(/1 arrival · all dropped off/i)).toBeInTheDocument();
        expect(within(section).getAllByRole('heading', { level: 2 })).toHaveLength(2);
    });

    it('sinks a finished trip below one that still needs driving', async () => {
        feed = {
            arrivals: [
                arrival('done', '2026-08-26', { ...DONE, arrivalAt: '2026-08-26T02:00:00.000Z', arrivalTime: '02:00' }),
                arrival('live', '2026-08-26', { ...CLAIMED, arrivalAt: '2026-08-26T22:00:00.000Z', arrivalTime: '22:00' }),
            ],
            loading: false, error: null,
        };
        show();
        await userEvent.click(day(26));

        const section = screen.getByRole('region', { name: /Arrivals on Wednesday, August 26/i });
        const headings = within(section).getAllByRole('heading', { level: 2 });
        // The 22:00 that still needs driving beats the 02:00 that is already delivered,
        // even though it is later in the day.
        expect(headings[1]!.textContent).toMatch(/10:00 PM/);
    });

    it('says nobody is arriving rather than rendering an empty space', () => {
        show();
        expect(screen.getByText(/Nobody is arriving on this day/i)).toBeInTheDocument();
    });

    /**
     * The blank-area regression. `step()` used to clear the selection, so paging a month
     * emptied everything under the grid — a screen asked for a month that answered with
     * nothing.
     */
    it('still names a day after paging to another month', async () => {
        show();
        await userEvent.click(screen.getByRole('button', { name: /next month/i }));

        expect(screen.getByRole('heading', { name: /September 2026/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /Arrivals on .*September/i })).toBeInTheDocument();
    });

    it('lands on the first day that needs somebody when paging', async () => {
        feed = { arrivals: [arrival('a', '2026-09-11')], loading: false, error: null };
        show();
        await userEvent.click(screen.getByRole('button', { name: /next month/i }));

        expect(screen.getByRole('region', { name: /Friday, September 11/i })).toBeInTheDocument();
    });
});

describe('the strip of days still needing a Sarthi', () => {
    it('is not rendered when nothing needs anybody', () => {
        feed = { arrivals: [arrival('a', '2026-08-26', CLAIMED)], loading: false, error: null };
        show();
        expect(screen.queryByRole('region', { name: /still needing a Sarthi/i })).not.toBeInTheDocument();
    });

    it('offers each day as a BUTTON, not an inert line', async () => {
        // The old strip was a list of <li>s printing a raw ISO date and a raw 24-hour
        // time: it told a Sarthi what needed doing and gave them no way to act on it.
        feed = { arrivals: [arrival('a', '2026-08-30')], loading: false, error: null };
        show();

        const strip = screen.getByRole('region', { name: /still needing a Sarthi/i });
        const row = within(strip).getByRole('button');
        expect(row.textContent).toMatch(/Sun 30/);
        // Times go through formatTime, like every other airport surface.
        expect(row.textContent).toMatch(/10:00 PM/);
        // And it announces itself as a sentence, not as "1Sun 3010:00 PM · BOS".
        expect(row).toHaveAccessibleName(/Sun 30: 1 still needs a Sarthi\. First at 10:00 PM from BOS/);

        await userEvent.click(row);
        expect(day(30)).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('keyboard navigation', () => {
    it('gives only the selected day a tab stop, so the grid is one stop and not 31', () => {
        show();
        expect(day(25).tabIndex).toBe(0);
        expect(day(24).tabIndex).toBe(-1);
        expect(day(26).tabIndex).toBe(-1);
    });

    it('moves a day at a time with the left and right arrows', async () => {
        show();
        day(25).focus();

        await userEvent.keyboard('{ArrowRight}');
        expect(day(26)).toHaveAttribute('aria-pressed', 'true');

        await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
        expect(day(24)).toHaveAttribute('aria-pressed', 'true');
    });

    it('moves a week at a time with up and down', async () => {
        // Starting from the 10th, not today: 25 + 7 is the 32nd, which August does not
        // have, so that would be testing the clamp rather than the week jump.
        show();
        await userEvent.click(day(10));

        await userEvent.keyboard('{ArrowDown}');
        expect(day(17)).toHaveAttribute('aria-pressed', 'true');

        await userEvent.keyboard('{ArrowUp}{ArrowUp}');
        expect(day(3)).toHaveAttribute('aria-pressed', 'true');
    });

    it('clamps at the month edges instead of silently paging', async () => {
        // Spilling into the next month means changing the cursor and then chasing focus
        // into a subtree that has not rendered. PageUp/PageDown do that job explicitly.
        show();
        day(25).focus();
        await userEvent.keyboard('{Home}');
        expect(day(1)).toHaveAttribute('aria-pressed', 'true');

        await userEvent.keyboard('{ArrowLeft}');
        expect(day(1)).toHaveAttribute('aria-pressed', 'true');

        await userEvent.keyboard('{End}');
        expect(day(31)).toHaveAttribute('aria-pressed', 'true');

        await userEvent.keyboard('{ArrowRight}');
        expect(day(31)).toHaveAttribute('aria-pressed', 'true');
    });

    it('changes month with PageDown and PageUp', async () => {
        show();
        day(25).focus();

        await userEvent.keyboard('{PageDown}');
        expect(screen.getByRole('heading', { name: /September 2026/i })).toBeInTheDocument();

        await userEvent.keyboard('{PageUp}');
        expect(screen.getByRole('heading', { name: /August 2026/i })).toBeInTheDocument();
    });

    it('moves focus with the selection, not just the highlight', async () => {
        // Without this the arrow keys would move a visual marker while the real focus
        // stayed behind, and the next Tab would jump somewhere unrelated.
        show();
        day(25).focus();
        await userEvent.keyboard('{ArrowRight}');

        expect(document.activeElement).toBe(day(26));
    });
});

describe('when the read fails', () => {
    it('says so out loud AND still renders the grid', () => {
        // A board that silently shows nothing when the read failed is the defect this
        // repo keeps removing: a Sarthi reads "nobody is landing" while three people
        // wait at a barrier. The calendar must stay, so the failure is legible as a
        // failure rather than as an empty month.
        feed = { arrivals: [], loading: false, error: 'The arrivals board could not be loaded.' };
        show();

        expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
        expect(screen.getByRole('region', { name: /Arrivals calendar/i })).toBeInTheDocument();
        expect(day(25)).toBeInTheDocument();
    });
});

describe('while loading', () => {
    it('keeps the grid and the date, and marks the grid busy', () => {
        // The dates are correct before the query resolves, so hiding them would conceal
        // known information to disguise unknown information.
        feed = { arrivals: [], loading: true, error: null };
        show();

        expect(day(25)).toBeInTheDocument();
        expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(screen.getByRole('heading', { name: /Tuesday, August 25/i })).toBeInTheDocument();
    });
});

/**
 * THE SARTHI SIDE OF THE SAME GAP. The board never offered notifications, so every
 * `notifyArrivalChanged` and every unclaimed-arrival alert the server sent had nobody
 * to reach.
 */
describe('the offer to turn notifications on', () => {
    it('is made on the board', () => {
        show();
        expect(screen.getByText(/when an airport pickup needs you/i)).toBeInTheDocument();
    });

    it('promises a coordinator the unclaimed sweep as well', () => {
        profile = {
            name: 'Tonny', role: 'manager', roles: ['manager', 'driver', 'student'],
            accountStatus: 'approved', airportCoordinator: true,
        };
        show();
        expect(screen.getByText(/still has nobody/i)).toBeInTheDocument();
    });

    it('does NOT promise it to a plain Sarthi, who will not receive it', () => {
        // The unclaimed sweep goes to coordinators only. Promising it to everybody
        // would be a notification that never arrives for most of them.
        show();
        expect(screen.queryByText(/still has nobody/i)).not.toBeInTheDocument();
        expect(screen.getByText(/if something changes on a pickup you are collecting/i))
            .toBeInTheDocument();
    });
});
