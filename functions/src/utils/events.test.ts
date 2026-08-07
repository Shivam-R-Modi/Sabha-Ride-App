import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({}), {
        // findCurrentEvent orders by document id.
        FieldPath: { documentId: () => '__name__' },
    }),
}));

import {
    findCurrentEvent, seedFirstEventIfNeeded, weeklySlotDate, eventKeyFromRide,
} from './events';

const ZONE = 'America/New_York';
const boston = (day: string, hhmm: string) => new Date(`2026-08-${day}T${hhmm}:00-04:00`);

// August 2026: 3rd = Mon, 5th = Wed, 7th = Fri, 8th = Sat
const MON = '03', WED = '05', FRI = '07', SAT = '08';

/**
 * Fake Firestore covering everything the events module touches:
 *   collection(name).where().where().orderBy().get()
 *   db.doc('a/b').get() / .set()
 *   db.batch() with .create() / .set() / .commit()
 *
 * Deliberately NAME-AWARE. An earlier version had `collection()` take no argument
 * and close over a single map, so a read of `system/eventGenerator` would have
 * silently returned an events document and every seed test would have passed for
 * the wrong reason. It also honours BOTH range bounds, for the same reason.
 */
function fakeDb(
    events: Record<string, any>,
    other: Record<string, Record<string, any>> = {},
) {
    const store: Record<string, Record<string, any>> = { events, ...other };
    const col = (name: string) => (store[name] ??= {});

    const created: Record<string, any> = {};
    const marked: Record<string, any> = {};

    const alreadyExists = () => {
        const err: any = new Error('ALREADY_EXISTS');
        err.code = 6;
        return err;
    };

    const makeQuery = (name: string) => {
        let lower = '';
        let upper = '\uffff';
        const chain: any = {
            where: (_f: any, op: string, value: string) => {
                if (op === '>=' || op === '>') lower = value;
                else if (op === '<=' || op === '<') upper = value;
                return chain;
            },
            orderBy: () => chain,
            limit: () => chain,
            get: async () => ({
                docs: Object.keys(col(name))
                    .filter(id => id >= lower && id <= upper)
                    .sort()
                    .map(id => ({ id, data: () => col(name)[id] })),
            }),
        };
        return chain;
    };

    const docRef = (name: string, id: string) => ({
        __col: name,
        __id: id,
        get: async () => ({
            exists: id in col(name),
            data: () => col(name)[id],
        }),
        set: async (data: any) => { col(name)[id] = { ...col(name)[id], ...data }; },
        create: async (data: any) => {
            if (id in col(name)) throw alreadyExists();
            col(name)[id] = data;
            created[id] = data;
        },
    });

    const db: any = {
        collection: (name: string) => {
            const q = makeQuery(name);
            return {
                where: q.where, orderBy: q.orderBy, limit: q.limit, get: q.get,
                doc: (id: string) => docRef(name, id),
            };
        },
        // db.doc('system/eventGenerator')
        doc: (path: string) => {
            const [name, id] = path.split('/');
            return docRef(name, id);
        },
        batch: () => {
            const ops: Array<() => void> = [];
            let conflict = false;
            return {
                create: (ref: any, data: any) => {
                    if (ref.__id in col(ref.__col)) conflict = true;
                    ops.push(() => {
                        col(ref.__col)[ref.__id] = data;
                        created[ref.__id] = data;
                    });
                },
                set: (ref: any, data: any) => {
                    ops.push(() => {
                        col(ref.__col)[ref.__id] = { ...col(ref.__col)[ref.__id], ...data };
                        if (ref.__col === 'system') marked[ref.__id] = col(ref.__col)[ref.__id];
                    });
                },
                delete: (ref: any) => {
                    ops.push(() => { delete col(ref.__col)[ref.__id]; });
                },
                commit: async () => {
                    // A create precondition failure rejects the WHOLE commit, so
                    // nothing lands — which is what makes the event and the marker
                    // atomic.
                    if (conflict) throw alreadyExists();
                    ops.forEach(op => op());
                },
            };
        },
    };

    return { db, created, marked, store };
}

const scheduled = (date: string, extra: Record<string, any> = {}) => ({
    date, startTime: '19:00', endTime: '22:00', status: 'scheduled', ...extra,
});

describe('findCurrentEvent', () => {
    it('returns today\'s gathering', async () => {
        const { db } = fakeDb({ '2026-08-07': scheduled('2026-08-07') });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE);
        expect(event?.date).toBe('2026-08-07');
    });

    it('keeps today\'s gathering current after it has ended', async () => {
        // Drop-off rides are still running, and rolling the eventId over would
        // move the attendance key out from under them.
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07'),
            '2026-08-14': scheduled('2026-08-14'),
        });
        const event = await findCurrentEvent(db, boston(FRI, '23:30'), ZONE);
        expect(event?.date).toBe('2026-08-07');
    });

    it('rolls on to the next once the day is over', async () => {
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07'),
            '2026-08-14': scheduled('2026-08-14'),
        });
        const event = await findCurrentEvent(db, boston(SAT, '00:30'), ZONE);
        expect(event?.date).toBe('2026-08-14');
    });

    it('skips a cancelled gathering', async () => {
        // Cancelling next Friday must roll everything on, not close the service.
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07', { status: 'cancelled' }),
            '2026-08-14': scheduled('2026-08-14'),
        });
        const event = await findCurrentEvent(db, boston(MON, '10:00'), ZONE);
        expect(event?.date).toBe('2026-08-14');
    });

    it('returns null when the calendar is empty', async () => {
        const { db } = fakeDb({});
        expect(await findCurrentEvent(db, boston(FRI, '10:00'), ZONE)).toBeNull();
    });

    it('returns null when everything ahead is cancelled', async () => {
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07', { status: 'cancelled' }),
        });
        expect(await findCurrentEvent(db, boston(MON, '10:00'), ZONE)).toBeNull();
    });

    it('ignores gatherings already in the past', async () => {
        const { db } = fakeDb({ '2026-07-31': scheduled('2026-07-31') });
        expect(await findCurrentEvent(db, boston(FRI, '10:00'), ZONE)).toBeNull();
    });

    it('carries the venue override and agenda through', async () => {
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07', {
                venue: { lat: 42.1, lng: -71.1, address: 'Hall B' },
                agenda: 'Youth sabha',
            }),
        });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE);
        expect(event?.venue).toEqual({ lat: 42.1, lng: -71.1, address: 'Hall B' });
        expect(event?.agenda).toBe('Youth sabha');
    });

    it('repairs a malformed time rather than propagating it', async () => {
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07', { startTime: 'evening', endTime: null }),
        });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE);
        expect(event?.startTime).toBe('19:00');
        expect(event?.endTime).toBe('22:00');
    });

    it('drops a venue override missing coordinates', async () => {
        // A venue with no lat/lng would poison clustering and routing.
        const { db } = fakeDb({
            '2026-08-07': scheduled('2026-08-07', { venue: { address: 'Somewhere' } }),
        });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE);
        expect(event?.venue).toBeNull();
    });
});

describe('weeklySlotDate', () => {
    it('finds the next Friday, counting today', () => {
        expect(weeklySlotDate(boston(WED, '10:00'), ZONE, 5, 0)).toBe('2026-08-07');
        expect(weeklySlotDate(boston(FRI, '10:00'), ZONE, 5, 0)).toBe('2026-08-07');
    });

    it('steps a week at a time', () => {
        expect(weeklySlotDate(boston(WED, '10:00'), ZONE, 5, 1)).toBe('2026-08-14');
        expect(weeklySlotDate(boston(WED, '10:00'), ZONE, 5, 4)).toBe('2026-09-04');
    });

    it('rolls past the weekend on Saturday', () => {
        expect(weeklySlotDate(boston(SAT, '10:00'), ZONE, 5, 0)).toBe('2026-08-14');
    });
});

describe('eventKeyFromRide', () => {
    it('prefers the server-written eventId', () => {
        // globalAssignDriver copies this off system/rideContext at assignment.
        expect(eventKeyFromRide({ eventId: '2026-08-07', eventDate: '2026-08-14' }))
            .toBe('2026-08-07');
    });

    it('falls back to eventDate when there is no eventId', () => {
        // Rides requested before eventId was written carry only eventDate.
        expect(eventKeyFromRide({ eventDate: '2026-08-07' })).toBe('2026-08-07');
    });

    it('returns null when the ride cannot say which sabha it served', () => {
        expect(eventKeyFromRide({})).toBeNull();
        expect(eventKeyFromRide(null)).toBeNull();
        expect(eventKeyFromRide(undefined)).toBeNull();
    });

    it('rejects anything that is not a plain YYYY-MM-DD key', () => {
        // The value becomes a document id. A timestamp or a Date would silently
        // create a second statistics document for the same gathering — which is
        // the exact bug this helper exists to close, in a new disguise.
        expect(eventKeyFromRide({ eventId: '2026-08-07T00:00:00.000Z' })).toBeNull();
        expect(eventKeyFromRide({ eventId: new Date('2026-08-07') })).toBeNull();
        expect(eventKeyFromRide({ eventId: 20260807 })).toBeNull();
        expect(eventKeyFromRide({ eventId: '' })).toBeNull();
        expect(eventKeyFromRide({ eventId: '2026-8-7' })).toBeNull();
    });

    it('skips a malformed eventId rather than trusting it over a good eventDate', () => {
        expect(eventKeyFromRide({ eventId: null, eventDate: '2026-08-07' })).toBe('2026-08-07');
        expect(eventKeyFromRide({ eventId: 'today', eventDate: '2026-08-07' })).toBe('2026-08-07');
    });
});

describe('seedFirstEventIfNeeded', () => {
    const defaults = { startTime: '19:00', endTime: '22:00' };
    const run = (
        day: string,
        events: Record<string, any>,
        other: Record<string, Record<string, any>> = {},
        dow = 5,
    ) => {
        const f = fakeDb(events, other);
        return seedFirstEventIfNeeded(f.db, boston(day, '03:00'), ZONE, defaults, dow)
            .then(dates => ({ dates, ...f }));
    };

    it('seeds exactly one gathering on a fresh project', async () => {
        const { dates, created, store } = await run(WED, {});

        expect(dates).toEqual(['2026-08-07']);
        expect(Object.keys(created)).toEqual(['2026-08-07']);
        expect(created['2026-08-07'].autoCreated).toBe(true);
        expect(created['2026-08-07'].status).toBe('scheduled');
        // And the marker landed in the same commit.
        expect(store.system['eventGenerator'].seededAt).toBeTruthy();
        expect(store.system['eventGenerator'].seededDate).toBe('2026-08-07');
    });

    it('never seeds again once the marker is set — even with an empty calendar', async () => {
        // The whole point. This is what makes deletion stick: previously an empty
        // slot was recreated within 60 seconds by the per-minute self-heal.
        const { dates, created } = await run(WED, {}, {
            system: { eventGenerator: { seededAt: '2026-08-01T00:00:00.000Z' } },
        });

        expect(dates).toEqual([]);
        expect(created).toEqual({});
    });

    it('does not seed when the manager has already filled the calendar', async () => {
        const { dates, created, store } = await run(WED, {
            '2026-08-14': scheduled('2026-08-14'),
        });

        expect(dates).toEqual([]);
        expect(created).toEqual({});
        // But it records the marker, so a later deletion cannot make it seed.
        expect(store.system['eventGenerator'].seededAt).toBeTruthy();
    });

    it('treats a missing marker as not-yet-seeded rather than closing the service', async () => {
        const { dates } = await run(WED, {}, { system: {} });
        expect(dates).toEqual(['2026-08-07']);
    });

    it('treats a malformed marker as not-yet-seeded, and does not throw', async () => {
        // Biased towards seeding. This runs in a job whose failure mode is "no
        // rides at all", so a corrupt marker must not strand anyone.
        for (const bad of [{ seededAt: null }, { seededAt: 42 }, { seededAt: '' }, {}]) {
            const { dates } = await run(WED, {}, { system: { eventGenerator: bad } });
            expect(dates).toEqual(['2026-08-07']);
        }
    });

    it('seeds today when today is the sabha day', async () => {
        // weeklySlotDate(..., 0) returns today on the slot day. Skipping it would
        // mean a fresh deploy on a Friday morning closes rides for a sabha that
        // evening.
        const { dates } = await run(FRI, {});
        expect(dates).toEqual(['2026-08-07']);
    });

    it('leaves the marker unset when the commit loses a race', async () => {
        // The event already exists, so batch.create's precondition rejects the
        // whole commit — neither the event nor the marker is written, and the next
        // run sees a populated calendar and records the marker properly.
        const { dates, created, store } = await run(WED, {
            '2026-08-07': scheduled('2026-08-07'),
        });

        expect(dates).toEqual([]);
        expect(created).toEqual({});
        // findCurrentEvent found it first, so this took the already-populated path.
        expect(store.system['eventGenerator'].seededAt).toBeTruthy();
    });

    it('uses the default times it is given', async () => {
        const { created } = await run(WED, {}, {}, 5);
        expect(created['2026-08-07'].startTime).toBe('19:00');
        expect(created['2026-08-07'].endTime).toBe('22:00');
    });

    it('can seed a slot other than Friday', async () => {
        const { dates } = await run(MON, {}, {}, 2); // Tuesday
        expect(dates).toEqual(['2026-08-04']);
    });

    it('ignores a cancelled event when deciding whether to seed', async () => {
        // A legacy cancelled document must not be mistaken for a populated
        // calendar, or a fresh project with only cancelled events never seeds.
        const { dates } = await run(WED, {
            '2026-08-07': scheduled('2026-08-07', { status: 'cancelled' }),
        });
        expect(dates).toEqual(['2026-08-14']);
    });
});
