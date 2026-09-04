/**
 * A rider who made their own way to sabha must still be able to get home.
 *
 * THE BUG
 * -------
 * This function refused anyone whose stored status was not `at_sabha`, and
 * `at_sabha` is written in exactly one place: when a home→sabha ride completes.
 * So the real rule was "you may request a ride home only if this app drove you
 * here", and everyone who walked, drove themselves or got a lift was permanently
 * locked out — while still being shown the button.
 *
 * The presence claim replaces it. It is RECORDED, NEVER ENFORCED: the client
 * always offers a manual route, so nothing here can be trusted against a
 * determined caller and nothing here is allowed to strand one either.
 *
 * This file is also the first test coverage this function has ever had.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));
vi.mock('../utils/settings', () => ({
    locationsOrFoundingFallback: async () => openHalls,
}));

import { studentReadyToLeave, normalisePresence } from './studentReadyToLeave';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';

/**
 * Which halls are open, per case. ONE by default — the configuration every case in
 * this file was written against, and the one that holds until a manager adds a second.
 */
const FOUNDING_HALL = {
    id: FOUNDING_LOCATION_ID, name: 'Sabha', active: true, order: 0,
    venue: { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' },
};
const SOMERVILLE_HALL = {
    id: 'somerville', name: 'Somerville', active: true, order: 1,
    venue: { lat: 42.387, lng: -71.099, address: '5 Elm Street' },
};
let openHalls: Array<typeof FOUNDING_HALL> = [FOUNDING_HALL];

const HOME = { lat: 42.3339, lng: -71.0311 };

function makeDb(opts: { student?: any; rides?: any[]; context?: any } = {}) {
    const writes: Array<{ path: string; data: any }> = [];
    const rides = opts.rides ?? [];
    // `accountStatus` and `roles` are DEFAULTS that an override can replace.
    // studentReadyToLeave now calls assertApprovedStudent: it used to check only
    // that the caller was acting for themselves, so a pending or rejected account
    // could file a drop-off request and hand its own address to whoever tapped next.
    const student = {
        accountStatus: 'approved', roles: ['student'],
        ...(opts.student ?? {
            name: 'Rebo Fe', address: '15 Central Sq', status: 'home_safe',
            // The shape resolveHomeCoords actually reads — what ProfileSetup writes.
            location: { latitude: HOME.lat, longitude: HOME.lng },
        }),
    };
    const context = opts.context ?? { rideType: 'sabha-to-home', eventId: '2026-08-14' };

    const collection = (name: string) => {
        const chain: any = {
            doc: (id: string) => ({
                id,
                path: `${name}/${id}`,
                get: async () => ({
                    exists: true,
                    data: () => (name === 'system' ? context : student),
                }),
                set: async (data: any) => { writes.push({ path: `${name}/${id}`, data }); },
                update: async (data: any) => { writes.push({ path: `${name}/${id}`, data }); },
            }),
            where: () => chain,
            get: async () => ({
                empty: rides.length === 0,
                docs: rides.map((r, i) => ({
                    id: r.id ?? `ride${i}`,
                    ref: {
                        path: `rides/${r.id ?? `ride${i}`}`,
                        update: async (data: any) => {
                            writes.push({ path: `rides/${r.id ?? `ride${i}`}`, data });
                        },
                    },
                    data: () => r,
                })),
            }),
        };
        return chain;
    };

    db = { collection, doc: (p: string) => collection(p.split('/')[0]).doc(p.split('/')[1]) };
    return writes;
}

const call = (data: any = {}) =>
    (studentReadyToLeave as any)({ studentId: 'stu_1', ...data }, { auth: { uid: 'stu_1' } });

const rideWrite = (w: Array<{ path: string; data: any }>) =>
    w.find(x => x.path.startsWith('rides/'))?.data;

beforeEach(() => {
    vi.clearAllMocks();
    openHalls = [FOUNDING_HALL];
});

describe('normalisePresence', () => {
    it('keeps a genuine pickup claim when the record agrees', () => {
        expect(normalisePresence({ method: 'pickup' }, 'at_sabha')).toEqual({ method: 'pickup' });
    });

    it('downgrades a pickup claim the record does not support', () => {
        // The one claim the server can check. Downgraded rather than refused —
        // the rider still gets their lift, the board just tells the truth.
        expect(normalisePresence({ method: 'pickup' }, 'home_safe').method).toBe('manual');
    });

    it('records auto and manual as given', () => {
        expect(normalisePresence({ method: 'auto', distanceMeters: 40 }, 'home_safe'))
            .toEqual({ method: 'auto', distanceMeters: 40 });
        expect(normalisePresence({ method: 'manual', distanceMeters: 5100 }, 'home_safe'))
            .toEqual({ method: 'manual', distanceMeters: 5100 });
    });

    it('never rejects — a missing claim becomes unknown, not an error', () => {
        // An older cached bundle sends nothing. Refusing would strand a rider
        // because of their own service worker.
        expect(normalisePresence(undefined, 'home_safe')).toEqual({ method: 'unknown' });
        expect(normalisePresence(null, 'home_safe')).toEqual({ method: 'unknown' });
        expect(normalisePresence('at sabha!', 'home_safe')).toEqual({ method: 'unknown' });
        expect(normalisePresence({ method: 'teleported' }, 'home_safe')).toEqual({ method: 'unknown' });
    });

    it('drops nonsense numbers rather than storing them', () => {
        const out = normalisePresence(
            { method: 'manual', distanceMeters: -5, accuracyMeters: NaN }, 'home_safe');

        expect(out).toEqual({ method: 'manual' });
    });

    it('never accepts coordinates', () => {
        // Precise location for a child is a category of data this app should not
        // hold, and the fallback means the verdict was never enforceable anyway.
        const out: any = normalisePresence(
            { method: 'auto', lat: 42.1, lng: -71.2, distanceMeters: 30 }, 'home_safe');

        expect(out.lat).toBeUndefined();
        expect(out.lng).toBeUndefined();
        expect(Object.keys(out).sort()).toEqual(['distanceMeters', 'method']);
    });
});

describe('studentReadyToLeave — who may ask', () => {
    it('lets a rider who made their own way join the queue', async () => {
        // The whole bug. This person never took a pickup, so their status is
        // whatever it was before — and they were locked out for ever.
        const writes = makeDb({ student: { name: 'Rebo Fe', status: 'home_safe', location: { latitude: HOME.lat, longitude: HOME.lng } } });

        const result = await call({ presence: { method: 'manual' } });

        expect(result.success).toBe(true);
        expect(rideWrite(writes).rideType).toBe('sabha-to-home');
    });

    it('lets a rider with no status at all join the queue', async () => {
        // Signup writes no status, and the nightly sweep now removes it again.
        const writes = makeDb({ student: { name: 'New Person', location: { latitude: HOME.lat, longitude: HOME.lng } } });

        await call({ presence: { method: 'manual' } });

        expect(rideWrite(writes)).toBeDefined();
    });

    it('still refuses when the drop-off window is shut', async () => {
        makeDb({ context: { rideType: 'home-to-sabha', timeContext: 'Sabha starts at 7pm' } });

        await expect(call({ presence: { method: 'manual' } }))
            .rejects.toThrow(/not open yet/i);
    });

    it('still refuses someone asking on another rider\'s behalf', async () => {
        makeDb();

        await expect((studentReadyToLeave as any)(
            { studentId: 'stu_1', presence: { method: 'manual' } },
            { auth: { uid: 'someone_else' } },
        )).rejects.toThrow(/only the bhulku/i);
    });

    it('still refuses when no home address is set, and says so', async () => {
        // The real precondition, and the one that stays loud.
        makeDb({ student: { name: 'Rebo Fe', status: 'at_sabha' } });

        await expect(call({ presence: { method: 'pickup' } }))
            .rejects.toThrow(/home address/i);
    });
});

describe('studentReadyToLeave — the presence claim is recorded', () => {
    it('stamps the claim on a new ride', async () => {
        const writes = makeDb();

        await call({ presence: { method: 'manual', distanceMeters: 5100 } });

        expect(rideWrite(writes).presence).toEqual({ method: 'manual', distanceMeters: 5100 });
    });

    it('records an implausible claim rather than blocking it', async () => {
        // GPS said 5km. They said they are here. They get their ride, and the
        // manager can see both facts.
        const writes = makeDb();

        const result = await call({ presence: { method: 'manual', distanceMeters: 5100 } });

        expect(result.success).toBe(true);
        expect(rideWrite(writes).presence.distanceMeters).toBe(5100);
    });

    it('stamps unknown when an old client sends nothing', async () => {
        const writes = makeDb();

        await call({});

        expect(rideWrite(writes).presence).toEqual({ method: 'unknown' });
    });

    it('refreshes the claim on a reused ride', async () => {
        // Asked once, then re-tapped after GPS settled: show the better evidence.
        const writes = makeDb({
            rides: [{ id: 'existing', rideType: 'sabha-to-home', status: 'requested' }],
        });

        await call({ presence: { method: 'auto', distanceMeters: 30 } });

        expect(writes.find(w => w.path === 'rides/existing')!.data.presence)
            .toEqual({ method: 'auto', distanceMeters: 30 });
    });

    it('never writes coordinates onto the ride', async () => {
        const writes = makeDb();

        await call({ presence: { method: 'auto', lat: 42.1, lng: -71.2, distanceMeters: 30 } });

        expect(JSON.stringify(rideWrite(writes).presence)).not.toMatch(/42\.1|-71\.2/);
    });
});

/**
 * WHICH HALL IS THIS RIDER LEAVING FROM?
 *
 * The sharpest problem in the multi-hall change. A drop-off request carries the
 * rider's HOME coordinates — `pickupLat`/`pickupLng` are where they are going, not
 * where they are being collected — so nothing on the request itself says which
 * building to start from. Get it wrong and a Sarthi leaving one hall is handed
 * somebody standing at the other, and no field anywhere could catch it.
 */
describe('studentReadyToLeave — which hall they are leaving from', () => {
    it('stamps the hall on the return ride', async () => {
        const writes = makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'at_sabha',
                atLocationId: FOUNDING_LOCATION_ID,
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
        });
        await call({ presence: { method: 'pickup' } });

        expect(rideWrite(writes).locationId).toBe(FOUNDING_LOCATION_ID);
    });

    it('reads it from where their outbound ride left them', async () => {
        openHalls = [FOUNDING_HALL, SOMERVILLE_HALL];
        const writes = makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'at_sabha',
                atLocationId: 'somerville',
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
            context: {
                rideType: 'home-to-sabha',
                byLocation: {
                    [FOUNDING_LOCATION_ID]: { rideType: 'home-to-sabha', eventId: '2026-08-14' },
                    somerville: { rideType: 'sabha-to-home', eventId: '2026-08-14__somerville' },
                },
            },
        });
        await call({ presence: { method: 'pickup' } });

        expect(rideWrite(writes).locationId).toBe('somerville');
    });

    it('gates on THAT hall\'s window, not the document top level', async () => {
        // The top level is the founding hall's window. A rider at Somerville must not
        // be told drop-off is closed because Huntington's sabha is still running.
        openHalls = [FOUNDING_HALL, SOMERVILLE_HALL];
        makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'at_sabha',
                atLocationId: 'somerville',
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
            context: {
                rideType: 'home-to-sabha',
                timeContext: 'Sabha is in progress',
                byLocation: {
                    [FOUNDING_LOCATION_ID]: { rideType: 'home-to-sabha' },
                    somerville: { rideType: 'home-to-sabha' },
                },
            },
        });

        // Somerville's own slice says pickup, so drop-off really is closed there.
        await expect(call({ presence: { method: 'pickup' } }))
            .rejects.toThrow(/not open yet/i);
    });

    it('writes the DATE on the return ride, not a suffixed gathering key', async () => {
        // `eventId` for a non-founding hall is `2026-08-14__somerville`, while a ride's
        // own `eventDate` is always the bare date. Written raw, this request would
        // match no gathering and the rider would never be dispatched.
        openHalls = [FOUNDING_HALL, SOMERVILLE_HALL];
        const writes = makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'at_sabha',
                atLocationId: 'somerville',
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
            context: {
                rideType: 'sabha-to-home',
                byLocation: {
                    somerville: { rideType: 'sabha-to-home', eventId: '2026-08-14__somerville' },
                },
            },
        });
        await call({ presence: { method: 'pickup' } });

        expect(rideWrite(writes).eventDate).toBe('2026-08-14');
        expect(rideWrite(writes).date).toBe('2026-08-14');
    });

    it('falls back to the only hall when they walked in and there is just one', async () => {
        // Somebody who walked, drove themselves or got a lift from a friend has no
        // outbound ride and therefore no `atLocationId`. With one hall that cannot be
        // ambiguous, and refusing them would strand the population
        // `normalisePresence` exists for.
        const writes = makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'home_safe',
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
        });
        await call({ presence: { method: 'manual' } });

        expect(rideWrite(writes).locationId).toBe(FOUNDING_LOCATION_ID);
    });

    it('REFUSES rather than guessing when they walked in and two halls are open', async () => {
        // A plausible answer here sends a car to the wrong building and nothing
        // surfaces. A refusal is a message on the rider's own screen — which the
        // release that adds the hall picker turns into a question.
        openHalls = [FOUNDING_HALL, SOMERVILLE_HALL];
        makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'home_safe',
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
        });

        await expect(call({ presence: { method: 'manual' } }))
            .rejects.toThrow(/not sure which sabha/i);
    });

    it('refuses a stale hall that is no longer open', async () => {
        // A week-old `atLocationId` for a hall a manager has since retired. Same class
        // as the stale `at_sabha` that `clearEndOfEveningStatuses` exists to sweep.
        openHalls = [SOMERVILLE_HALL, FOUNDING_HALL];
        makeDb({
            student: {
                name: 'Rebo', address: '15 Central Sq', status: 'at_sabha',
                atLocationId: 'cambridge',
                location: { latitude: HOME.lat, longitude: HOME.lng },
            },
        });

        await expect(call({ presence: { method: 'pickup' } }))
            .rejects.toThrow(/not sure which sabha/i);
    });
});
