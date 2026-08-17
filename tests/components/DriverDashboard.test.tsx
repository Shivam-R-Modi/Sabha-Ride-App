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
    collection: () => ({ __rides: true }),
    doc: () => ({ __context: true }),
    query: () => ({ __rides: true }),
    where: () => ({}),
    onSnapshot: (ref: any, next: any) => {
        if (ref?.__rides) ridesListener = next;
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
}));
vi.mock('../../src/utils/googleMaps', () => ({ buildGoogleMapsNavigationUrl: () => 'maps://x' }));
vi.mock('../../src/utils/endShift', () => ({ endShiftWithWarning: vi.fn(async () => true) }));
vi.mock('../../contexts/ToastContext', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask: vi.fn(async () => true), confirmDialog: null }),
}));

// The children are stubbed to markers. What is under test is WHICH view renders,
// not how each looks — and each child drags in its own tree of dependencies.
vi.mock('../../components/driver/DriverShift', () => ({
    DriverShift: ({ onFindRiders }: any) => (
        <div>
            <span>SHIFT CARD</span>
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
