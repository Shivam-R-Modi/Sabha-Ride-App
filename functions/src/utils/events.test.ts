import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({}), {
        // findCurrentEvent orders by document id.
        FieldPath: { documentId: () => '__name__' },
    }),
}));

import { findCurrentEvent, ensureUpcomingEvents, weeklySlotDate, AUTOCREATE_WEEKS_AHEAD } from './events';

const ZONE = 'America/New_York';
const boston = (day: string, hhmm: string) => new Date(`2026-08-${day}T${hhmm}:00-04:00`);

// August 2026: 3rd = Mon, 5th = Wed, 7th = Fri, 8th = Sat
const MON = '03', WED = '05', FRI = '07', SAT = '08';

/**
 * Minimal fake of the query chain findCurrentEvent uses:
 *   collection().where().orderBy().limit().get()
 * Returns the seeded docs whose id is >= the `>=` bound, in id order.
 */
function fakeDb(events: Record<string, any>) {
    let lowerBound = '';
    const chain: any = {
        where: (_field: any, _op: string, value: string) => { lowerBound = value; return chain; },
        orderBy: () => chain,
        limit: () => chain,
        get: async () => ({
            docs: Object.keys(events)
                .filter(id => id >= lowerBound)
                .sort()
                .map(id => ({ id, data: () => events[id] })),
        }),
    };

    const created: Record<string, any> = {};

    return {
        db: {
            collection: () => ({
                ...chain,
                doc: (id: string) => ({
                    get: async () => ({ exists: id in events }),
                    create: async (data: any) => { created[id] = data; },
                }),
            }),
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

describe('ensureUpcomingEvents', () => {
    const defaults = { startTime: '19:00', endTime: '22:00' };

    it('fills an empty calendar', async () => {
        // An empty calendar means no rides at all, with no error shown to anyone.
        const { db, created } = fakeDb({});
        const dates = await ensureUpcomingEvents(db, boston(WED, '10:00'), ZONE, defaults);

        expect(dates).toHaveLength(AUTOCREATE_WEEKS_AHEAD);
        expect(dates[0]).toBe('2026-08-07');
        expect(dates[1]).toBe('2026-08-14');
        expect(created['2026-08-07'].autoCreated).toBe(true);
        expect(created['2026-08-07'].status).toBe('scheduled');
    });

    it('never overwrites a gathering a manager has touched', async () => {
        // The edited time, moved venue or cancellation must survive.
        const { db, created } = fakeDb({
            '2026-08-07': scheduled('2026-08-07', { startTime: '16:30', status: 'cancelled' }),
        });
        const dates = await ensureUpcomingEvents(db, boston(WED, '10:00'), ZONE, defaults);

        expect(dates).not.toContain('2026-08-07');
        expect(created['2026-08-07']).toBeUndefined();
    });

    it('uses the default times it is given', async () => {
        const { db, created } = fakeDb({});
        await ensureUpcomingEvents(db, boston(WED, '10:00'), ZONE, {
            startTime: '18:00', endTime: '20:30',
        });
        expect(created['2026-08-07'].startTime).toBe('18:00');
        expect(created['2026-08-07'].endTime).toBe('20:30');
    });

    it('can generate a slot other than Friday', async () => {
        const { db } = fakeDb({});
        const dates = await ensureUpcomingEvents(db, boston(MON, '10:00'), ZONE, defaults, 2);
        expect(dates[0]).toBe('2026-08-04'); // Tuesday
    });
});
