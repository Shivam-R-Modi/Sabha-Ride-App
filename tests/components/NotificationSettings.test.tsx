/**
 * The manager's notification panel.
 *
 * THE ASSERTIONS THAT EARN THIS FILE:
 *
 *   1. THE SPLIT IS REAL. Airport rows must not appear in the sabha panel and vice
 *      versa. The whole arrangement is "airport settings live where airport work
 *      happens", and a panel that quietly rendered all fourteen in both places would
 *      look fine and defeat the point.
 *   2. THE IMPORTANT ONES ASK TWICE, and cancelling actually cancels. Muting "Sarthi
 *      has arrived" leaves a volunteer parked outside a house; a confirmation that
 *      renders but saves anyway is worse than none, because it teaches the manager
 *      the dialog is real.
 *   3. IT SENDS A WHOLE CONFIGURATION. A patch would let the document drift into a
 *      half-state where one field was written and another silently was not.
 *   4. A FREQUENCY CONTROL ONLY EXISTS WHERE THERE IS A FREQUENCY. Eleven of the
 *      fourteen fire once when something happens; a picker on those would be a
 *      control that changes nothing, which is this repo's signature defect.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateNotificationSettings = vi.fn();
let storedDoc: any;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}),
    onSnapshot: (_ref: unknown, next: any) => {
        next({ data: () => storedDoc });
        return () => undefined;
    },
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    updateNotificationSettings: (...a: any[]) => updateNotificationSettings(...a),
}));

import { NotificationSettings } from '../../components/manager/NotificationSettings';

const show = (service: 'sabha' | 'airport' = 'sabha') =>
    render(<NotificationSettings service={service} />);

const switchFor = (name: RegExp) => screen.getByRole('switch', { name });

beforeEach(() => {
    vi.clearAllMocks();
    storedDoc = undefined;               // no document yet: the shipped defaults
    updateNotificationSettings.mockResolvedValue({ success: true });
});

describe('the split between the two services', () => {
    it('shows only sabha notifications in the sabha panel', () => {
        show('sabha');
        expect(screen.getByText('Sarthi has arrived')).toBeInTheDocument();
        expect(screen.queryByText('Pickup still unclaimed')).not.toBeInTheDocument();
    });

    it('shows only airport notifications in the airport panel', () => {
        show('airport');
        expect(screen.getByText('Pickup still unclaimed')).toBeInTheDocument();
        expect(screen.queryByText('Sarthi has arrived')).not.toBeInTheDocument();
    });

    it('says who each notification reaches', () => {
        // A manager about to silence something should be able to see whose phone
        // goes quiet without leaving the screen.
        show('airport');
        expect(screen.getByText(/Airport coordinators/)).toBeInTheDocument();
    });
});

describe('switching something off', () => {
    it('saves the whole configuration, not just the one that changed', async () => {
        show('sabha');
        await userEvent.click(switchFor(/New notice/i));

        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
        const sent = updateNotificationSettings.mock.calls[0][0];
        expect(sent.enabled.notice).toBe(false);
        // Present and untouched, so the document cannot end up half-written.
        expect(sent.enabled.sarthi_arrived).toBe(true);
        expect(sent.alertBands).toEqual([48, 24, 10, 2]);
        expect(sent.reminderHour).toBe(10);
    });

    it('does NOT ask twice for an ordinary one', async () => {
        show('sabha');
        await userEvent.click(switchFor(/New notice/i));
        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
    });

    it('warns once something is off, so a forgotten switch is visible', async () => {
        storedDoc = { enabled: { notice: false } };
        show('sabha');
        expect(screen.getByText(/switched off. Nobody is being told/i)).toBeInTheDocument();
    });

    it('shows no warning when everything is on', () => {
        show('sabha');
        expect(screen.queryByText(/Nobody is being told/i)).not.toBeInTheDocument();
    });
});

describe('the four that strand somebody', () => {
    it('asks before silencing "Sarthi has arrived"', async () => {
        show('sabha');
        await userEvent.click(switchFor(/Sarthi has arrived/i));

        expect(await screen.findByText(/Switch off "Sarthi has arrived"\?/)).toBeInTheDocument();
        expect(updateNotificationSettings).not.toHaveBeenCalled();
    });

    it('saves nothing when the manager backs out', async () => {
        show('sabha');
        await userEvent.click(switchFor(/Sarthi has arrived/i));
        await userEvent.click(await screen.findByRole('button', { name: /go back/i }));

        expect(updateNotificationSettings).not.toHaveBeenCalled();
    });

    it('goes through once confirmed', async () => {
        show('sabha');
        await userEvent.click(switchFor(/Sarthi has arrived/i));
        await userEvent.click(await screen.findByRole('button', { name: /switch it off/i }));

        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
        expect(updateNotificationSettings.mock.calls[0][0].enabled.sarthi_arrived).toBe(false);
    });

    it('does not ask when switching one back ON', async () => {
        // Friction belongs on the way to silence, not on the way out of it.
        storedDoc = { enabled: { sarthi_arrived: false } };
        show('sabha');
        await userEvent.click(switchFor(/Sarthi has arrived/i));

        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
    });
});

describe('frequency controls appear only where there is a frequency', () => {
    it('offers the escalation ladder on the unclaimed alert', () => {
        show('airport');
        expect(screen.getByRole('group', { name: /hours before landing/i })).toBeInTheDocument();
    });

    it('offers no frequency on a one-off notification', () => {
        show('airport');
        // 'An airport pickup changed' fires once, when the traveller edits. A picker
        // beside it would change nothing.
        const row = screen.getByText('An airport pickup changed').closest('div')!.parentElement!
            .parentElement!;
        expect(within(row).queryByRole('group')).not.toBeInTheDocument();
    });

    it('hides the frequency when the notification itself is off', () => {
        // Tuning the cadence of something that never sends is a control over nothing.
        storedDoc = { enabled: { 'airport-unclaimed': false } };
        show('airport');
        expect(screen.queryByRole('group', { name: /hours before landing/i })).not.toBeInTheDocument();
    });

    it('offers an hour and a cadence for the ride reminder', () => {
        show('sabha');
        expect(screen.getByLabelText(/How often/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/What time/i)).toBeInTheDocument();
    });
});

describe('the escalation ladder', () => {
    it('adds a band', async () => {
        show('airport');
        await userEvent.click(screen.getByRole('button', { name: '6h' }));

        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
        expect(updateNotificationSettings.mock.calls[0][0].alertBands).toEqual([48, 24, 10, 6, 2]);
    });

    it('removes one', async () => {
        show('airport');
        await userEvent.click(screen.getByRole('button', { name: '48h' }));

        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
        expect(updateNotificationSettings.mock.calls[0][0].alertBands).toEqual([24, 10, 2]);
    });

    it('marks the chosen ones as pressed, for a screen reader', () => {
        show('airport');
        expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '6h' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('will not let the LAST band be removed', async () => {
        // An empty list is ambiguous — "never alert" is what the switch above is for
        // — and the resolver would read it as a broken save and restore the defaults,
        // so the chip would appear to do nothing at all.
        storedDoc = { alertBands: [2] };
        show('airport');
        expect(screen.getByRole('button', { name: '2h' })).toBeDisabled();
    });

    it('stops at the cap rather than letting one pickup become a pager', () => {
        storedDoc = { alertBands: [48, 24, 12, 10, 6, 2] };
        show('airport');
        expect(screen.getByRole('button', { name: '1h' })).toBeDisabled();
        // The ones already chosen stay removable.
        expect(screen.getByRole('button', { name: '48h' })).toBeEnabled();
    });
});

describe('when the save fails', () => {
    it('says so rather than looking as though it worked', async () => {
        updateNotificationSettings.mockRejectedValue(new Error('Only managers can do that'));
        show('sabha');
        await userEvent.click(switchFor(/New notice/i));

        expect(await screen.findByRole('alert')).toHaveTextContent(/Only managers can do that/);
    });
});
