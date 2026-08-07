import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({}), {
        // findCurrentEvent orders by document id.
        FieldPath: { documentId: () => '__name__' },
    }),
}));

import {
    findCurrentEvent, ensureUpcomingScheduled, weeklySlotDate, CALENDAR_HORIZON_DAYS,
} from './events';

const ZONE = 'America/New_York';
const boston = (day: string, hhmm: string) => new Date(`2026-08-${day}T${hhmm}:00-04:00`);

// August 2026: 3rd = Mon, 5th = Wed, 7th = Fri, 8th = Sat
const MON = '03', WED = '05', FRI = '07', SAT = '08';

/**
 * Minimal fake of the query chain the events module uses:
 *   collection().where().where().orderBy().get()
 *
 * It must honour BOTH bounds. An earlier version kept a single `lowerBound` that
 * each `where` overwrote, which would have made the horizon tests pass for the
 * wrong reason — the upper bound would simply have been ignored.
 */
function fakeDb(events: Record<string, any>) {
    const created: Record<string, any> = {};

    const makeChain = () => {
        let lower = '';
        let upper = '\uffff';
        const chain: any = {
            where: (_field: any, op: string, value: string) => {
                if (op === '>=' || op === '>') lower = value;
                else if (op === '<=' || op === '<') upper = value;
                return chain;
            },
            orderBy: () => chain,
            limit: () => chain,
            get: async () => ({
                docs: Object.keys(events)
                    .filter(id => id >= lower && id <= upper)
                    .sort()
                    .map(id => ({ id, data: () => events[id] })),
            }),
        };
        return chain;
    };

    return {
        db: {
            collection: () => {
                const chain = makeChain();
                return {
                    where: chain.where,
                    orderBy: chain.orderBy,
                    limit: chain.limit,
                    get: chain.get,
                    doc: (id: string) => ({
                        get: async () => ({ exists: id in events }),
                        create: async (data: any) => {
                            if (id in events) {
                                const err: any = new Error('ALREADY_EXISTS');
                                err.code = 6;
                                throw err;
                            }
                            created[id] = data;
                            events[id] = data;
                        },
                    }),
                };
            },
        } as any,
        created,
    };
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

describe('ensureUpcomingScheduled', () => {
    const defaults = { startTime: '19:00', endTime: '22:00' };
    const run = (day: string, events: Record<string, any>, dow = 5) => {
        const { db, created } = fakeDb(events);
        return ensureUpcomingScheduled(db, boston(day, '03:00'), ZONE, defaults, dow)
            .then(dates => ({ dates, created }));
    };

    it('creates exactly ONE event for an empty calendar', async () => {
        // The whole point of the change: how many sabhas exist is the manager's
        // decision. Previously this created eight.
        const { dates, created } = await run(WED, {});

        expect(dates).toEqual(['2026-08-07']);
        expect(Object.keys(created)).toEqual(['2026-08-07']);
        expect(created['2026-08-07'].autoCreated).toBe(true);
        expect(created['2026-08-07'].status).toBe('scheduled');
    });

    it('does nothing when a scheduled event already exists ahead', async () => {
        const { dates, created } = await run(WED, { '2026-08-07': scheduled('2026-08-07') });

        expect(dates).toEqual([]);
        expect(created).toEqual({});
    });

    it('creates the NEXT slot when the only one ahead is cancelled', async () => {
        // The outage this function exists to prevent. Naively "create slot 0 if
        // missing" does nothing here, findCurrentEvent returns null, and rides
        // close for days.
        const { dates, created } = await run(WED, {
            '2026-08-07': scheduled('2026-08-07', { status: 'cancelled' }),
        });

        expect(dates).toEqual(['2026-08-14']);
        expect(created['2026-08-14'].status).toBe('scheduled');
        // And it must not have resurrected the cancelled one.
        expect(created['2026-08-07']).toBeUndefined();
    });

    it('never overwrites or un-cancels an existing event', async () => {
        const { created } = await run(WED, {
            '2026-08-07': scheduled('2026-08-07', { startTime: '16:30', status: 'cancelled' }),
            '2026-08-14': scheduled('2026-08-14', { startTime: '16:30' }),
        });

        expect(created).toEqual({});
    });

    it('stops when the manager has decided every slot in the horizon', async () => {
        // Cancelling everything inside the horizon is a deliberate shutdown. The
        // generator must respect it, not fight it.
        const { dates, created } = await run(WED, {
            '2026-08-07': scheduled('2026-08-07', { status: 'cancelled' }),
            '2026-08-14': scheduled('2026-08-14', { status: 'cancelled' }),
        });

        expect(dates).toEqual([]);
        expect(created).toEqual({});
    });

    it('is satisfied by a manager-added one-off, without adding a Friday', async () => {
        const { dates, created } = await run(WED, {
            '2026-08-11': scheduled('2026-08-11'), // a Tuesday, hand-added
        });

        expect(dates).toEqual([]);
        expect(created).toEqual({});
    });

    it('does NOT count a scheduled event beyond the horizon', async () => {
        // Deliberate: pins the choice rather than leaving it to be discovered.
        // 2026-09-25 is well past today+14, so a nearer sabha is still created.
        const { dates } = await run(WED, { '2026-09-25': scheduled('2026-09-25') });

        expect(dates).toEqual(['2026-08-07']);
    });

    it('ignores past events entirely', async () => {
        const { dates } = await run(WED, { '2026-07-31': scheduled('2026-07-31') });
        expect(dates).toEqual(['2026-08-07']);
    });

    it('uses the default times it is given', async () => {
        const { created } = await run(WED, {}, 5);
        expect(created['2026-08-07'].startTime).toBe('19:00');
        expect(created['2026-08-07'].endTime).toBe('22:00');
    });

    it('can generate a slot other than Friday', async () => {
        const { dates } = await run(MON, {}, 2); // Tuesday
        expect(dates).toEqual(['2026-08-04']);
    });

    it('tolerates losing a create race', async () => {
        // The fake throws code 6 when the doc already exists. Two concurrent runs
        // picking the same slot must not produce an error.
        const events: Record<string, any> = {};
        const { db } = fakeDb(events);
        const [a, b] = await Promise.all([
            ensureUpcomingScheduled(db, boston(WED, '03:00'), ZONE, defaults),
            ensureUpcomingScheduled(db, boston(WED, '03:00'), ZONE, defaults),
        ]);
        // At most one of them created it; neither threw.
        expect([a.length, b.length].sort()).toEqual([0, 1]);
    });

    it('spans at least two weekly slots, or cancelling would still close rides', () => {
        expect(CALENDAR_HORIZON_DAYS).toBeGreaterThanOrEqual(14);
    });
});
