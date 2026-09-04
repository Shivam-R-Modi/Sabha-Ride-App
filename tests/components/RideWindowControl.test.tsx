/**
 * The manager's Ride window controls.
 *
 * WHAT THIS FILE EXISTS FOR: the "Requests open at" input rendered BLANK even when a
 * time was saved. `AppSettings` declared `requestsOpenTime` and `useSettings` returned
 * it, but the state object built from the Firestore snapshot never copied it off the
 * document — so the value was permanently `undefined`, the seeding effect here never
 * fired, and a manager saw an empty box.
 *
 * That failure mode is the reason it is worth a test: the setting WORKED. The server
 * read the stored value perfectly well and the window opened at the right time. Only
 * the display was wrong, which reads to a manager as "it reset itself" — so they set it
 * again, and again, and never learn that anything is fine. Nothing threw, nothing
 * logged, and no existing test covered this screen at all.
 *
 * The assertion is therefore on what the manager SEES, not on the hook's return value:
 * a unit test on `useSettings` would have passed against the bug just as happily, since
 * the field it forgot to copy is optional.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const manuallyUpdateRideContext = vi.fn().mockResolvedValue(undefined);
const updateRequestsOpenTime = vi.fn().mockResolvedValue(undefined);
let storedContext: Record<string, unknown> | undefined;
let settings: Record<string, unknown>;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}),
    onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
        next({ exists: () => storedContext !== undefined, data: () => storedContext });
        return () => undefined;
    },
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    manuallyUpdateRideContext: (...a: unknown[]) => manuallyUpdateRideContext(...a),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'mgr_1' } }),
}));
vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        ...settings,
        updateRequestsOpenTime: (...a: unknown[]) => updateRequestsOpenTime(...a),
    }),
}));

import { RideWindowControl } from '../../components/manager/RideWindowControl';

const openTimeInput = () => screen.getByLabelText(/Requests open at/i) as HTMLInputElement;

beforeEach(() => {
    vi.clearAllMocks();
    storedContext = { rideType: null, displayText: 'No rides available' };
    settings = { requestsOpenTime: undefined, loading: false };
});

describe('the requests-open time a manager saved', () => {
    it('SHOWS the saved value rather than an empty box', async () => {
        // The bug: this rendered '' while the server used 07:30 quite happily.
        settings = { requestsOpenTime: '07:30', loading: false };
        render(<RideWindowControl />);

        await waitFor(() => expect(openTimeInput().value).toBe('07:30'));
    });

    it('falls back to the shipped 10:00 when nothing is stored', async () => {
        // NOT blank, and not midnight. Midnight is the value this default was moved
        // away from — it put the "requests are open" push in the middle of the night.
        settings = { requestsOpenTime: undefined, loading: false };
        render(<RideWindowControl />);

        await waitFor(() => expect(openTimeInput().value).toBe('10:00'));
    });

    it('stays empty while the settings are still loading, rather than flashing a wrong time', async () => {
        // `undefined` used to mean both "not loaded" and "never set". Seeding on the
        // value could only tell them apart by guessing; seeding on `loading` cannot.
        settings = { requestsOpenTime: '07:30', loading: true };
        render(<RideWindowControl />);

        expect(openTimeInput().value).toBe('');
    });

    it('does not overwrite what a manager is half-way through typing', async () => {
        // The snapshot listener fires on every context change, once a minute. Seeding
        // on every render rather than once would wipe the field mid-edit.
        settings = { requestsOpenTime: '10:00', loading: false };
        render(<RideWindowControl />);
        await waitFor(() => expect(openTimeInput().value).toBe('10:00'));

        await userEvent.clear(openTimeInput());
        await userEvent.type(openTimeInput(), '08:15');

        expect(openTimeInput().value).toBe('08:15');
    });

    it('saves the edited time, and only when it differs from what is stored', async () => {
        settings = { requestsOpenTime: '10:00', loading: false };
        render(<RideWindowControl />);
        await waitFor(() => expect(openTimeInput().value).toBe('10:00'));

        const save = screen.getByRole('button', { name: /^Save$/i });
        // Unchanged, so there is nothing to save — a button that writes the value
        // already stored is a control that appears to do something and does not.
        expect(save).toBeDisabled();

        await userEvent.clear(openTimeInput());
        await userEvent.type(openTimeInput(), '08:15');
        expect(save).toBeEnabled();

        await userEvent.click(save);
        expect(updateRequestsOpenTime).toHaveBeenCalledWith('08:15', 'mgr_1');
    });
});
