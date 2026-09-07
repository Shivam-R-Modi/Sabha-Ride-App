/**
 * The default sabha times. This card no longer edits an address.
 *
 * IT USED TO, and the tests for that moved to HallManagement.test.tsx rather than being
 * deleted — the invariant they held did not go away, it changed owner.
 *
 * The address editor here wrote a hall's venue only when EXACTLY ONE hall was open, a
 * deliberate guard for the release where a manager could not create a second. The moment
 * a second hall was actually opened that condition went false, so Save reported
 * "Location updated successfully!" and wrote only `settings/main.sabhaLocation` — which
 * loses to `locations/{id}.venue` in `resolveVenue`. A button that says it moved sabha
 * and moves nothing: this repo's signature defect, introduced by turning on the feature
 * the guard was waiting for.
 *
 * Addresses are per hall now, in `HallManagement`, with the hall named on the row. What
 * is left here is genuinely global, so there is nothing to be ambiguous about.
 *
 * Text, roles and the payload handed to the writer. No class names — see tests/setup.ts.
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

describe('every field is labelled', () => {
    it('associates both time labels with their inputs', () => {
        /**
         * The time fields had labels with no `htmlFor` and inputs with no `id`, so two
         * adjacent time boxes were both announced as "time" and a screen reader user
         * could not tell start from end. The address field on this card had the same
         * defect, found by rendering the screen in the preview harness rather than by a
         * test — which is the argument for looking at a page. That field now lives in
         * HallManagement, labelled per hall, and is asserted there.
         *
         * `getByLabelText` fails outright on an unassociated label, so this asserts the
         * association rather than the text.
         */
        render(<LocationSettings />);

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
