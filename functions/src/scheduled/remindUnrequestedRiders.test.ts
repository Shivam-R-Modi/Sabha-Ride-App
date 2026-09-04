/**
 * Reminding a Bhulku who has not asked for a lift.
 *
 * THE ASSERTIONS THAT EARN THIS FILE are all about NOT sending. This is the only
 * repeating notification in the app and the only one aimed at somebody who has done
 * nothing, so every wrong `true` is a push to the wrong person, once a day, until the
 * sabha. Four ways it could go wrong and each has a case here:
 *
 *   - reminding somebody who already asked (the roster case is the subtle one: a
 *     passenger can appear only inside `students`, never as `studentId`)
 *   - reminding a Sarthi, who drives and has nothing to book
 *   - firing outside the request window, so the reminder cannot be acted on
 *   - firing twice, because Pub/Sub delivers at least once
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let rides: any[];
let users: Array<{ id: string; data: any }>;
let settings: any;
let stateDoc: any;
let stateWrites: any[];
let auditRows: any[];
let sent: Array<{ recipients: any[] }>;
let window: any;
let scheduled: any;
/** The halls this job says are open, and the ids it asked the resolver about. */
let halls: Array<{ id: string }>;
let askedAboutHalls: string[] | null;

vi.mock('firebase-functions', () => ({
    pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (h: any) => h }) }) },
}));
vi.mock('firebase-admin', () => ({ firestore: () => db }));

vi.mock('../utils/notifications', () => ({
    tokensOf: (uid: string, data: any) =>
        Object.keys(data?.fcmTokens ?? {}).map(token => ({ uid, token })),
    notifyRideReminder: async (recipients: any[]) => {
        sent.push({ recipients });
        return { delivered: recipients.length, failed: 0, pruned: 0 };
    },
}));
vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => { auditRows.push({ ...entry }); return null; },
}));
vi.mock('../utils/notificationSettings', () => ({
    getNotificationSettings: async () => settings,
}));
vi.mock('../utils/settings', () => ({
    getTimeZone: async () => 'America/New_York',
    getRequestsOpenTime: async () => '10:00',
    locationsOrFoundingFallback: async () => halls,
}));
vi.mock('../http/sabhaRecurrence', () => ({ readRecurrence: async () => null }));
// `resolveCurrentEvent`, and it RECORDS THE HALLS IT WAS ASKED ABOUT. Passing them is
// what stops an evening every hall cancelled separately from getting reminders, and
// that argument is invisible in the output — so it is captured rather than assumed.
vi.mock('../utils/events', () => ({
    resolveCurrentEvent: async (
        _db: unknown, _now: unknown, _tz: unknown, _rule: unknown, locationIds: string[],
    ) => {
        askedAboutHalls = locationIds;
        return { event: scheduled, hallExceptions: new Map() };
    },
}));
vi.mock('../utils/schedule', () => ({
    buildCurrentEvent: (date: string) => ({ eventId: date }),
    resolveScheduleWindow: () => window,
}));

import { remindUnrequestedRiders, needsReminder, alreadyAsked } from './remindUnrequestedRiders';

/** 10:00 in Boston on Wednesday 5 August, two days before a Friday sabha. */
const NOW = new Date('2026-08-05T14:00:00Z');
const EVENT = '2026-08-07';

const BHULKU = (over: any = {}) => ({
    accountStatus: 'approved', role: 'student', roles: ['student'],
    registeredRole: 'student', fcmTokens: { tok: {} }, ...over,
});

function makeDb() {
    stateWrites = []; auditRows = []; sent = []; stateDoc = {};
    const rideQuery = (field: string) => ({
        where: (f: string, _op: string, value: string) => ({
            get: async () => ({
                docs: rides
                    .filter(r => r[f] === value)
                    .map(r => ({ id: r.id ?? 'r', data: () => r })),
            }),
        }),
        _field: field,
    });
    db = {
        collection: (name: string) => {
            if (name === 'users') {
                return { get: async () => ({ docs: users.map(u => ({ id: u.id, data: () => u.data })) }) };
            }
            return rideQuery(name);
        },
        doc: () => ({ id: 'rideReminders' }),
        runTransaction: async (fn: any) => fn({
            get: async () => ({ data: () => stateDoc }),
            set: (_ref: any, data: any) => { stateWrites.push(data); stateDoc = { ...stateDoc, ...data }; },
        }),
    };
}

const run = () => (remindUnrequestedRiders as any)();

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    rides = [];
    users = [{ id: 'stu_1', data: BHULKU() }];
    settings = {
        enabled: { 'ride-reminder': true }, reminderHour: 10, reminderCadence: 'daily',
    };
    scheduled = { date: EVENT, startTime: '19:00', endTime: '22:00' };
    window = { rideType: 'home-to-sabha' };
    halls = [{ id: 'boston-huntington' }];
    askedAboutHalls = null;
    makeDb();
});

describe('the ordinary case', () => {
    it('reminds a Bhulku who has not asked', async () => {
        await run();
        expect(sent).toHaveLength(1);
        expect(sent[0].recipients).toEqual([{ uid: 'stu_1', token: 'tok' }]);
    });

    it('records what it did, with the count that is invisible elsewhere', async () => {
        await run();
        expect(auditRows[0]).toMatchObject({
            action: 'reminder.send',
            details: { waiting: 1, devices: 1, cadence: 'daily' },
        });
    });

    it('records the run even when nobody has push switched on', async () => {
        // "Forty people had not booked and none had push" is the answer to "why is
        // the reminder not working", and it exists nowhere else.
        users = [{ id: 'stu_1', data: BHULKU({ fcmTokens: {} }) }];
        await run();

        expect(sent).toHaveLength(0);
        expect(auditRows[0].details).toMatchObject({ waiting: 1, devices: 0 });
    });
});

describe('who it leaves alone', () => {
    it('says nothing to somebody who already asked', async () => {
        rides = [{ id: 'r1', eventDate: EVENT, studentId: 'stu_1' }];
        await run();
        expect(sent).toHaveLength(0);
    });

    it('finds them under `date` too, not only `eventDate`', async () => {
        // Rides carry the gathering under either name depending on which client
        // wrote them. Missing one would remind people who are already booked.
        rides = [{ id: 'r1', date: EVENT, studentId: 'stu_1' }];
        await run();
        expect(sent).toHaveLength(0);
    });

    it('finds a passenger who is only on the ROSTER', async () => {
        // The dispatcher copies the whole car onto every ride, so a passenger can
        // appear in `students` and never as `studentId`.
        rides = [{
            id: 'r1', eventDate: EVENT, studentId: 'someone_else',
            students: [{ id: 'someone_else' }, { id: 'stu_1' }],
        }];
        await run();
        expect(sent).toHaveLength(0);
    });

    it('says nothing to a Sarthi', async () => {
        // They drive. "You have not booked a lift" is not a thing they failed to do —
        // and the role hierarchy grants them `student`, so a granted-role check here
        // would have reminded the entire congregation.
        users = [{ id: 'drv', data: BHULKU({ role: 'driver', roles: ['driver', 'student'], registeredRole: 'driver' }) }];
        await run();
        expect(sent).toHaveLength(0);
    });

    it('says nothing to an account that is not approved', async () => {
        users = [{ id: 'stu_1', data: BHULKU({ accountStatus: 'pending' }) }];
        await run();
        expect(sent).toHaveLength(0);
    });

    it('says nothing to somebody who has not arrived in the country yet', async () => {
        users = [{ id: 'stu_1', data: BHULKU({ isArriving: true }) }];
        await run();
        expect(sent).toHaveLength(0);
    });
});

describe('when it stays quiet altogether', () => {
    it('does nothing at any other hour', async () => {
        settings.reminderHour = 8;
        await run();
        expect(sent).toHaveLength(0);
        expect(stateWrites).toHaveLength(0);
    });

    it('does nothing when a manager switched it off', async () => {
        settings.enabled['ride-reminder'] = false;
        await run();
        expect(sent).toHaveLength(0);
        expect(stateWrites).toHaveLength(0);
    });

    it('does nothing when requests are not open', async () => {
        // A reminder to do something the app will refuse is worse than silence.
        window = { rideType: null };
        await run();
        expect(sent).toHaveLength(0);
    });

    it('does nothing during sabha, when drop-off is the open window', async () => {
        window = { rideType: 'sabha-to-home' };
        await run();
        expect(sent).toHaveLength(0);
    });

    it('does nothing when no gathering is scheduled', async () => {
        scheduled = null;
        await run();
        expect(sent).toHaveLength(0);
    });
});

describe('it never sends twice for the same day', () => {
    it('skips a run already recorded', async () => {
        // Pub/Sub delivers AT LEAST ONCE. Without the stamp, a lost acknowledgement
        // buzzes every phone in the congregation a second time.
        stateDoc = { lastSentKey: `${EVENT}:2026-08-05` };
        await run();
        expect(sent).toHaveLength(0);
    });

    it('claims the day BEFORE doing the work', async () => {
        await run();
        expect(stateWrites[0].lastSentKey).toBe(`${EVENT}:2026-08-05`);
    });

    it('sends again the next day', async () => {
        stateDoc = { lastSentKey: `${EVENT}:2026-08-04` };
        await run();
        expect(sent).toHaveLength(1);
    });

    it('treats a different gathering as its own', async () => {
        stateDoc = { lastSentKey: `2026-08-14:2026-08-05` };
        await run();
        expect(sent).toHaveLength(1);
    });
});

describe('the day-before cadence', () => {
    beforeEach(() => { settings.reminderCadence = 'day-before'; });

    it('stays quiet two days out', async () => {
        await run();
        expect(sent).toHaveLength(0);
    });

    it('fires on the day before the sabha', async () => {
        vi.setSystemTime(new Date('2026-08-06T14:00:00Z'));
        await run();
        expect(sent).toHaveLength(1);
    });
});

describe('needsReminder, on its own', () => {
    it('is false for anything missing', () => {
        expect(needsReminder(undefined)).toBe(false);
        expect(needsReminder({})).toBe(false);
    });

    it('excludes anybody who can drive, however their roles are written', () => {
        // The trap: `roles` is the GRANTED set, so a Sarthi's document records
        // `['driver', 'student']` and a manager's records all three. Testing for a
        // recorded 'student' would be true for the entire congregation.
        expect(needsReminder(BHULKU())).toBe(true);
        expect(needsReminder(BHULKU({
            role: 'driver', roles: ['driver', 'student'], registeredRole: 'driver',
        }))).toBe(false);
        expect(needsReminder(BHULKU({
            role: 'manager', roles: ['manager', 'driver', 'student'], registeredRole: 'manager',
        }))).toBe(false);
    });
});

describe('alreadyAsked, on its own', () => {
    it('is empty when nobody has', async () => {
        expect(await alreadyAsked(db, EVENT)).toEqual(new Set());
    });

    it('counts a ride in any status, not just a pending request', async () => {
        // Somebody whose ride is finished has emphatically asked.
        rides = [{ id: 'r1', eventDate: EVENT, studentId: 'stu_1', status: 'completed' }];
        expect(await alreadyAsked(db, EVENT)).toEqual(new Set(['stu_1']));
    });

    it('ignores rides for another gathering', async () => {
        rides = [{ id: 'r1', eventDate: '2026-08-14', studentId: 'stu_1' }];
        expect(await alreadyAsked(db, EVENT)).toEqual(new Set());
    });
});

/**
 * An evening no room is holding gets no reminders.
 *
 * A manager who cancels each hall separately, rather than cancelling the date, leaves
 * the date itself scheduled. Asked without the halls this job reads that as a sabha and
 * nudges everyone who has not booked — towards a request the app will then refuse.
 */
describe('remindUnrequestedRiders — which halls it asks about', () => {
    it('names every open hall to the resolver', async () => {
        halls = [{ id: 'boston-huntington' }, { id: 'somerville' }];

        await run();

        expect(askedAboutHalls).toEqual(['boston-huntington', 'somerville']);
    });

    it('says nothing when the resolver reports no gathering', async () => {
        // Which is what naming the halls buys: `resolveCurrentEvent` returns null for
        // an evening where every named hall is closed.
        scheduled = null;

        await run();

        expect(sent).toHaveLength(0);
    });
});
