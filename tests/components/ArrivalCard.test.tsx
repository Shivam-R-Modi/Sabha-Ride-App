/**
 * One arrival, as a Sarthi sees it.
 *
 * THREE ASSERTIONS EARN THIS FILE:
 *
 *  - **a collapsed card does not publish the traveller.** The row carries logistics;
 *    the date of birth and the home address only exist in the DOM once somebody
 *    opens it. `Disclosure` unmounts its panel rather than hiding it, and that is
 *    what makes "collapsed" mean collapsed rather than "scrolled past".
 *  - **no WhatsApp button without a number to send to.** A wa.me link with no number
 *    opens WhatsApp on a blank contact picker, the Sarthi believes the family was
 *    told, and nobody was.
 *  - **the buttons come from the shared transition table.** Not from a hand-written
 *    condition per status. A control that renders is one the server will accept.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const update = vi.fn(async () => ({ success: true, status: 'claimed' as const }));
vi.mock('../../src/utils/cloudFunctions', () => ({
    updateAirportPickup: (...a: unknown[]) => update(...(a as [])),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }));

const ask = vi.fn(async () => true);
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask, confirmDialog: null }),
}));

// Mocked because `useAvailableDrivers` reaches `firebase/config`, which calls
// getAuth() at import time — and this worktree has no .env.local, so importing it
// throws auth/invalid-api-key before a single test runs.
let sarthis: Array<{ id: string; name: string; capacity?: number }> = [
    { id: 'sarthi_1', name: 'Kiran', capacity: 5 },
    { id: 'sarthi_2', name: 'Nilesh', capacity: 7 },
];
vi.mock('../../hooks/useUsers', () => ({
    useAvailableDrivers: () => ({ drivers: sarthis, loading: false }),
}));

/**
 * `activeRole` is the hat currently worn, not the capability held — the claim button
 * is gated on it, so it belongs in this mock. Default 'driver', because most of this
 * file is about a Sarthi doing Sarthi things.
 */
let viewer: { uid: string; name: string; activeRole: string | null } =
    { uid: 'sarthi_1', name: 'Kiran', activeRole: 'driver' };
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: viewer.uid },
        userProfile: { name: viewer.name },
        activeRole: viewer.activeRole,
    }),
}));

import { ArrivalCard } from '../../components/airport/ArrivalCard';
import type { AirportPickup } from '../../types';

const BASE: AirportPickup = {
    id: 'p1',
    requesterUid: 'rider_1',
    requesterName: 'Ramesh',
    direction: 'arrival',
    arrivalDate: '2026-09-20',
    arrivalTime: '22:00',
    arrivalAt: '2026-09-21T02:00:00.000Z',
    airportCode: 'BOS',
    airline: 'Emirates',
    flightNumber: 'EK237',
    terminal: 'E',
    isInternational: true,
    partySize: 2,
    largeBags: 4,
    cabinBags: 2,
    dropoffAddress: '360 Huntington Ave, Boston, MA',
    dropoffLat: 42.34,
    dropoffLng: -71.09,
    hasUsWorkingPhone: false,
    meetingPointNote: 'By the exit doors',
    passenger: {
        name: 'Ramesh Patel',
        dateOfBirth: '2007-04-11',
        phone: '+16175550123',
        whatsappOn: 'primary',
        email: 'ramesh@example.com',
        familyContact: {
            name: 'Bhavna Patel', relationship: 'Mother',
            phone: '+919876543210', hasWhatsapp: true,
        },
    },
    status: 'open',
    retainUntil: '2033-09-21T02:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
};

const show = (over: Partial<AirportPickup> = {}, isCoordinator = false) => {
    const result = render(
        <ArrivalCard
            arrival={{ ...BASE, ...over }}
            isCoordinator={isCoordinator}
            open={false}
            onToggle={() => undefined}
        />,
    );
    return result;
};

/** Re-renders with the panel open, which is how the caller owns `open`. */
const showOpen = (over: Partial<AirportPickup> = {}, isCoordinator = false) => render(
    <ArrivalCard
        arrival={{ ...BASE, ...over }}
        isCoordinator={isCoordinator}
        open
        onToggle={() => undefined}
    />,
);

const buttonNames = () =>
    screen.getAllByRole('button').map(b => (b.textContent ?? '').trim()).filter(Boolean);

beforeEach(() => {
    vi.clearAllMocks();
    viewer = { uid: 'sarthi_1', name: 'Kiran', activeRole: 'driver' };
    sarthis = [
        { id: 'sarthi_1', name: 'Kiran', capacity: 5 },
        { id: 'sarthi_2', name: 'Nilesh', capacity: 7 },
    ];
});

describe('a collapsed card', () => {
    it('shows the logistics that answer "could I do this one"', () => {
        show();
        expect(screen.getByText(/BOS/)).toBeInTheDocument();
        expect(screen.getByText(/Terminal E/)).toBeInTheDocument();
        expect(screen.getByText(/2 people/)).toBeInTheDocument();
        expect(screen.getByText(/6 bags/)).toBeInTheDocument();
    });

    it('says who has it, or that nobody does', () => {
        show();
        expect(screen.getByText(/Nobody yet/)).toBeInTheDocument();

        show({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' });
        expect(screen.getByText(/With Nilesh/)).toBeInTheDocument();
    });

    it('does NOT put the date of birth or the address in the DOM', () => {
        // Disclosure unmounts its panel rather than hiding it, so a closed card
        // genuinely does not publish the traveller — not to Ctrl-F, not to a screen
        // reader, not to a scroll past somebody's shoulder.
        show();
        expect(screen.queryByText('2007-04-11')).not.toBeInTheDocument();
        expect(screen.queryByText(/360 Huntington/)).not.toBeInTheDocument();
    });
});

describe('an expanded card', () => {
    it('shows the person, once you have asked for them', () => {
        showOpen();
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
        expect(screen.getByText('2007-04-11')).toBeInTheDocument();
        expect(screen.getByText(/360 Huntington/)).toBeInTheDocument();
    });

    it('warns that an international arrival takes time to clear', () => {
        showOpen();
        expect(screen.getByText(/immigration and baggage/i)).toBeInTheDocument();
    });

    it('surfaces the meeting point when they will land with no phone', () => {
        // The single most useful field on the card for a first arrival.
        showOpen();
        expect(screen.getByText(/By the exit doors/)).toBeInTheDocument();
    });

    it('says so loudly when there is no meeting point and no phone', () => {
        showOpen({ meetingPointNote: undefined });
        expect(screen.getByText(/No meeting point agreed/i)).toBeInTheDocument();
    });

    it('badges a flight time that moved after somebody claimed it', () => {
        showOpen({
            status: 'claimed', claimedByUid: 'sarthi_1',
            arrivalTimeChangedAt: '2026-09-10T00:00:00.000Z',
        });
        expect(screen.getByText(/flight time has changed/i)).toBeInTheDocument();
    });

    it('offers a call button per number it actually has', () => {
        showOpen({ passenger: { ...BASE.passenger, altPhone: '+919876500000' } });
        expect(screen.getByRole('link', { name: /^Call$/ })).toHaveAttribute('href', 'tel:+16175550123');
        expect(screen.getByRole('link', { name: /second number/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Bhavna/ })).toBeInTheDocument();
    });

    it('renders no call button for a number it does not have', () => {
        showOpen({ passenger: { ...BASE.passenger, familyContact: null } });
        expect(screen.queryByRole('link', { name: /Bhavna/ })).not.toBeInTheDocument();
    });
});

describe('the buttons follow the transition table', () => {
    it('an open arrival offers only the claim', () => {
        showOpen();
        expect(buttonNames()).toContain("I'll collect them");
        expect(buttonNames()).not.toContain("I've found them");
    });

    it('a Sarthi is NOT offered their own arrival', () => {
        // The server refuses it; rendering it would be a button that always fails.
        showOpen({ requesterUid: 'sarthi_1' });
        expect(buttonNames()).not.toContain("I'll collect them");
    });

    it('the Sarthi holding it gets the next steps, and no second claim', () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' });
        const names = buttonNames();
        expect(names).toContain("I've found them");
        expect(names).toContain('Dropped them off');
        expect(names).toContain("I can't go");
        expect(names).not.toContain("I'll collect them");
    });

    it('another Sarthi gets no action buttons at all on a claimed trip', () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' });
        const names = buttonNames();
        expect(names).not.toContain("I've found them");
        expect(names).not.toContain("I can't go");
    });

    it('a coordinator gets them on a trip they do not hold', () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' }, true);
        expect(buttonNames()).toContain("I've found them");
    });

    it('a completed trip offers nothing', () => {
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1' });
        const names = buttonNames();
        expect(names).not.toContain('Dropped them off');
        expect(names).not.toContain("I can't go");
    });

    it('sends the action to the server with the pickup id', async () => {
        showOpen();
        await userEvent.click(screen.getByRole('button', { name: "I'll collect them" }));
        expect(update).toHaveBeenCalledWith({ pickupId: 'p1', action: 'claim' });
    });

    it('shows the server’s own refusal, not a generic retry', async () => {
        // "It is with Kiran" is the one thing a Sarthi who lost the race needs.
        update.mockRejectedValueOnce(new Error('That cannot be done. It is with Kiran.'));
        showOpen();
        await userEvent.click(screen.getByRole('button', { name: "I'll collect them" }));
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('with Kiran'));
    });

    it('confirms before handing a trip back', async () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1' });
        await userEvent.click(screen.getByRole('button', { name: "I can't go" }));
        expect(ask).toHaveBeenCalled();
    });

    it('does nothing when the confirmation is declined', async () => {
        ask.mockResolvedValueOnce(false);
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1' });
        await userEvent.click(screen.getByRole('button', { name: "I can't go" }));
        expect(update).not.toHaveBeenCalled();
    });
});

/**
 * WHY A FINISHED CARD LOOKS FINISHED.
 *
 * Reported from production on 2026-08-25: the only pickup in the database had been
 * dropped off, and its card rendered as a live one with the buttons simply absent —
 * wearing a red "Landing soon" chip, because `urgencyOf` is a pure function of the
 * clock and never saw the status. The owner read it, reasonably, as a broken button.
 *
 * Nothing transitions out of 'completed', so the missing buttons were correct. The
 * defect was that the card never said so.
 */
describe('a trip that is already done', () => {
    it('says dropped off instead of shouting about the landing time', () => {
        // Same fixture, three hours before its own landing — so the clock alone would
        // still call this critical.
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1', completedAt: '2026-09-20T23:40:00.000Z' });
        expect(screen.getByText('Dropped off')).toBeInTheDocument();
        expect(screen.queryByText('Landing soon')).not.toBeInTheDocument();
    });

    it('says when, so the absent buttons have a visible reason', () => {
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1', completedAt: '2026-09-20T23:40:00.000Z' });
        expect(screen.getByText(/Dropped off safely on \w+ \d+\./)).toBeInTheDocument();
    });

    it('still reads as finished when nobody stamped a time', () => {
        // Older records predate completedAt. A card that renders "Dropped off safely on
        // Invalid Date" is worse than one that renders no date at all.
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1', completedAt: null });
        expect(screen.getByText('Dropped off safely.')).toBeInTheDocument();
    });

    it('names who took them rather than who is with them', () => {
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' });
        expect(screen.getByText(/Dropped off by Kiran/)).toBeInTheDocument();
    });

    it('drops the flight-changed warning, which is only news to somebody still driving', () => {
        showOpen({
            status: 'completed', claimedByUid: 'sarthi_1',
            arrivalTimeChangedAt: '2026-09-19T00:00:00.000Z',
        });
        expect(screen.queryByText(/flight time has changed/i)).not.toBeInTheDocument();
    });

    it('leaves a live trip measured by the clock, exactly as before', () => {
        // 'Dropped off' is the CHIP. The button a claimed trip correctly offers reads
        // 'Dropped them off', which is why those two must not share a label — this
        // assertion could not tell them apart when they did.
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1' });
        expect(screen.queryByText('Dropped off')).not.toBeInTheDocument();
        expect(screen.queryByText(/Dropped off safely on/)).not.toBeInTheDocument();
    });
});

describe('telling the family', () => {
    const claimedByMe = { status: 'claimed' as const, claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };

    it('offers the message once a Sarthi has the trip', () => {
        showOpen(claimedByMe);
        expect(screen.getByRole('button', { name: /Tell the family/i })).toBeInTheDocument();
    });

    it('renders NO button when the family gave no number', () => {
        // The assertion this whole feature turns on. A wa.me link with no number
        // opens WhatsApp on a blank contact picker and tells nobody anything.
        showOpen({ ...claimedByMe, passenger: { ...BASE.passenger, familyContact: null } });
        expect(screen.queryByRole('button', { name: /Tell the family/i })).not.toBeInTheDocument();
    });

    it('renders NO button when the number is unusable', () => {
        showOpen({
            ...claimedByMe,
            passenger: {
                ...BASE.passenger,
                familyContact: { name: 'Ba', relationship: 'Mother', phone: 'call the house', hasWhatsapp: true },
            },
        });
        expect(screen.queryByRole('button', { name: /Tell the family/i })).not.toBeInTheDocument();
    });

    it('is not offered on an unclaimed arrival', () => {
        showOpen();
        expect(screen.queryByRole('button', { name: /Tell the family/i })).not.toBeInTheDocument();
    });

    it('records that the message went, so "told them" differs from "meant to"', async () => {
        const open = vi.fn();
        vi.stubGlobal('open', open);

        showOpen(claimedByMe);
        await userEvent.click(screen.getByRole('button', { name: /Tell the family/i }));

        expect(open).toHaveBeenCalledWith(
            expect.stringContaining('https://wa.me/919876543210'),
            '_blank',
            'noopener,noreferrer',
        );
        expect(update).toHaveBeenCalledWith({ pickupId: 'p1', action: 'familyNotified' });
    });

    it('says the family has already been told, when they have', () => {
        showOpen({ ...claimedByMe, familyNotifiedAt: '2026-09-21T03:00:00.000Z' });
        expect(screen.getByText(/family has been messaged/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /message them again/i })).toBeInTheDocument();
    });
});

describe('the urgency chip', () => {
    it('says a plane has already landed with nobody assigned', () => {
        // Folded into "landing soon" this would be invisible, and it is the one that
        // needs a phone call rather than a glance.
        const card = show({ arrivalAt: new Date(Date.now() - 3600_000).toISOString() });
        expect(within(card.container).getByText(/Already landed/i)).toBeInTheDocument();
    });

    it('is calm for something months away', () => {
        const card = show({ arrivalAt: new Date(Date.now() + 90 * 86400_000).toISOString() });
        expect(within(card.container).getByText(/Plenty of time/i)).toBeInTheDocument();
    });
});

/**
 * HANDING A TRIP TO A NAMED SARTHI NO LONGER EXISTS. Removed 2026-08-25 on the owner's
 * instruction — "a Sarthi releases and another Sarthi picks it up" — which is one
 * action instead of two and needs no roster.
 *
 * The trap it left behind is why this block is not simply deleted: `reassign` was the
 * ONLY transition out of 'no_show'. Removing it without widening `release` would have
 * frozen every no-show forever, and invisibly, because every "needs somebody" count in
 * the app filters on status == 'open'.
 */
/**
 * WHOSE JOB IS IT TO CLAIM. Reported 2026-08-25 from a screenshot: a manager doing
 * coordinator work was being offered "I will collect them", because the role hierarchy
 * expands downward and every manager is a granted Sarthi.
 *
 * The gate is on the HAT, not the capability — and the server still accepts a claim
 * from any approved driver, so this is about what is offered, never about what is
 * allowed.
 */
describe('claiming belongs to whoever is wearing the Sarthi hat', () => {
    it('offers the claim to a Sarthi', () => {
        showOpen();
        expect(buttonNames()).toContain("I'll collect them");
    });

    it('does NOT offer it to somebody currently being a manager', () => {
        viewer = { uid: 'coord_1', name: 'Tonny', activeRole: 'manager' };
        showOpen({}, true);
        expect(buttonNames()).not.toContain("I'll collect them");
    });

    it('says WHY it is missing, rather than just removing it', () => {
        // A control that vanishes with no reason reads as a broken screen. This is the
        // half of the change that stops the gate becoming its own defect.
        viewer = { uid: 'coord_1', name: 'Tonny', activeRole: 'manager' };
        showOpen({}, true);
        expect(screen.getByText(/Switch to Sarthi/i)).toBeInTheDocument();
    });

    it('says nothing of the sort to a Sarthi, who has the button', () => {
        showOpen();
        expect(screen.queryByText(/Switch to Sarthi/i)).not.toBeInTheDocument();
    });

    it('offers no hint on a trip that could not be claimed anyway', () => {
        // Already taken. Telling a manager to switch hats for a trip nobody can claim
        // would be advice that leads to another empty screen.
        viewer = { uid: 'coord_1', name: 'Tonny', activeRole: 'manager' };
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' }, true);
        expect(screen.queryByText(/Switch to Sarthi/i)).not.toBeInTheDocument();
    });

    it('leaves the coordinator oversight buttons alone', () => {
        // Only `claim` is gated. These are organising work, and one of them is now the
        // only way to recover a trip from a Sarthi who has gone quiet.
        viewer = { uid: 'coord_1', name: 'Tonny', activeRole: 'manager' };
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' }, true);
        expect(buttonNames()).toContain("I've found them");
        expect(buttonNames()).toContain("I can't go");
    });
});

describe('no picker, and no dead end where it used to be', () => {
    const claimed = {
        status: 'claimed' as const, claimedByUid: 'sarthi_2', claimedByName: 'Nilesh',
    };

    it('offers no hand-to-a-named-Sarthi control, not even to a coordinator', () => {
        showOpen(claimed, true);
        expect(screen.queryByRole('button', { name: /another Sarthi/i })).not.toBeInTheDocument();
    });

    it('lets the Sarthi who marked a no-show put it back on the board', () => {
        // THE DEAD-END GUARD. Without release from 'no_show' this card renders no
        // actions at all and the trip is stranded.
        showOpen({ status: 'no_show', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' });
        expect(buttonNames()).toContain("I can't go");
    });

    it('lets a coordinator put back a no-show they do not hold', () => {
        // With the picker gone, this is the ONLY way to recover a trip from a Sarthi
        // who has stopped responding. It must not be tidied away.
        showOpen({ status: 'no_show', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' }, true);
        expect(buttonNames()).toContain("I can't go");
    });

    it('sends a plain release, with no target', async () => {
        showOpen({ status: 'no_show', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' });
        await userEvent.click(screen.getByRole('button', { name: "I can't go" }));
        expect(update).toHaveBeenCalledWith({ pickupId: 'p1', action: 'release' });
    });

    it('still offers nothing at all once the trip is finished', () => {
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1' }, true);
        // `buttonNames` includes the disclosure header, which is always there — so the
        // assertion is "no ACTION survives", not "no button exists".
        const names = buttonNames();
        for (const label of ["I'll collect them", "I've found them", 'Dropped them off',
            "Couldn't find them", "I can't go"]) {
            expect(names, label).not.toContain(label);
        }
    });
});

describe('when they did not give an address', () => {
    const NO_ADDRESS: Partial<AirportPickup> = {
        dropoffAddress: undefined, dropoffLat: undefined, dropoffLng: undefined,
    };

    it('says so out loud, rather than showing an empty row', () => {
        showOpen(NO_ADDRESS);
        expect(screen.getByText(/ask them where they are going/i)).toBeInTheDocument();
    });

    it('still renders the whole card — an absent address is not a crash', () => {
        // `arrival.dropoffAddress.split(',')` used to build the family WhatsApp
        // message. Unguarded, that throws on undefined and takes the board with it.
        showOpen(NO_ADDRESS);
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
        expect(screen.getByText(/Boston Logan/)).toBeInTheDocument();
    });

    it('still offers the family message, without the "on our way to" line', () => {
        // The destination only ever added one sentence to that message, so an absent
        // one must not be the difference between telling the family and not.
        showOpen({ ...NO_ADDRESS, status: 'claimed', claimedByUid: 'sarthi_1' });
        expect(screen.getByRole('button', { name: /Tell the family/i })).toBeInTheDocument();
    });

    it('keeps the address off the collapsed row, present or absent', () => {
        show(NO_ADDRESS);
        expect(screen.queryByText(/ask them where they are going/i)).not.toBeInTheDocument();
    });

    it('shows the address when there is one, and no prompt', () => {
        showOpen();
        expect(screen.getByText('360 Huntington Ave, Boston, MA')).toBeInTheDocument();
        expect(screen.queryByText(/ask them where they are going/i)).not.toBeInTheDocument();
    });
});
