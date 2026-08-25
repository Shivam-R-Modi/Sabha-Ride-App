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

let viewer = { uid: 'sarthi_1', name: 'Kiran' };
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: viewer.uid },
        userProfile: { name: viewer.name },
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
    viewer = { uid: 'sarthi_1', name: 'Kiran' };
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
        expect(screen.getByRole('link', { name: /other number/i })).toBeInTheDocument();
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
        expect(buttonNames()).toContain('I will collect them');
        expect(buttonNames()).not.toContain('I have met them');
    });

    it('a Sarthi is NOT offered their own arrival', () => {
        // The server refuses it; rendering it would be a button that always fails.
        showOpen({ requesterUid: 'sarthi_1' });
        expect(buttonNames()).not.toContain('I will collect them');
    });

    it('the Sarthi holding it gets the next steps, and no second claim', () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' });
        const names = buttonNames();
        expect(names).toContain('I have met them');
        expect(names).toContain('Dropped off safely');
        expect(names).toContain('Hand this back');
        expect(names).not.toContain('I will collect them');
    });

    it('another Sarthi gets no action buttons at all on a claimed trip', () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' });
        const names = buttonNames();
        expect(names).not.toContain('I have met them');
        expect(names).not.toContain('Hand this back');
    });

    it('a coordinator gets them on a trip they do not hold', () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh' }, true);
        expect(buttonNames()).toContain('I have met them');
    });

    it('a completed trip offers nothing', () => {
        showOpen({ status: 'completed', claimedByUid: 'sarthi_1' });
        const names = buttonNames();
        expect(names).not.toContain('Dropped off safely');
        expect(names).not.toContain('Hand this back');
    });

    it('sends the action to the server with the pickup id', async () => {
        showOpen();
        await userEvent.click(screen.getByRole('button', { name: 'I will collect them' }));
        expect(update).toHaveBeenCalledWith({ pickupId: 'p1', action: 'claim' });
    });

    it('shows the server’s own refusal, not a generic retry', async () => {
        // "It is with Kiran" is the one thing a Sarthi who lost the race needs.
        update.mockRejectedValueOnce(new Error('That cannot be done. It is with Kiran.'));
        showOpen();
        await userEvent.click(screen.getByRole('button', { name: 'I will collect them' }));
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('with Kiran'));
    });

    it('confirms before handing a trip back', async () => {
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1' });
        await userEvent.click(screen.getByRole('button', { name: 'Hand this back' }));
        expect(ask).toHaveBeenCalled();
    });

    it('does nothing when the confirmation is declined', async () => {
        ask.mockResolvedValueOnce(false);
        showOpen({ status: 'claimed', claimedByUid: 'sarthi_1' });
        await userEvent.click(screen.getByRole('button', { name: 'Hand this back' }));
        expect(update).not.toHaveBeenCalled();
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
        expect(screen.getByRole('button', { name: /message the family again/i })).toBeInTheDocument();
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

describe('a coordinator moving a trip', () => {
    const claimed = {
        status: 'claimed' as const, claimedByUid: 'sarthi_2', claimedByName: 'Nilesh',
    };

    it('is offered to a coordinator', () => {
        showOpen(claimed, true);
        expect(screen.getByRole('button', { name: /Give this to another Sarthi/i }))
            .toBeInTheDocument();
    });

    it('is NOT offered to an ordinary Sarthi, even the one holding it', async () => {
        // The one thing the coordinator flag genuinely gates, and the server checks
        // the same. A visible button here would always come back permission-denied.
        showOpen({ ...claimed, claimedByUid: 'sarthi_1', claimedByName: 'Kiran' }, false);
        expect(screen.queryByRole('button', { name: /Give this to another Sarthi/i }))
            .not.toBeInTheDocument();
    });

    it('is not offered on an unclaimed trip — there is nobody to move it from', () => {
        showOpen({}, true);
        expect(screen.queryByRole('button', { name: /Give this to another Sarthi/i }))
            .not.toBeInTheDocument();
    });

    it('sends the reassign with the chosen Sarthi', async () => {
        showOpen(claimed, true);
        await userEvent.click(screen.getByRole('button', { name: /Give this to another Sarthi/i }));
        await userEvent.click(screen.getByText('Kiran'));

        expect(update).toHaveBeenCalledWith({
            pickupId: 'p1', action: 'reassign', toUid: 'sarthi_1',
        });
    });

    it('does not offer the Sarthi who already holds it', async () => {
        // Reassigning to the current holder is a no-op dressed as an action.
        showOpen(claimed, true);
        await userEvent.click(screen.getByRole('button', { name: /Give this to another Sarthi/i }));

        expect(screen.queryByText('Nilesh')).not.toBeInTheDocument();
        expect(screen.getByText('Kiran')).toBeInTheDocument();
    });
});

/**
 * A DESTINATION THAT WAS NEVER GIVEN.
 *
 * The address became optional because somebody filing a month before they fly often
 * does not have one. That moves the burden onto this card: the Sarthi has to be told
 * it is a question to ask, not left looking at a blank row they will read as a
 * loading failure. And `dropoffAddress?.split(',')` is now the only thing standing
 * between an absent address and a crash that takes the whole board down.
 */
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
