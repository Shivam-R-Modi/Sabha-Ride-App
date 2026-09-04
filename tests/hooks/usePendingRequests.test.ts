/**
 * The manager's Waiting queue lists only riders a driver could actually be given.
 *
 * `globalAssignDriver` dispatches from a pool scoped to the gathering and the
 * direction on `system/rideContext`. This hook listed every `requested` ride in
 * the collection, so the two disagreed in public: on 2026-08-14 the tab read
 * "Waiting · 4" while a driver tapping Assign Me was told "Nobody is waiting
 * right now".
 *
 * `isDispatchable` has its own tests in tests/utils/ridePool.test.ts. These
 * assert something different and, on the evidence, more necessary: that the hook
 * CALLS it. Deleting the filter line broke none of those unit tests — a correct
 * predicate nobody invokes is the same bug in a new place, and this codebase has
 * produced that shape three times in two days.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rides the fake snapshot will deliver. */
let docs: Array<{ id: string; data: Record<string, unknown> }> = [];
/** What the server has published as the open window. */
let context: { eventId: string | null; rideType: string | null } = {
    eventId: '2026-08-14', rideType: 'home-to-sabha',
};

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), query: vi.fn(), where: vi.fn(), doc: vi.fn(),
    updateDoc: vi.fn(),
    onSnapshot: (_q: unknown, next: any) => {
        next({ forEach: (fn: any) => docs.forEach(d => fn({ id: d.id, data: () => d.data })) });
        return () => undefined;
    },
}));
vi.mock('../../firebase/config', () => ({ db: {}, auth: {} }));
/**
 * ONE HALL by default. The queue NAMES a hall only when more than one is open, so with
 * one nothing appears on screen and every case here is unchanged.
 */
const HUNTINGTON = { id: 'boston-huntington', name: 'Huntington', active: true, order: 0, venue: { lat: 42.3, lng: -71.0, address: 'a' } };
const SOMERVILLE = { id: 'somerville', name: 'Somerville', active: true, order: 1, venue: { lat: 42.4, lng: -71.1, address: 'b' } };
let openHalls: Array<typeof HUNTINGTON> = [HUNTINGTON];
vi.mock('../../hooks/useLocations', () => ({
    useLocations: () => ({ locations: openHalls, active: openHalls, loading: false, error: null }),
}));

vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => context }));

import { usePendingRequests } from '../../hooks/useUsers';

const ride = (id: string, data: Record<string, unknown>) => ({
    id, data: { studentName: id, pickupAddress: '1 St', ...data },
});

const names = async () => {
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));
    return result.current.requests.map(r => r.name);
};

beforeEach(() => {
    context = { eventId: '2026-08-14', rideType: 'home-to-sabha' };
    docs = [];
    openHalls = [HUNTINGTON];
});

describe('usePendingRequests — scoped to the open window', () => {
    it('lists a pickup during the pickup window', async () => {
        // No rideType field, which is what hooks/useRides.ts writes.
        docs = [ride('Rebo', { eventDate: '2026-08-14' })];

        expect(await names()).toEqual(['Rebo']);
    });

    it('EXCLUDES a leftover pickup once the window is drop-off', async () => {
        // The reported disagreement, exactly.
        context = { eventId: '2026-08-14', rideType: 'sabha-to-home' };
        docs = [ride('Rebo', { eventDate: '2026-08-14' })];

        expect(await names()).toEqual([]);
    });

    it('lists a genuine drop-off during the drop-off window', async () => {
        context = { eventId: '2026-08-14', rideType: 'sabha-to-home' };
        docs = [ride('Joka', { eventDate: '2026-08-14', rideType: 'sabha-to-home' })];

        expect(await names()).toEqual(['Joka']);
    });

    it('excludes a request left over from a previous sabha', async () => {
        docs = [ride('Stale', { eventDate: '2026-08-09' })];

        expect(await names()).toEqual([]);
    });

    it('keeps tonight and drops last week from one mixed queue', async () => {
        docs = [
            ride('Stale', { eventDate: '2026-08-09' }),
            ride('Tonight', { eventDate: '2026-08-14' }),
        ];

        expect(await names()).toEqual(['Tonight']);
    });

    it('shows nothing when no window is published', async () => {
        // Both are null when no sabha is scheduled. A queue nobody can act on
        // invites a manager to look for a fault in dispatch.
        context = { eventId: null, rideType: null };
        docs = [ride('Rebo', { eventDate: '2026-08-14' })];

        expect(await names()).toEqual([]);
    });

    it('still carries the seat count for the rows it keeps', async () => {
        // The filter must not quietly drop the fields the queue renders.
        docs = [ride('Family', { eventDate: '2026-08-14', seatsRequested: 4 })];

        const { result } = renderHook(() => usePendingRequests());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.requests[0].seats).toBe(4);
    });
});

/**
 * WHICH SABHA A WAITING RIDER IS GOING TO.
 *
 * Not a filter — every hall's riders belong in this queue, because a manager oversees
 * both. What a manager could not see is WHICH, and the cost is a wasted tap:
 * `manualAssignStudent` refuses to add a rider to a Sarthi's car when the halls
 * differ, so assigning by hand produced an error the screen could have prevented.
 */
describe('usePendingRequests — which sabha each rider wants', () => {
    const rows = async () => {
        const { result } = renderHook(() => usePendingRequests());
        await waitFor(() => expect(result.current.loading).toBe(false));
        return result.current.requests;
    };

    it('says nothing with one hall, so the queue is unchanged', async () => {
        openHalls = [HUNTINGTON];
        docs = [ride('Rebo', { eventDate: '2026-08-14', locationId: 'boston-huntington' })];

        const [row] = await rows();
        expect(row.locationName).toBeUndefined();
        // The id is still carried, for anything that needs to compare.
        expect(row.locationId).toBe('boston-huntington');
    });

    it('NAMES the hall once two are open', async () => {
        // The name, not the id: `boston-huntington` is not what anybody calls it.
        openHalls = [HUNTINGTON, SOMERVILLE];
        docs = [ride('Rebo', { eventDate: '2026-08-14', locationId: 'somerville' })];

        expect((await rows())[0].locationName).toBe('Somerville');
    });

    it('KEEPS both halls in the queue rather than filtering', async () => {
        // A manager oversees both. Hiding one hall's riders would be the 2026-08-14
        // defect from a new cause — a count that does not match what is waiting.
        openHalls = [HUNTINGTON, SOMERVILLE];
        docs = [
            ride('Rebo', { eventDate: '2026-08-14', locationId: 'boston-huntington' }),
            ride('Asha', { eventDate: '2026-08-14', locationId: 'somerville' }),
        ];

        const list = await rows();
        expect(list).toHaveLength(2);
        expect(list.map(r => r.locationName).sort()).toEqual(['Huntington', 'Somerville']);
    });

    it('leaves the name blank for a hall that is no longer open, rather than relabelling', async () => {
        // The row must not silently claim a different hall. `scripts/locations.cjs
        // verify` is what finds requests pointing at a hall that does not exist.
        openHalls = [HUNTINGTON, SOMERVILLE];
        docs = [ride('Rebo', { eventDate: '2026-08-14', locationId: 'cambridge' })];

        const [row] = await rows();
        expect(row.locationName).toBeUndefined();
        expect(row.locationId).toBe('cambridge');
    });

    it('leaves both blank for a request that named no hall', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        docs = [ride('Rebo', { eventDate: '2026-08-14' })];

        const [row] = await rows();
        expect(row.locationId).toBeUndefined();
        expect(row.locationName).toBeUndefined();
    });
});
