import { describe, it, expect, vi } from 'vitest';

import { findCurrentEvent, eventKeyFromRide } from './events';
import type { RecurrenceRule } from './recurrence';

vi.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({}), {
        // findCurrentEvent orders by document id.
        FieldPath: { documentId: () => '__name__' },
    }),
}));


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

/**
 * A document is an EXCEPTION now, not a gathering.
 *
 * `findCurrentEvent` used to answer from the events collection alone: the first
 * scheduled document ahead of today was the next sabha. Under the rule model the
 * schedule lives in `settings/sabhaRecurrence` and these documents only say how a
 * particular date DIVERGES from it.
 *
 * The consequence worth testing: a bare document with no `kind` is read as an
 * override, so it is inert on a date the rule does not cover. That is the
 * conservative direction — a stale document cannot invent a gathering nobody
 * scheduled — and it is why the old expectations here could not simply be ported.
 */
describe('findCurrentEvent — rule plus exceptions', () => {
    /** Every Friday, 19:00–22:00. */
    const fridays: RecurrenceRule = {
        enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
        venue: null, agenda: '',
    };

    it('returns today\'s gathering from the rule, with no documents at all', async () => {
        const { db } = fakeDb({});
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE, fridays);
        expect(event).toMatchObject({ date: '2026-08-07', startTime: '19:00', autoCreated: true });
    });

    it('keeps today\'s gathering current after it has ended', async () => {
        // Drop-off rides are still running, and rolling the eventId over would
        // move the attendance key out from under them.
        const { db } = fakeDb({});
        const event = await findCurrentEvent(db, boston(FRI, '23:30'), ZONE, fridays);
        expect(event?.date).toBe('2026-08-07');
    });

    it('rolls on to the next once the day is over', async () => {
        const { db } = fakeDb({});
        const event = await findCurrentEvent(db, boston(SAT, '00:30'), ZONE, fridays);
        expect(event?.date).toBe('2026-08-14');
    });

    it('skips a cancelled week and rolls to the following one', async () => {
        const { db } = fakeDb({ '2026-08-07': { status: 'cancelled' } });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE, fridays);
        expect(event?.date).toBe('2026-08-14');
    });

    it('takes an override\'s own times for that week only', async () => {
        const { db } = fakeDb({
            '2026-08-07': {
                kind: 'override', status: 'scheduled', startTime: '17:00', endTime: '19:00',
            },
        });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE, fridays);
        expect(event).toMatchObject({ startTime: '17:00', endTime: '19:00', autoCreated: false });
    });

    it('returns null when no rule is set and there are no one-offs', async () => {
        // Honestly closed. The calendar says so beside the control that fixes it,
        // rather than a seeded date nobody asked for.
        const { db } = fakeDb({});
        expect(await findCurrentEvent(db, boston(FRI, '10:00'), ZONE, null)).toBeNull();
    });

    it('returns null while the rule is switched off', async () => {
        const { db } = fakeDb({});
        expect(await findCurrentEvent(db, boston(FRI, '10:00'), ZONE,
            { ...fridays, enabled: false })).toBeNull();
    });

    it('finds a one-off with no rule at all', async () => {
        const { db } = fakeDb({
            '2026-08-05': {
                kind: 'one-off', status: 'scheduled', startTime: '18:00', endTime: '20:00',
            },
        });
        const event = await findCurrentEvent(db, boston(WED, '10:00'), ZONE, null);
        // `source` lives on Occurrence, not on the SabhaEvent this returns.
        expect(event).toMatchObject({ date: '2026-08-05', startTime: '18:00', endTime: '20:00' });
    });

    it('prefers a one-off earlier in the week over the rule\'s Friday', async () => {
        const { db } = fakeDb({
            '2026-08-05': {
                kind: 'one-off', status: 'scheduled', startTime: '18:00', endTime: '20:00',
            },
        });
        const event = await findCurrentEvent(db, boston(MON, '10:00'), ZONE, fridays);
        expect(event?.date).toBe('2026-08-05');
    });

    it('treats a document with no kind as an override — INERT off the pattern', async () => {
        // A Wednesday document predating this model must not become a gathering.
        const { db } = fakeDb({
            '2026-08-05': { status: 'scheduled', startTime: '18:00', endTime: '20:00' },
        });
        const event = await findCurrentEvent(db, boston(WED, '10:00'), ZONE, fridays);
        expect(event?.date).toBe('2026-08-07');
    });

    it('ignores dates already in the past', async () => {
        const { db } = fakeDb({});
        const event = await findCurrentEvent(db, boston(SAT, '12:00'), ZONE, fridays);
        expect(event?.date).toBe('2026-08-14');
    });

    it('carries the rule\'s venue and agenda through', async () => {
        const venue = { lat: 42.3, lng: -71.1, address: 'Hall' };
        const { db } = fakeDb({});
        const event = await findCurrentEvent(
            db, boston(FRI, '10:00'), ZONE, { ...fridays, venue, agenda: 'Kirtan' });
        expect(event).toMatchObject({ venue, agenda: 'Kirtan' });
    });

    it('drops a venue override missing coordinates rather than passing junk on', async () => {
        const { db } = fakeDb({
            '2026-08-07': {
                kind: 'override', status: 'scheduled', startTime: '19:00', endTime: '22:00',
                venue: { address: 'no coordinates' },
            },
        });
        const event = await findCurrentEvent(db, boston(FRI, '10:00'), ZONE, fridays);
        expect(event?.venue).toBeNull();
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

/**
 * `weeklySlotDate` and `seedFirstEventIfNeeded` had 15 tests between them. Both
 * functions are gone: they existed to place and materialise gatherings, and the
 * rule places them without writing anything. The tests are deleted rather than
 * ported because there is no behaviour left to assert — see the note at the foot
 * of utils/events.ts.
 */
