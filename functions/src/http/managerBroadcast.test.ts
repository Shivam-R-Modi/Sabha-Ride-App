/**
 * One manager, every phone.
 *
 * This is the only action in the app that reaches the whole congregation at
 * once, so the tests are mostly about what it REFUSES.
 *
 * The important one is `refuses a second manager inside the floor`. The house
 * rate limiter is keyed per user and fails open by design — two managers each
 * comfortably under their own budget still double the noise, and a per-user
 * limiter structurally cannot see that. The congregation-wide floor document is
 * the only thing that actually bounds blast radius.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let floorState: any;
let auditRows: any[];

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

const notifyEveryone = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../utils/notifications', () => ({
    notifyEveryone: (...a: any[]) => notifyEveryone(...(a as [])),
}));

const approvedManager = vi.fn(async () => ({ name: 'Mira' }));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: (...a: any[]) => approvedManager(...(a as [])),
}));

const rateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: (...a: any[]) => rateLimit(...(a as [])) }));

let order: string[];
vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => {
        order.push('audit');
        auditRows.push({ ...entry });
        return { set: async (patch: any) => { Object.assign(auditRows[auditRows.length - 1], patch); } };
    },
}));

import { managerBroadcast } from './managerBroadcast';

function makeDb() {
    auditRows = [];
    db = {
        doc: () => ({}),
        runTransaction: async (fn: any) => fn({
            get: async () => ({ data: () => floorState }),
            set: (_ref: any, data: any) => { floorState = { ...floorState, ...data }; },
        }),
    };
}

const call = (body: string) => (managerBroadcast as any)({ body }, { auth: { uid: 'mgr_1' } });

beforeEach(() => {
    vi.clearAllMocks();
    approvedManager.mockResolvedValue({ name: 'Mira' });
    rateLimit.mockResolvedValue(undefined);
    floorState = {};
    order = [];
    notifyEveryone.mockImplementation(async () => { order.push('send'); });
    makeDb();
});

describe('managerBroadcast — who and what', () => {
    it('sends the manager’s words to everyone', async () => {
        await expect(call('Sabha moved to 7pm')).resolves.toEqual({ success: true });

        expect(notifyEveryone).toHaveBeenCalledTimes(1);
        const [title, body] = notifyEveryone.mock.calls[0] as any[];
        expect(body).toBe('Sabha moved to 7pm');
        expect(title).toBe('Bhulka Gaadi');
    });

    it('ignores a title supplied by the caller', async () => {
        // The real impersonation test — the one above proves nothing, because it
        // never sends a title. A free-text title would let a broadcast look
        // exactly like a system push: "Sarthi has arrived", to everyone.
        await (managerBroadcast as any)(
            { body: 'hello', title: 'Sarthi has arrived' },
            { auth: { uid: 'mgr_1' } },
        );

        expect((notifyEveryone.mock.calls[0] as any[])[0]).toBe('Bhulka Gaadi');
    });

    it('refuses a non-manager and sends nothing', async () => {
        approvedManager.mockRejectedValue(new Error('Only approved managers can send a broadcast.'));

        await expect(call('hello')).rejects.toThrow(/managers/i);
        expect(notifyEveryone).not.toHaveBeenCalled();
    });

    it('refuses an empty message', async () => {
        await expect(call('   ')).rejects.toThrow(/message is required/i);
        expect(notifyEveryone).not.toHaveBeenCalled();
    });

    it('refuses an overlong message', async () => {
        await expect(call('x'.repeat(201))).rejects.toThrow(/under 200/i);
    });

    it('flattens newlines, which render unpredictably and fake several pushes', async () => {
        await call('line one\n\nline two');
        expect((notifyEveryone.mock.calls[0] as any[])[1]).toBe('line one line two');
    });
});

describe('managerBroadcast — the congregation floor', () => {
    it('refuses a second manager inside the gap', async () => {
        // The case the per-user limiter cannot catch: a DIFFERENT manager,
        // comfortably inside their own budget.
        await call('first');
        notifyEveryone.mockClear();

        await expect((managerBroadcast as any)({ body: 'second' }, { auth: { uid: 'mgr_2' } }))
            .rejects.toThrow(/wait about/i);
        expect(notifyEveryone).not.toHaveBeenCalled();
    });

    it('allows another once the gap has passed', async () => {
        await call('first');
        floorState.lastBroadcastAt = Date.now() - 11 * 60 * 1000;

        await expect(call('second')).resolves.toEqual({ success: true });
    });

    it('caps the day', async () => {
        floorState = {
            lastBroadcastAt: Date.now() - 60 * 60 * 1000,
            dayKey: new Date().toISOString().slice(0, 10),
            sentToday: 5,
        };

        await expect(call('one too many')).rejects.toThrow(/limit of broadcasts/i);
        expect(notifyEveryone).not.toHaveBeenCalled();
    });

    it('reserves the slot BEFORE sending, so a race cannot double-send', async () => {
        await call('first');
        expect(floorState.sentToday).toBe(1);
        expect(floorState.lastBroadcastAt).toEqual(expect.any(Number));
    });
});

describe('managerBroadcast — the record', () => {
    it('writes a pending row first and closes it ok', async () => {
        await call('hello');

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].action).toBe('broadcast.send');
        expect(auditRows[0].summary).toMatch(/hello/);
        expect(auditRows[0].outcome).toBe('ok');
    });

    it('leaves a failed row when the send throws', async () => {
        // The point of writing pending first: a broadcast that dies mid-fan-out
        // still leaves evidence it was attempted.
        notifyEveryone.mockRejectedValueOnce(new Error('FCM down'));

        await expect(call('hello')).rejects.toThrow(/could not send/i);
        expect(auditRows[0].outcome).toBe('failed');
    });

    it('writes the row BEFORE sending, not after', async () => {
        // Ordering is the whole point of a pending row. Writing it afterwards
        // would leave no trace at all of a broadcast that died mid-fan-out —
        // and the failed-row test cannot tell the difference, because the catch
        // block writes a row either way.
        await call('hello');

        expect(order).toEqual(['audit', 'send']);
    });

    it('names the sender', async () => {
        await call('hello');
        expect(auditRows[0].actorUid).toBe('mgr_1');
        expect(auditRows[0].actorName).toBe('Mira');
    });
});
