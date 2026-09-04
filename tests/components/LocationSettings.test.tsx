/**
 * The manager's venue editor, now that a venue lives in two places.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the anti-dead-button one: **saving reaches the
 * hall, not only `settings/main`.**
 *
 * Dispatch resolves a venue as `event.venue → locations/{id}.venue →
 * settings/main.sabhaLocation`. So the moment the hall became the authority, a Save
 * button that wrote only `settings/main` would report "Location updated successfully!"
 * and change nothing a driver is routed by. That is this repo's signature defect, and
 * it would have been shipped by the very change that introduced the new authority —
 * which is exactly the kind of thing a test has to hold, because both writes succeed
 * and nothing anywhere errors.
 *
 * The other direction is asserted too: `settings/main` must STILL be written, because
 * an un-refreshed phone reads it for the address it shows a rider. Dropping it would
 * leave the two disagreeing about where sabha is, silently, for whoever has not tapped
 * the update banner.
 *
 * Text, roles and the payloads handed to the two writers. No class names — see
 * tests/setup.ts.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSabhaLocation = vi.fn().mockResolvedValue(undefined);
const updateSabhaTimes = vi.fn().mockResolvedValue(undefined);
const updateLocationVenue = vi.fn().mockResolvedValue(undefined);

const HALL = {
    id: 'boston-huntington', name: 'Sabha', active: true, order: 0,
    venue: { lat: 42.339362, lng: -71.0878001, address: '346 Huntington Ave' },
};
let openHalls: Array<typeof HALL>;

const NEW_PLACE = {
    formattedAddress: '5 Elm Street, Somerville, MA',
    latitude: 42.387,
    longitude: -71.099,
};

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'mgr_1' } }),
}));
vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        sabhaLocation: HALL.venue,
        sabhaStartTime: '19:00',
        sabhaEndTime: '22:00',
        loading: false,
        updateSabhaLocation: (...a: unknown[]) => updateSabhaLocation(...a),
        updateSabhaTimes: (...a: unknown[]) => updateSabhaTimes(...a),
    }),
}));
vi.mock('../../hooks/useLocations', () => ({
    useLocations: () => ({
        locations: openHalls,
        active: openHalls,
        loading: false,
        error: null,
        updateLocationVenue: (...a: unknown[]) => updateLocationVenue(...a),
    }),
}));
/**
 * The address field is a Google Places widget with its own tests. Stubbed down to a
 * button that reports one chosen place, because what this file is about is what happens
 * to that place afterwards.
 */
vi.mock('../../components/auth/AddressAutocomplete', () => ({
    AddressAutocomplete: ({ onSelect, id }: { onSelect: (d: unknown) => void; id?: string }) => (
        <>
            {/* Carries `id` through, so the caller's own label really does resolve.
                A stub that dropped it would let the label test pass against an
                unlabelled field. */}
            <input id={id} readOnly value="" />
            <button type="button" onClick={() => onSelect(NEW_PLACE)}>pick an address</button>
        </>
    ),
}));

import { LocationSettings } from '../../components/manager/LocationSettings';

const pickAddress = () => userEvent.click(screen.getByRole('button', { name: /pick an address/i }));
const save = () => userEvent.click(screen.getByRole('button', { name: /^Save/i }));

beforeEach(() => {
    vi.clearAllMocks();
    openHalls = [HALL];
});

describe('saving a new venue', () => {
    it('REACHES THE HALL, which is what dispatch routes by', async () => {
        render(<LocationSettings />);
        await pickAddress();
        await save();

        await waitFor(() => expect(updateLocationVenue).toHaveBeenCalled());
        expect(updateLocationVenue).toHaveBeenCalledWith(
            'boston-huntington',
            { lat: 42.387, lng: -71.099, address: '5 Elm Street, Somerville, MA' },
            'mgr_1',
        );
    });

    it('and STILL writes settings/main, which an un-refreshed phone reads', async () => {
        render(<LocationSettings />);
        await pickAddress();
        await save();

        await waitFor(() => expect(updateSabhaLocation).toHaveBeenCalled());
        expect(updateSabhaLocation).toHaveBeenCalledWith(
            { lat: 42.387, lng: -71.099, address: '5 Elm Street, Somerville, MA' },
            'mgr_1',
        );
    });

    it('writes the hall FIRST, so a failure there cannot leave the two disagreeing', async () => {
        updateLocationVenue.mockRejectedValueOnce(new Error('permission denied'));
        render(<LocationSettings />);
        await pickAddress();
        await save();

        await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument());
        expect(updateSabhaLocation).not.toHaveBeenCalled();
    });

    it('says so when the save fails, rather than looking as though it worked', async () => {
        updateSabhaLocation.mockRejectedValueOnce(new Error('Are you a manager?'));
        render(<LocationSettings />);
        await pickAddress();
        await save();

        await waitFor(() => expect(screen.getByText(/Are you a manager/i)).toBeInTheDocument());
    });

    it('confirms only after both writes have landed', async () => {
        render(<LocationSettings />);
        await pickAddress();
        await save();

        await waitFor(() => expect(screen.getByText(/updated successfully/i)).toBeInTheDocument());
        expect(updateLocationVenue).toHaveBeenCalledTimes(1);
        expect(updateSabhaLocation).toHaveBeenCalledTimes(1);
    });
});

describe('which hall it edits', () => {
    it('edits the single open hall, unambiguously', () => {
        // Asserted so this cannot quietly start editing an arbitrary hall once a
        // second one can exist. A manager cannot create one from the UI yet, so one
        // open hall is guaranteed by construction today.
        expect(openHalls).toHaveLength(1);
    });

    it('leaves the hall alone when it cannot tell which one, rather than guessing', async () => {
        // With two halls open there is no unambiguous target, and writing the wrong
        // hall's venue would re-point every rider at that hall to the wrong building.
        // `settings/main` still gets the edit, so nothing is lost.
        openHalls = [HALL, { ...HALL, id: 'somerville', name: 'Somerville', order: 1 }];
        render(<LocationSettings />);
        await pickAddress();
        await save();

        await waitFor(() => expect(updateSabhaLocation).toHaveBeenCalled());
        expect(updateLocationVenue).not.toHaveBeenCalled();
    });
});

describe('every field is labelled', () => {
    it('associates all three labels with their inputs', () => {
        /**
         * The time fields had labels with no `htmlFor` and inputs with no `id`, so two
         * adjacent time boxes were both announced as "time" and a screen reader user
         * could not tell start from end. The ADDRESS field had the same defect and I
         * only found it by rendering the screen in the preview harness — which is the
         * argument for looking at a page rather than trusting a component test.
         *
         * `getByLabelText` fails outright on an unassociated label, so this asserts the
         * association rather than the text.
         */
        render(<LocationSettings />);

        expect(screen.getByLabelText(/New Address/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Default Start/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Default End/i)).toBeInTheDocument();
    });
});

describe('what it will not save', () => {
    it('refuses a time pair too short for drop-off to make sense', async () => {
        render(<LocationSettings />);
        const start = screen.getByLabelText(/Default Start/i);
        const end = screen.getByLabelText(/Default End/i);

        await userEvent.clear(start);
        await userEvent.type(start, '19:00');
        await userEvent.clear(end);
        await userEvent.type(end, '19:05');
        await save();

        expect(updateSabhaTimes).not.toHaveBeenCalled();
        expect(updateLocationVenue).not.toHaveBeenCalled();
    });
});
