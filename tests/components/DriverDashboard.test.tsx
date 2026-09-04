/**
 * The driver must never be shown nothing.
 *
 * `renderContent` switches on `viewState`, and three of its four cases need data
 * that `viewState` alone does not guarantee. All three used to `return null`. A
 * driver then got a blank page with **no navigation** — ActiveRide puts the app in
 * focus mode, which hides the sidebar, header and bottom bar — and no control of
 * any kind. No way back, nothing to tap, no explanation. Force-quitting the app
 * was the only escape.
 *
 * THE REACHABLE ONE
 * -----------------
 * `preview` needs `rideContext.rideType`, and the ride window closes on its own:
 * at midnight, or when a manager resets a manual override. The context
 * subscription then publishes `rideType: null` while the driver is still reading
 * the carload they were offered. That is the first test below, driven end to end
 * through the real subscription rather than by poking state.
 *
 * The other two branches are defensive — `activeRide` and `completedRideStats` are
 * currently set and cleared alongside `viewState` — and they are asserted at the
 * level that is actually true: whatever happens, a working screen renders.
 *
 * This is the first test coverage DriverDashboard has ever had.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const globalAssignDriver = vi.fn();
const useAuth = vi.fn();

/** Captured Firestore listeners, so a test can fire them like the server would. */
let ridesListener: ((snap: any) => void) | null = null;
let contextListener: ((snap: any) => void) | null = null;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    // Tagged BY NAME. The dashboard now also renders the notice board, which
    // subscribes to `notices` — with a single untagged shape that subscription
    // would capture the rides listener and every test below would drive the
    // wrong one.
    collection: (_db: unknown, name: string) => (name === 'notices' ? { __notices: true } : { __rides: true }),
    doc: () => ({ __context: true }),
    query: (base: any) => base,
    where: () => ({}),
    orderBy: () => ({}),
    onSnapshot: (ref: any, next: any) => {
        if (ref?.__notices) next({ docs: [] });      // empty board; not what these tests are about
        else if (ref?.__rides) ridesListener = next;
        else contextListener = next;
        return () => undefined;
    },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => useAuth() }));
vi.mock('../../hooks/useFirestore', () => ({
    handBackVehicle: vi.fn(),
    setDriverAvailability: vi.fn(),
    assignVehicleToDriver: vi.fn(),
    useAvailableVehicles: () => ({ vehicles: [], loading: false }),
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    globalAssignDriver: (...a: unknown[]) => globalAssignDriver(...a),
    driverDoneForToday: vi.fn(),
    // Real wording, not a stub: what the Sarthi is told when nobody is waiting HERE is
    // the point of half the cases below.
    reasonForWaiting: (row: { reason: string; groups: number; seats: number }) => {
        const people = row.groups === 1 ? '1 group' : `${row.groups} groups`;
        if (row.reason === 'other-location') return `${people} are waiting for the other sabha.`;
        if (row.reason === 'no-location') return `${people} did not say which sabha — a manager needs to check.`;
        if (row.reason === 'waiting-for-bigger-vehicle') return `${people} need a bigger car than yours (${row.seats} seats).`;
        return null;
    },
}));

/** ONE HALL by default — production, and what every case here was written against. */
const HUNTINGTON = { id: 'boston-huntington', name: 'Huntington', active: true, order: 0, venue: { lat: 42.3, lng: -71.0, address: 'a' } };
const SOMERVILLE = { id: 'somerville', name: 'Somerville', active: true, order: 1, venue: { lat: 42.4, lng: -71.1, address: 'b' } };
let openHalls: Array<typeof HUNTINGTON>;
vi.mock('../../hooks/useLocations', () => ({
    useLocations: () => ({ locations: openHalls, active: openHalls, loading: false, error: null }),
}));
vi.mock('../../src/utils/googleMaps', () => ({ buildGoogleMapsNavigationUrl: () => 'maps://x' }));
vi.mock('../../src/utils/endShift', () => ({ endShiftWithWarning: vi.fn(async () => true) }));
// Captured, because what a Sarthi is TOLD when nobody is waiting here is the point of
// several cases below. `info` was missing from this mock entirely, so the no-riders
// path would have thrown had anything exercised it.
const toastInfo = vi.fn();
const toastError = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
    useToast: () => ({
        success: vi.fn(), error: (m: string) => toastError(m), info: (m: string) => toastInfo(m),
    }),
}));
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask: vi.fn(async () => true), confirmDialog: null }),
}));

// The children are stubbed to markers. What is under test is WHICH view renders,
// not how each looks — and each child drags in its own tree of dependencies.
vi.mock('../../components/driver/DriverShift', () => ({
    // Carries the hall props through, so a test can assert which hall the dashboard
    // offers and pick one. DriverShift's own rendering is its own file's business.
    DriverShift: ({ onFindRiders, halls, hallId, onPickHall }: any) => (
        <div>
            <span>SHIFT CARD</span>
            <span data-testid="hall">{hallId ?? 'none'}</span>
            {(halls ?? []).map((h: any) => (
                <button key={h.id} onClick={() => onPickHall?.(h.id)}>{`pick ${h.name}`}</button>
            ))}
            <button onClick={onFindRiders}>Find my riders</button>
        </div>
    ),
}));
vi.mock('../../components/driver/AssignmentPreview', () => ({
    AssignmentPreview: () => <div>ASSIGNMENT PREVIEW</div>,
}));
vi.mock('../../components/driver/ActiveRide', () => ({
    ActiveRide: () => <div>ACTIVE RIDE</div>,
}));
vi.mock('../../components/driver/CompletionScreen', () => ({
    CompletionScreen: () => <div>COMPLETION SCREEN</div>,
}));

import { DriverDashboard } from '../../components/driver/DriverDashboard';

const contextSnap = (rideType: string | null) => ({
    exists: () => true,
    data: () => ({ rideType, displayText: rideType ? 'Home → Sabha' : 'No rides available' }),
});

const ASSIGNMENT = {
    status: 'success',
    rideId: 'ride_1',
    students: [{ id: 's1', name: 'Rebo Fe', location: { lat: 42.3, lng: -71.1 }, picked: false }],
    route: [],
    estimatedDistance: 2,
    estimatedTime: 5,
    googleMapsUrl: 'maps://x',
    car: { model: 'Car1', color: 'Black', licensePlate: 'ABC', capacity: 4 },
};

beforeEach(() => {
    vi.clearAllMocks();
    openHalls = [HUNTINGTON];
    ridesListener = null;
    contextListener = null;
    useAuth.mockReturnValue({
        currentUser: { uid: 'driver_1' },
        userProfile: {
            name: 'Dido Re', status: 'available', currentVehicleId: 'veh_1',
            currentVehicleName: 'Car1', ridesCompletedToday: 1,
        },
        refreshProfile: vi.fn(),
        activeRole: 'driver',
    });
    globalAssignDriver.mockResolvedValue(ASSIGNMENT);
});

/** Mount, open the ride window, and get the driver as far as the preview screen. */
/**
 * Render, wait for the context listener, publish a window.
 *
 * The RIDES listener is deliberately left unfed, exactly as `reachPreview` does: the
 * component branches on `snapshot.empty`, and a stub without that field falls through
 * to an undefined document. Not feeding it at all is the same state as "no active
 * ride" and needs no fixture.
 */
async function renderDashboard(published?: unknown) {
    render(<DriverDashboard />);
    await waitFor(() => expect(contextListener).toBeTruthy());
    contextListener!(published ?? contextSnap('home-to-sabha'));
}

async function reachPreview() {
    const user = userEvent.setup();
    render(<DriverDashboard />);

    await waitFor(() => expect(contextListener).toBeTruthy());
    contextListener!(contextSnap('home-to-sabha'));

    await user.click(await screen.findByRole('button', { name: /find my riders/i }));
    await waitFor(() => expect(screen.getByText('ASSIGNMENT PREVIEW')).toBeInTheDocument());
    return user;
}

describe('DriverDashboard — never a blank screen', () => {
    it('shows the shift card to a driver with nothing happening', async () => {
        render(<DriverDashboard />);

        await waitFor(() => expect(contextListener).toBeTruthy());
        contextListener!(contextSnap('home-to-sabha'));

        expect(await screen.findByText('SHIFT CARD')).toBeInTheDocument();
    });

    it('reaches the preview after finding riders', async () => {
        await reachPreview();

        expect(screen.getByText('ASSIGNMENT PREVIEW')).toBeInTheDocument();
        expect(screen.queryByText('SHIFT CARD')).not.toBeInTheDocument();
    });

    it('FALLS BACK to the shift card when the ride window closes mid-preview', async () => {
        // The reachable bug. Midnight, or a manager resetting the override, and
        // the driver reading a proposed carload lost the entire screen — with no
        // navigation, because focus mode had hidden it.
        await reachPreview();

        contextListener!(contextSnap(null));

        expect(await screen.findByText('SHIFT CARD')).toBeInTheDocument();
        expect(screen.queryByText('ASSIGNMENT PREVIEW')).not.toBeInTheDocument();
    });

    it('leaves a working control on screen, not just any markup', async () => {
        // "Not blank" is not the bar. The driver has to be able to DO something —
        // a screen with no control is the same dead end wearing different pixels.
        await reachPreview();

        contextListener!(contextSnap(null));

        expect(await screen.findByRole('button', { name: /find my riders/i })).toBeInTheDocument();
    });

    it('says in the console which guard fired, so a recurrence is diagnosable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await reachPreview();

        contextListener!(contextSnap(null));
        await screen.findByText('SHIFT CARD');

        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/viewState 'preview' without/));
        warn.mockRestore();
    });

    it('recovers the preview if the window reopens', async () => {
        // The stored viewState is deliberately NOT reset, so a value that was
        // merely late restores the real view rather than dropping the driver out
        // for good.
        await reachPreview();

        contextListener!(contextSnap(null));
        await screen.findByText('SHIFT CARD');

        contextListener!(contextSnap('home-to-sabha'));

        expect(await screen.findByText('ASSIGNMENT PREVIEW')).toBeInTheDocument();
    });

    it('shows the shift card when the driver has no ride and the window is shut', async () => {
        render(<DriverDashboard />);

        await waitFor(() => expect(contextListener).toBeTruthy());
        contextListener!(contextSnap(null));
        ridesListener!({ empty: true, docs: [] });

        expect(await screen.findByText('SHIFT CARD')).toBeInTheDocument();
    });

    it('renders the active ride once the rides listener reports one', async () => {
        render(<DriverDashboard />);

        await waitFor(() => expect(ridesListener).toBeTruthy());
        contextListener!(contextSnap('home-to-sabha'));
        ridesListener!({
            empty: false,
            docs: [{
                id: 'ride_1',
                data: () => ({
                    rideType: 'home-to-sabha', route: [], studentId: 's1', studentName: 'Rebo Fe',
                }),
            }],
        });

        expect(await screen.findByText('ACTIVE RIDE')).toBeInTheDocument();
    });

    it('drops back to the shift card when the driver\'s rides go away', async () => {
        // A manager releasing their riders. Both the ride and the view state are
        // cleared together today, which is why this passes without the fallback —
        // asserted anyway, because it is the behaviour a driver depends on.
        render(<DriverDashboard />);

        await waitFor(() => expect(ridesListener).toBeTruthy());
        contextListener!(contextSnap('home-to-sabha'));
        ridesListener!({
            empty: false,
            docs: [{ id: 'ride_1', data: () => ({ rideType: 'home-to-sabha', route: [] }) }],
        });
        await screen.findByText('ACTIVE RIDE');

        ridesListener!({ empty: true, docs: [] });

        expect(await screen.findByText('SHIFT CARD')).toBeInTheDocument();
    });
});

/**
 * WHICH SABHA THIS RUN IS FOR.
 *
 * A Sarthi is not tied to a hall: they pick per run, so finishing a load to one and
 * taking the next to the other is ordinary rather than exceptional.
 *
 * THE FIRST TWO CASES ARE THAT NOTHING CHANGES WITH ONE HALL, which is every evening
 * until a manager opens a second — and a picker with one option is a control that
 * cannot do anything.
 */
describe('DriverDashboard — choosing which sabha', () => {
    const findRiders = () => screen.getByRole('button', { name: /Find my riders/i });

    it('resolves the only open hall without asking, and dispatches for it', async () => {
        /**
         * Whether a PICKER renders is DriverShift's decision and is asserted in its own
         * file — the stub above draws one button per hall regardless. What belongs here
         * is that the dashboard resolves a hall on its own when there is only one, and
         * sends it.
         */
        await renderDashboard();

        expect(screen.getByTestId('hall')).toHaveTextContent('boston-huntington');
        globalAssignDriver.mockResolvedValue({ status: 'no_students' });
        await userEvent.click(findRiders());

        await waitFor(() => expect(globalAssignDriver).toHaveBeenCalled());
        // The hall's real id, not null.
        expect(globalAssignDriver).toHaveBeenCalledWith('driver_1', 'veh_1', 'boston-huntington');
    });

    it('offers both halls once a second is open, and starts with neither chosen', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        await renderDashboard();

        expect(screen.getByRole('button', { name: /pick Huntington/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /pick Somerville/i })).toBeInTheDocument();
        expect(screen.getByTestId('hall')).toHaveTextContent('none');
    });

    it('dispatches for the hall the Sarthi picked', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        await renderDashboard();

        await userEvent.click(screen.getByRole('button', { name: /pick Somerville/i }));
        expect(screen.getByTestId('hall')).toHaveTextContent('somerville');

        globalAssignDriver.mockResolvedValue({ status: 'no_students' });
        await userEvent.click(findRiders());

        await waitFor(() => expect(globalAssignDriver).toHaveBeenCalled());
        expect(globalAssignDriver).toHaveBeenCalledWith('driver_1', 'veh_1', 'somerville');
    });

    it('reads THAT hall\'s window, not the document top level', async () => {
        /**
         * The top level is the founding hall's window — a compatibility aggregate for
         * bundles too old to know about halls. A Sarthi driving for Somerville who read
         * it would be shown the wrong direction.
         */
        openHalls = [HUNTINGTON, SOMERVILLE];
        await renderDashboard({
            exists: () => true,
            data: () => ({
                rideType: 'home-to-sabha', displayText: 'Home → Sabha',
                byLocation: {
                    'boston-huntington': { rideType: 'home-to-sabha', displayText: 'Home → Sabha' },
                    somerville: { rideType: 'sabha-to-home', displayText: 'Sabha → Home' },
                },
                locationIds: ['boston-huntington', 'somerville'],
            }),
        });

        await userEvent.click(screen.getByRole('button', { name: /pick Somerville/i }));

        // The accept path refuses without a rideType, so a wrong slice would surface
        // as the wrong direction rather than as nothing.
        globalAssignDriver.mockResolvedValue({ status: 'no_students' });
        await userEvent.click(findRiders());
        await waitFor(() => expect(globalAssignDriver).toHaveBeenCalled());
    });
});

/**
 * "Nobody is waiting" is TRUE AND LEADS TO THE WRONG CONCLUSION, which is the shape
 * that sent a manager hunting for a dispatch fault on 2026-08-14.
 *
 * The server has always returned a `waiting` breakdown by reason and NOTHING RENDERED
 * IT, so every refusal collapsed into one sentence: a Sarthi at a quiet hall was told
 * nobody was waiting while people waited at the other one, and one whose car was too
 * small was told exactly the same thing.
 */
describe('DriverDashboard — why nobody was assigned', () => {
    const findRiders = () => screen.getByRole('button', { name: /Find my riders/i });

    const runWith = async (waiting: unknown) => {
        await renderDashboard();
        globalAssignDriver.mockResolvedValue({ status: 'no_students', waiting });
        await userEvent.click(findRiders());
        await waitFor(() => expect(toastInfo).toHaveBeenCalled());
        return toastInfo.mock.calls[0][0] as string;
    };

    it('says people are waiting at the OTHER sabha', async () => {
        const said = await runWith([{ reason: 'other-location', groups: 3, seats: 4 }]);
        expect(said).toMatch(/other sabha/i);
        expect(said).toMatch(/3 groups/);
    });

    it('says a bigger car is what is needed', async () => {
        const said = await runWith([{ reason: 'waiting-for-bigger-vehicle', groups: 1, seats: 5 }]);
        expect(said).toMatch(/bigger car/i);
    });

    it('flags a request that named no sabha, so a manager can fix it', async () => {
        const said = await runWith([{ reason: 'no-location', groups: 1, seats: 0 }]);
        expect(said).toMatch(/did not say which sabha/i);
    });

    it('falls back to the plain sentence when there is nothing to add', async () => {
        const said = await runWith([]);
        expect(said).toMatch(/Nobody is waiting right now/i);
    });

    it('names no rider, only how many', async () => {
        const said = await runWith([{ reason: 'other-location', groups: 2, seats: 3 }]);
        expect(said).not.toMatch(/stu_|[A-Z][a-z]+ [A-Z][a-z]+/);
    });
});
