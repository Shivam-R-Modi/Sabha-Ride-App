/**
 * What the traveller sees after they have asked.
 *
 * THE ASSERTION THIS FILE WAS WRITTEN FOR: a no-show must not say a Sarthi is on the
 * way.
 *
 * The first version of this card rendered "Nilesh is collecting you" whenever a
 * Sarthi's name was set — which included a finished trip and, worse, a `no_show`,
 * where the one thing the traveller knows for certain is that nobody found them.
 * Telling somebody standing in an arrivals hall that a car is coming when it is not
 * is the worst version of the silently-wrong failure this repo keeps removing. It was
 * found by looking at the visual harness, not by a test, so the test exists now.
 *
 * The other one: the cancel button follows the shared transition table, so a finished
 * trip shows no button rather than one that returns failed-precondition.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const update = vi.fn(async () => ({ success: true, status: 'cancelled' as const }));
vi.mock('../../src/utils/cloudFunctions', () => ({
    updateAirportPickup: (...a: unknown[]) => update(...(a as [])),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }));

const ask = vi.fn(async () => true);
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask, confirmDialog: null }),
}));

import { ArrivalStatusCard } from '../../components/airport/ArrivalStatusCard';
import type { AirportPickup } from '../../types';
import type { ArrivalStatus } from '../../src/utils/arrival';

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
        email: 'r@example.com',
        familyContact: null,
    },
    status: 'open',
    retainUntil: '2033-09-21T02:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
};

const show = (status: ArrivalStatus, over: Partial<AirportPickup> = {}) => render(
    <ArrivalStatusCard
        arrival={{ ...BASE, status, ...over }}
        onCancelled={() => undefined}
    />,
);

beforeEach(() => {
    vi.clearAllMocks();
    ask.mockResolvedValue(true);
});

describe('what it says about the Sarthi', () => {
    it('says they are collecting you while they are', () => {
        show('claimed', { claimedByName: 'Nilesh' });
        expect(screen.getByText(/is collecting you/)).toBeInTheDocument();
    });

    it('says they have met you once they have', () => {
        show('met', { claimedByName: 'Nilesh' });
        expect(screen.getByText(/has met you/)).toBeInTheDocument();
        expect(screen.queryByText(/is collecting you/)).not.toBeInTheDocument();
    });

    it('does NOT say a Sarthi is coming on a no-show', () => {
        // The assertion this file was written for.
        show('no_show', { claimedByName: 'Nilesh' });
        expect(screen.queryByText(/is collecting you/)).not.toBeInTheDocument();
        expect(screen.getByText(/were not found/i)).toBeInTheDocument();
    });

    it('does NOT say a Sarthi is coming on a cancelled trip', () => {
        show('cancelled', { claimedByName: 'Nilesh' });
        expect(screen.queryByText(/is collecting you/)).not.toBeInTheDocument();
    });

    it('says nothing at all while nobody has taken it', () => {
        show('open');
        expect(screen.getByText(/Waiting for a Sarthi/i)).toBeInTheDocument();
        expect(screen.queryByText(/collecting you/)).not.toBeInTheDocument();
    });

    it('tells somebody still at the airport to call, on a no-show', () => {
        show('no_show', { claimedByName: 'Nilesh' });
        expect(screen.getByRole('alert').textContent).toMatch(/call the seva coordinator/i);
    });
});

describe('the block they screenshot before flying', () => {
    it('carries everything needed at a barrier with no data', () => {
        show('claimed', { claimedByName: 'Nilesh' });
        const block = screen.getByLabelText('Your pickup details');

        for (const expected of ['Ramesh Patel', 'BOS', 'Terminal', 'Emirates EK237', 'Nilesh', 'By the exit doors']) {
            expect(block.textContent, expected).toContain(expected);
        }
    });

    it('leaves out a row it has no value for, rather than printing a blank', () => {
        show('open', { terminal: undefined, airline: undefined, flightNumber: undefined });
        const block = screen.getByLabelText('Your pickup details');
        expect(block.textContent).not.toMatch(/Terminal/);
        expect(block.textContent).not.toMatch(/Flight/);
    });
});

describe('cancelling', () => {
    it('is offered while the trip is still live', () => {
        show('open');
        expect(screen.getByRole('button', { name: /Cancel this pickup/i })).toBeInTheDocument();
    });

    it('is NOT offered on a finished trip', () => {
        // From the shared transition table, so the button that renders is one the
        // server will accept.
        for (const status of ['completed', 'cancelled', 'no_show'] as ArrivalStatus[]) {
            const view = show(status);
            expect(screen.queryByRole('button', { name: /Cancel this pickup/i }), status)
                .not.toBeInTheDocument();
            view.unmount();
        }
    });

    it('warns that somebody has already agreed to come', async () => {
        show('claimed', { claimedByName: 'Nilesh' });
        await userEvent.click(screen.getByRole('button', { name: /Cancel this pickup/i }));

        expect(ask).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Nilesh'),
        }));
    });

    it('does nothing when the confirmation is declined', async () => {
        ask.mockResolvedValueOnce(false);
        show('open');
        await userEvent.click(screen.getByRole('button', { name: /Cancel this pickup/i }));
        expect(update).not.toHaveBeenCalled();
    });

    it('sends the cancel', async () => {
        show('open');
        await userEvent.click(screen.getByRole('button', { name: /Cancel this pickup/i }));
        expect(update).toHaveBeenCalledWith({ pickupId: 'p1', action: 'cancel' });
    });
});
