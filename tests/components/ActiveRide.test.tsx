/**
 * The run screen, and the two things it must not lose.
 *
 * THE GOOGLE MAPS ROUND TRIP
 * --------------------------
 * The Sarthi drives with Google Maps, not with this app. So the app is
 * backgrounded for most of the run, and iOS discards suspended pages — the
 * Sarthi comes back to a fresh mount. Ticks held only in React state are gone by
 * then, which is the whole reason they go to the ride document.
 *
 * THE DEAD BUTTON
 * ---------------
 * "Complete Ride" was `disabled` until every stop was ticked, and behind that
 * sat a confirmation about stops not being done — a warning no one could ever
 * reach. Worse, one Bhulku who did not come out of the house left the Sarthi with
 * no way to end the run at all, except by ticking a child off as collected. The
 * roster replaces both: always reachable, pre-ticked, and it reports absence
 * honestly instead of quietly recording an arrival that never happened.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateDoc = vi.fn(async () => undefined);
const completeRide = vi.fn(async () => ({
    success: true, rideId: 'ride_1', completedAt: 'now',
    driverStats: { ridesCompletedToday: 1, totalStudentsToday: 2, totalDistanceToday: 4 },
}));

/** The hook's `onFix`, so a test can deliver a GPS reading like a phone would. */
let deliverFix: ((fix: { lat: number; lng: number; accuracy: number }) => void) | null = null;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    updateDoc: (...a: unknown[]) => updateDoc(...(a as [])),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'driver_1' } }),
}));
vi.mock('../../contexts/NavigationContext', () => ({
    useNavigation: () => ({ setFocusMode: vi.fn() }),
}));
vi.mock('../../hooks/useDriverLocation', () => ({
    useDriverLocation: ({ onFix }: any) => { deliverFix = onFix ?? null; },
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    completeRide: (...a: unknown[]) => completeRide(...(a as [])),
    sarthiArrived: vi.fn(async () => ({ success: true, alreadyArrived: false })),
}));
vi.mock('../../src/utils/googleMaps', () => ({
    buildGoogleMapsNavigationUrl: () => 'https://maps.example/x',
    openGoogleMaps: vi.fn(),
}));

import { ActiveRide } from '../../components/driver/ActiveRide';

/** The venue, and two homes far enough apart that neither can be mistaken for the other. */
const SABHA = { lat: 42.339925, lng: -71.088182 };
const HOUSE_A = { lat: 42.350000, lng: -71.088182 };
const HOUSE_B = { lat: 42.360000, lng: -71.088182 };
const DRIVER_HOME = { lat: 42.370000, lng: -71.088182 };

const sharp = (p: { lat: number; lng: number }) => ({ ...p, accuracy: 15 });

function makeRide(overrides: Partial<any> = {}) {
    return {
        id: 'ride_1',
        rideType: 'home-to-sabha' as const,
        students: [
            { id: 'stu_a', name: 'Bhulku A', phone: '1', location: { ...HOUSE_A }, picked: false },
            { id: 'stu_b', name: 'Bhulku B', phone: '2', location: { ...HOUSE_B }, picked: false },
        ],
        route: [
            { ...DRIVER_HOME, name: 'Start', type: 'start' as const, visited: false },
            { ...HOUSE_A, name: 'Bhulku A', type: 'pickup' as const, studentId: 'stu_a', visited: false },
            { ...HOUSE_B, name: 'Bhulku B', type: 'pickup' as const, studentId: 'stu_b', visited: false },
            { ...SABHA, name: 'End', type: 'end' as const, visited: false },
        ],
        googleMapsUrl: 'https://maps.example/x',
        estimatedDistance: 4,
        estimatedTime: 20,
        ...overrides,
    };
}

const renderRide = (ride = makeRide(), onComplete = vi.fn()) => {
    render(<ActiveRide ride={ride as any} onComplete={onComplete} onBack={vi.fn()} />);
    return onComplete;
};

/** The last `route` array written to Firestore. */
const lastRouteWrite = () => {
    const call = [...updateDoc.mock.calls].reverse()
        .find((c: any) => c[1] && 'route' in c[1]);
    return call ? (call as any)[1].route : null;
};

beforeEach(() => {
    vi.clearAllMocks();
    deliverFix = null;
});

describe('progress survives the trip out to Google Maps', () => {
    it('writes a hand-ticked stop to the ride document', async () => {
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /Mark Bhulku A/ }));

        await waitFor(() => expect(lastRouteWrite()).not.toBeNull());
        expect(lastRouteWrite()[1].visited).toBe(true);
        expect(lastRouteWrite()[2].visited).toBe(false);
    });

    it('reads the ticks back off the document on a fresh mount', async () => {
        // What the Sarthi comes back to after iOS has discarded the page.
        const ride = makeRide();
        ride.route[1].visited = true;
        renderRide(ride);

        expect(screen.getByText('1/2 stops')).toBeTruthy();
    });

    it('starts from zero when the document says nothing was collected', () => {
        renderRide();

        expect(screen.getByText('0/2 stops')).toBeTruthy();
    });
});

describe('the geofence ticks stops off on its own', () => {
    it('ticks the stop the car is actually at', async () => {
        renderRide();

        deliverFix!(sharp(HOUSE_A));

        await waitFor(() => expect(screen.getByText('1/2 stops')).toBeTruthy());
        expect(lastRouteWrite()[1].visited).toBe(true);
        expect(lastRouteWrite()[2].visited).toBe(false);
    });

    it('writes nothing at all when the car is nowhere near a stop', async () => {
        renderRide();

        deliverFix!(sharp(SABHA));

        await waitFor(() => expect(screen.getByText('0/2 stops')).toBeTruthy());
        expect(lastRouteWrite()).toBeNull();
    });

    it('refuses a fix too vague to tell one house from another', async () => {
        // Parked outside A's door on a phone that only knows itself to ±300m.
        renderRide();

        deliverFix!({ ...HOUSE_A, accuracy: 300 });

        await waitFor(() => expect(screen.getByText('0/2 stops')).toBeTruthy());
        expect(lastRouteWrite()).toBeNull();
    });

    it('raises the roster on arrival at the venue', async () => {
        renderRide();

        deliverFix!(sharp(HOUSE_A));
        await waitFor(() => expect(screen.getByText('1/2 stops')).toBeTruthy());
        deliverFix!(sharp(SABHA));

        await waitFor(() => expect(screen.getByText('Who travelled?')).toBeTruthy());
    });

    it('does not raise it before the run has started', async () => {
        // A Sarthi whose own home is near the venue must not be asked to confirm
        // a roster while still sitting on their drive.
        renderRide(makeRide({ route: makeRide().route.map(wp => ({ ...wp })) }));

        deliverFix!(sharp(SABHA));

        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByText('Who travelled?')).toBeNull();
    });
});

describe('the roster is the record', () => {
    it('can be reached with stops still open', async () => {
        // The old screen disabled this button until every stop was ticked, which
        // left a Sarthi with a no-show unable to end the run at all.
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));

        expect(screen.getByText('Who travelled?')).toBeTruthy();
    });

    it('pre-ticks everyone, so a normal night is one tap', async () => {
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));
        await userEvent.click(screen.getByRole('button', { name: /complete run/i }));

        await waitFor(() => expect(completeRide).toHaveBeenCalledWith('ride_1', []));
    });

    it('reports only the unticked riders as absent', async () => {
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Bhulku B travelled/ }));
        await userEvent.click(screen.getByRole('button', { name: /complete run/i }));

        await waitFor(() => expect(completeRide).toHaveBeenCalledWith('ride_1', ['stu_b']));
    });

    it('counts only the riders who travelled towards the day', async () => {
        const onComplete = renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Bhulku B travelled/ }));
        await userEvent.click(screen.getByRole('button', { name: /complete run/i }));

        await waitFor(() => expect(onComplete).toHaveBeenCalled());
        expect(onComplete.mock.calls[0][0].students).toBe(1);
    });

    it('says plainly what happens if nobody is ticked', async () => {
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Bhulku A travelled/ }));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Bhulku B travelled/ }));

        expect(screen.getByText(/carrying no one/i)).toBeTruthy();
    });

    it('closes without completing when the Sarthi backs out', async () => {
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));
        await userEvent.click(screen.getByRole('button', { name: /go back/i }));

        expect(completeRide).not.toHaveBeenCalled();
    });

    it('says what went wrong instead of failing silently', async () => {
        completeRide.mockRejectedValueOnce(new Error('offline'));
        renderRide();

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));
        await userEvent.click(screen.getByRole('button', { name: /complete run/i }));

        await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy());
    });
});

describe('the return leg', () => {
    it('tells the Sarthi what ticking someone records', async () => {
        const ride = makeRide({
            rideType: 'sabha-to-home',
            route: [
                { ...SABHA, name: 'Start', type: 'start', visited: false },
                { ...HOUSE_A, name: 'Bhulku A', type: 'dropoff', studentId: 'stu_a', visited: false },
                { ...HOUSE_B, name: 'Bhulku B', type: 'dropoff', studentId: 'stu_b', visited: false },
                { ...DRIVER_HOME, name: 'End', type: 'end', visited: false },
            ],
        });
        renderRide(ride);

        await userEvent.click(screen.getByRole('button', { name: /complete ride/i }));

        expect(screen.getByText(/home safe/i)).toBeTruthy();
    });

    it('ticks a drop-off off the same way', async () => {
        const ride = makeRide({
            rideType: 'sabha-to-home',
            route: [
                { ...SABHA, name: 'Start', type: 'start', visited: false },
                { ...HOUSE_A, name: 'Bhulku A', type: 'dropoff', studentId: 'stu_a', visited: false },
                { ...HOUSE_B, name: 'Bhulku B', type: 'dropoff', studentId: 'stu_b', visited: false },
                { ...DRIVER_HOME, name: 'End', type: 'end', visited: false },
            ],
        });
        renderRide(ride);

        deliverFix!(sharp(HOUSE_B));

        await waitFor(() => expect(screen.getByText('1/2 stops')).toBeTruthy());
        expect(lastRouteWrite()[2].visited).toBe(true);
    });
});
