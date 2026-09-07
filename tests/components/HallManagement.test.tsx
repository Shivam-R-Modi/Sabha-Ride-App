/**
 * The manager's sabha locations: add one, move one, open and close them.
 *
 * ── THE ASSERTION THIS FILE INHERITED ───────────────────────────────────────────────
 *
 * **Saving an address reaches the HALL**, which is what dispatch routes by. This lived
 * in LocationSettings.test.tsx until that card stopped editing addresses. It moved here
 * rather than being deleted, because the defect it guards is unchanged: dispatch
 * resolves `event.venue → locations/{id}.venue → settings/main`, so a Save that writes
 * anything else reports success and moves nothing a driver is routed by. Both writes
 * succeed and nothing errors, which is why only a test holds it.
 *
 * The old version only wrote the hall when EXACTLY ONE was open. Opening a second one
 * turned that guard into the very bug it was written to avoid — so the per-hall case is
 * the first thing asserted below.
 *
 * ── AND THE ONE THIS FILE ADDS ──────────────────────────────────────────────────────
 *
 * **Creating a hall and OPENING one are separate acts**, because firestore.rules makes
 * them separate: `active` is denied to every client in both directions. A new hall lands
 * closed and the screen says so, or a manager saves a half-finished hall and riders can
 * book it instantly.
 *
 * Closing is the guarded direction. A closed hall is not hidden — `rejectionFor` refuses
 * a ride naming it, so everybody booked for it becomes undispatchable with no error
 * anywhere. The dialog therefore reports the server's own count of who that is.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateLocationVenue = vi.fn().mockResolvedValue(undefined);
const createLocation = vi.fn().mockResolvedValue(undefined);
const previewLocationActive = vi.fn();
const setLocationActive = vi.fn().mockResolvedValue({ changed: true });
/** The confirmation, hoisted so the composed message is assertable. */
const ask = vi.fn(async (_options: any) => true);

const HUNTINGTON = {
    id: 'boston-huntington', name: 'Huntington Ave', active: true, order: 0,
    venue: { lat: 42.339362, lng: -71.0878001, address: '346 Huntington Ave' },
};
const D_STREET = {
    id: 'south-boston', name: 'D Street', active: true, order: 1,
    venue: { lat: 42.3411, lng: -71.0494, address: '320 D St' },
};
const RETIRED = {
    id: 'old-hall', name: 'Old Hall', active: false, order: 2,
    venue: { lat: 42.4, lng: -71.1, address: '1 Old Street' },
};

let halls: Array<typeof HUNTINGTON>;

const NEW_PLACE = {
    formattedAddress: '5 Elm Street, Somerville, MA',
    latitude: 42.387,
    longitude: -71.099,
};

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'mgr_1' } }),
}));
vi.mock('../../hooks/useLocations', () => ({
    useLocations: () => ({
        locations: halls,
        active: halls.filter(h => h.active),
        loading: false,
        error: null,
        updateLocationVenue: (...a: unknown[]) => updateLocationVenue(...a),
        createLocation: (...a: unknown[]) => createLocation(...a),
    }),
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    previewLocationActive: (...a: unknown[]) => previewLocationActive(...a),
    setLocationActive: (...a: unknown[]) => setLocationActive(...a),
}));
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask: (o: any) => ask(o), confirmDialog: null }),
}));
/**
 * The address box, stubbed to a plain input with a button that "picks a suggestion".
 *
 * The real one talks to Google Places. What matters here is the DISTINCTION it enforces:
 * typed text carries no coordinates, and only a picked place does — which is why Save
 * stays disabled until one is chosen.
 */
vi.mock('../../components/auth/AddressAutocomplete', () => ({
    AddressAutocomplete: ({ id, value, onChange, onSelect, placeholder }: any) => (
        <div>
            <input
                id={id}
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
            />
            <button type="button" onClick={() => onSelect(NEW_PLACE)}>
                pick-suggestion-{id}
            </button>
        </div>
    ),
}));

import { HallManagement } from '../../components/manager/HallManagement';

beforeEach(() => {
    vi.clearAllMocks();
    halls = [HUNTINGTON, D_STREET, RETIRED];
    ask.mockResolvedValue(true);
    previewLocationActive.mockResolvedValue({
        locationId: 'south-boston', name: 'D Street', active: false,
        requestedRideCount: 0, requestedSeatCount: 0, openAfter: 1,
    });
    setLocationActive.mockResolvedValue({ changed: true });
});

describe('HallManagement — the list', () => {
    it('lists every hall, open and closed, with its address', () => {
        render(<HallManagement />);

        expect(screen.getByText('Huntington Ave')).toBeInTheDocument();
        expect(screen.getByText('D Street')).toBeInTheDocument();
        // The retired one too: a screen that lists halls has to show the ones that are
        // shut, or there is no way to open one again.
        expect(screen.getByText('Old Hall')).toBeInTheDocument();
        expect(screen.getByText(/346 Huntington Ave/)).toBeInTheDocument();
    });

    it('says which are open and which are closed', () => {
        render(<HallManagement />);

        // `selector: 'span'` because the retired hall's Open BUTTON has the same text,
        // and counting both would pass while the badges were wrong.
        expect(screen.getAllByText('Open', { selector: 'span' })).toHaveLength(2);
        expect(screen.getAllByText('Closed', { selector: 'span' })).toHaveLength(1);
    });

    it('shows each id, because it is what attendance and statistics are filed under', () => {
        render(<HallManagement />);
        expect(screen.getByText('south-boston')).toBeInTheDocument();
    });
});

describe('HallManagement — moving a hall', () => {
    it('REACHES THE HALL, which is what dispatch routes by', async () => {
        /**
         * The inherited assertion. `settings/main.sabhaLocation` loses to
         * `locations/{id}.venue` in `resolveVenue`, so a Save writing anything else
         * reports success and changes nothing a driver is routed by.
         */
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Move' })[1]);
        await userEvent.click(screen.getByText('pick-suggestion-hall-address-south-boston'));
        await userEvent.click(screen.getByRole('button', { name: /Save address/i }));

        await waitFor(() => expect(updateLocationVenue).toHaveBeenCalled());
        expect(updateLocationVenue).toHaveBeenCalledWith(
            'south-boston',
            { lat: 42.387, lng: -71.099, address: '5 Elm Street, Somerville, MA' },
            'mgr_1',
        );
    });

    it('moves THE HALL ON THAT ROW, not the first one', async () => {
        // The whole reason this moved out of a single-hall screen. Editing Huntington
        // must not write D Street, and there is no ambiguity to fall back on.
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Move' })[0]);
        await userEvent.click(screen.getByText('pick-suggestion-hall-address-boston-huntington'));
        await userEvent.click(screen.getByRole('button', { name: /Save address/i }));

        await waitFor(() => expect(updateLocationVenue).toHaveBeenCalled());
        expect(updateLocationVenue.mock.calls[0][0]).toBe('boston-huntington');
    });

    it('WILL NOT SAVE typed text, because typed text has no coordinates', async () => {
        /**
         * Only a picked suggestion carries lat/lng, and coordinates are what every route
         * and every carload is built from. firestore.rules refuses a venue without them
         * — but after the button had already said it saved, which is the wrong order.
         */
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Move' })[1]);
        const box = screen.getByLabelText(/New address for D Street/i);
        await userEvent.clear(box);
        await userEvent.type(box, '12 Somewhere Road');

        expect(screen.getByRole('button', { name: /Save address/i })).toBeDisabled();
        expect(screen.getByText(/that is what provides the coordinates/i)).toBeInTheDocument();
    });

    it('names the hall on its address label', async () => {
        // Two identical-looking address boxes on one screen. Without the hall in the
        // label a screen reader announces "New address" twice.
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Move' })[1]);
        expect(screen.getByLabelText(/New address for D Street/i)).toBeInTheDocument();
    });

    it('says so when the save fails, rather than looking as though it worked', async () => {
        updateLocationVenue.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Move' })[1]);
        await userEvent.click(screen.getByText('pick-suggestion-hall-address-south-boston'));
        await userEvent.click(screen.getByRole('button', { name: /Save address/i }));

        expect(await screen.findByText(/Missing or insufficient permissions/i)).toBeInTheDocument();
    });
});

describe('HallManagement — adding one', () => {
    it('creates it with the derived id, and CLOSED', async () => {
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), 'Elm Street');
        await userEvent.click(screen.getByText('pick-suggestion-new-hall-address'));
        await userEvent.click(screen.getByRole('button', { name: /Add it, closed/i }));

        await waitFor(() => expect(createLocation).toHaveBeenCalled());
        expect(createLocation).toHaveBeenCalledWith(
            'elm-street',
            'Elm Street',
            { lat: 42.387, lng: -71.099, address: '5 Elm Street, Somerville, MA' },
            'mgr_1',
        );
    });

    it('SHOWS THE ID BEFORE SAVING, because it can never be changed', async () => {
        /**
         * The id becomes part of every events, weeklyAttendance and statistics key this
         * hall ever has. Correcting it later orphans all of them, so it is shown rather
         * than generated silently — the name can be changed afterwards, this cannot.
         */
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), 'Elm Street');

        expect(screen.getByText('elm-street')).toBeInTheDocument();
        expect(screen.getByText(/permanent, unlike the name/i)).toBeInTheDocument();
    });

    it('SAYS IT LANDS CLOSED, so nobody waits for riders to see it', async () => {
        // A manager who adds a hall and expects riders to be offered it would otherwise
        // conclude the feature is broken.
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), 'Elm Street');
        await userEvent.click(screen.getByText('pick-suggestion-new-hall-address'));
        await userEvent.click(screen.getByRole('button', { name: /Add it, closed/i }));

        expect(await screen.findByText(/it is CLOSED/i)).toBeInTheDocument();
        expect(screen.getByText(/until you press Open on its row/i)).toBeInTheDocument();
    });

    it('refuses a name whose ID is already taken', async () => {
        // `createLocation` refuses it too, but only after the manager has typed an
        // address. "South Boston" derives `south-boston`, which this project's second
        // hall already uses.
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), 'South Boston');
        // The address is PICKED, so `!place` is not what disables the button — this
        // isolates the id-collision guard. Without it the test passes either way.
        await userEvent.click(screen.getByText('pick-suggestion-new-hall-address'));

        expect(screen.getByText(/already a sabha location saved as/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add it, closed/i })).toBeDisabled();
    });

    it('refuses a DUPLICATE NAME even when the id is free', async () => {
        /**
         * The id is derived from the name but they drift: the existing hall is called
         * "D Street" and saved as `south-boston`, so typing "D Street" again collides on
         * neither id nor document. Riders would then see the same name twice in the
         * picker with nothing to tell them apart, and one of them gets collected for the
         * wrong building. Found by this test failing for the right reason.
         */
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), 'd street');
        // Picked, for the same reason as above.
        await userEvent.click(screen.getByText('pick-suggestion-new-hall-address'));

        expect(screen.getByText(/already a sabha location called/i)).toBeInTheDocument();
        expect(screen.getByText(/same name twice with no way to tell them apart/i))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add it, closed/i })).toBeDisabled();
    });

    it('refuses a name with no letters or digits to build an id from', async () => {
        // Rather than inventing something like `hall-3` for a document whose id can
        // never be corrected.
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), '!!!');

        expect(screen.getByText(/no letters or digits to build an id from/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add it, closed/i })).toBeDisabled();
    });

    it('will not add one without an address', async () => {
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: /Add a sabha location/i }));
        await userEvent.type(screen.getByLabelText(/What is it called/i), 'Elm Street');

        expect(screen.getByRole('button', { name: /Add it, closed/i })).toBeDisabled();
    });
});

describe('HallManagement — opening and closing', () => {
    it('opens a closed hall through the callable', async () => {
        previewLocationActive.mockResolvedValue({
            locationId: 'old-hall', name: 'Old Hall', active: true,
            requestedRideCount: 0, requestedSeatCount: 0, openAfter: 3,
        });
        render(<HallManagement />);

        await userEvent.click(screen.getByRole('button', { name: 'Open' }));

        await waitFor(() => expect(setLocationActive).toHaveBeenCalled());
        expect(setLocationActive).toHaveBeenCalledWith('old-hall', true, true);
    });

    it('REPORTS WHO WOULD BE STRANDED, from the server\'s own count', async () => {
        /**
         * Those riders get silence, not an error: `rejectionFor` refuses their ride,
         * every Sarthi is told nobody is waiting, and nobody is collected. The count
         * comes from the preview rather than from this screen, so it cannot disagree
         * with the guard that is about to run.
         */
        previewLocationActive.mockResolvedValue({
            locationId: 'south-boston', name: 'D Street', active: false,
            requestedRideCount: 3, requestedSeatCount: 7, openAfter: 1,
        });
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);

        await waitFor(() => expect(ask).toHaveBeenCalled());
        expect(ask.mock.calls[0][0].message).toContain('3 ride requests for 7 people');
        expect(ask.mock.calls[0][0].message).toMatch(/no Sarthi would be told why/i);
    });

    it('says plainly when nobody is booked', async () => {
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);

        await waitFor(() => expect(ask).toHaveBeenCalled());
        expect(ask.mock.calls[0][0].message).toMatch(/Nobody is booked for it right now/i);
    });

    it('closes nothing when the manager backs out', async () => {
        ask.mockResolvedValue(false);
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);

        await waitFor(() => expect(ask).toHaveBeenCalled());
        expect(setLocationActive).not.toHaveBeenCalled();
    });

    it('DISABLES Close on the last open hall, and says why', async () => {
        /**
         * Closing it would leave nowhere to be driven to, and
         * `locationsOrFoundingFallback` would then synthesise a hall from settings/main
         * and log an error — silently re-opening the one just shut. The server refuses
         * too; this stops the manager reaching a dialog whose answer is always no.
         *
         * The explanation is in words as well as the disabled state, because a disabled
         * control with no reason looks broken.
         */
        halls = [HUNTINGTON];
        render(<HallManagement />);

        expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
        expect(screen.getByText(/only sabha location open, so it cannot be closed/i))
            .toBeInTheDocument();
    });

    it('allows Close once a second hall is open', async () => {
        render(<HallManagement />);
        expect(screen.getAllByRole('button', { name: 'Close' })[0]).toBeEnabled();
    });

    it('surfaces the SERVER\'s refusal', async () => {
        // It refuses for reasons a manager can act on — a Sarthi already on the road —
        // and a generic failure hides every one of them.
        setLocationActive.mockRejectedValueOnce(
            new Error('2 rides are already on the way to D Street.'));
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);

        expect(await screen.findByText(/already on the way to D Street/i)).toBeInTheDocument();
    });

    it('does not write when the preview itself fails', async () => {
        previewLocationActive.mockRejectedValueOnce(new Error('Manager access revoked'));
        render(<HallManagement />);

        await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);

        expect(await screen.findByText(/Manager access revoked/i)).toBeInTheDocument();
        expect(setLocationActive).not.toHaveBeenCalled();
    });
});
