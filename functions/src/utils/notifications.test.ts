/**
 * Sending, and dropping tokens that are genuinely dead.
 *
 * This module had no test at all. It also had no way to learn that a token had
 * died: `sendEachForMulticast` does NOT throw on partial failure — it resolves
 * with a `responses[]` array positionally matching the tokens, and the old code
 * awaited it and threw the return value away. So dead tokens could only ever
 * accumulate, and every send got slower for ever.
 *
 * The most important test here is the NEGATIVE one: a transient failure must
 * not prune. Dropping live tokens during an FCM outage would silently
 * unsubscribe the whole congregation, invisibly and self-inflicted, and nothing
 * would ever put them back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEachForMulticast = vi.fn();
const batchUpdate = vi.fn();
const batchCommit = vi.fn(async () => undefined);
const usersGet = vi.fn();

vi.mock('firebase-admin', () => ({
    messaging: () => ({ sendEachForMulticast }),
    firestore: Object.assign(
        () => ({
            collection: () => ({ doc: (id: string) => ({ id }), get: usersGet }),
            batch: () => ({ update: batchUpdate, commit: batchCommit }),
        }),
        { FieldValue: { delete: () => '__deleted__' } },
    ),
}));

import { tokensOf, sendNotification, notifyEveryone, notifyStudentSarthiWaiting } from './notifications';

const ok = () => ({ success: true });
const fail = (code: string) => ({ success: false, error: { code } });

beforeEach(() => {
    vi.clearAllMocks();
    sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [ok()] });
});

describe('tokensOf', () => {
    it('reads every device from the map', () => {
        expect(tokensOf('u1', { fcmTokens: { a: {}, b: {} } }))
            .toEqual([{ uid: 'u1', token: 'a' }, { uid: 'u1', token: 'b' }]);
    });

    it('still reads a document written before the map existed', () => {
        // Nothing writes the single field any more, but a document that predates
        // the change must keep receiving rather than going quiet.
        expect(tokensOf('u1', { fcmToken: 'legacy' })).toEqual([{ uid: 'u1', token: 'legacy' }]);
    });

    it('does not deliver twice when both shapes hold the same token', () => {
        expect(tokensOf('u1', { fcmTokens: { a: {} }, fcmToken: 'a' }))
            .toEqual([{ uid: 'u1', token: 'a' }]);
    });

    it('is empty for a user who never enabled push', () => {
        expect(tokensOf('u1', {})).toEqual([]);
        expect(tokensOf('u1', undefined)).toEqual([]);
    });

    it('carries the uid, which is what makes pruning possible', () => {
        // The old API took a bare token and could not know whose document to
        // clean up. That is the whole reason this shape exists.
        expect(tokensOf('u9', { fcmTokens: { t: {} } })[0]).toEqual({ uid: 'u9', token: 't' });
    });
});

describe('pruning', () => {
    it('removes a token FCM reports as unregistered', async () => {
        sendEachForMulticast.mockResolvedValue({
            successCount: 1, failureCount: 1,
            responses: [ok(), fail('messaging/registration-token-not-registered')],
        });

        const result = await sendNotification(
            [{ uid: 'u1', token: 'live' }, { uid: 'u2', token: 'dead' }], 'T', 'B');

        expect(result).toEqual({ delivered: 1, failed: 1, pruned: 1 });
        expect(batchUpdate).toHaveBeenCalledTimes(1);
        expect(batchUpdate.mock.calls[0]![1]).toEqual({ 'fcmTokens.dead': '__deleted__' });
        expect(batchCommit).toHaveBeenCalled();
    });

    it('does NOT prune on a transient failure', async () => {
        // The one that matters. An FCM outage must not unsubscribe everybody.
        sendEachForMulticast.mockResolvedValue({
            successCount: 0, failureCount: 2,
            responses: [fail('messaging/internal-error'), fail('messaging/server-unavailable')],
        });

        const result = await sendNotification(
            [{ uid: 'u1', token: 'a' }, { uid: 'u2', token: 'b' }], 'T', 'B');

        expect(result.failed).toBe(2);
        expect(result.pruned).toBe(0);
        expect(batchUpdate).not.toHaveBeenCalled();
        expect(batchCommit).not.toHaveBeenCalled();
    });

    it('prunes the right person when several fail', async () => {
        sendEachForMulticast.mockResolvedValue({
            successCount: 1, failureCount: 2,
            responses: [
                fail('messaging/internal-error'),                      // keep
                ok(),                                                  // keep
                fail('messaging/registration-token-not-registered'),   // drop
            ],
        });

        await sendNotification([
            { uid: 'u1', token: 'transient' },
            { uid: 'u2', token: 'fine' },
            { uid: 'u3', token: 'gone' },
        ], 'T', 'B');

        expect(batchUpdate).toHaveBeenCalledTimes(1);
        expect(batchUpdate.mock.calls[0]![1]).toEqual({ 'fcmTokens.gone': '__deleted__' });
    });
});

describe('a push failure never reaches the caller', () => {
    it('does not throw when messaging is down', async () => {
        // Every call site is post-commit in a ride path. A throw here would
        // surface as a failed assignment.
        sendEachForMulticast.mockRejectedValue(new Error('FCM unavailable'));

        await expect(sendNotification([{ uid: 'u1', token: 'a' }], 'T', 'B')).resolves
            .toEqual({ delivered: 0, failed: 1, pruned: 0 });
    });

    it('does not throw when the pruning write fails', async () => {
        sendEachForMulticast.mockResolvedValue({
            successCount: 0, failureCount: 1,
            responses: [fail('messaging/registration-token-not-registered')],
        });
        batchCommit.mockRejectedValueOnce(new Error('firestore down'));

        await expect(sendNotification([{ uid: 'u1', token: 'a' }], 'T', 'B')).resolves.toBeDefined();
    });

    it('sends nothing, and does not call FCM, for an empty audience', async () => {
        await expect(sendNotification([], 'T', 'B')).resolves.toEqual({ delivered: 0, failed: 0, pruned: 0 });
        expect(sendEachForMulticast).not.toHaveBeenCalled();
    });
});

describe('notifyEveryone', () => {
    it('says so and sends nothing when nobody has enabled push', async () => {
        // This is the state the app has been in since it was written.
        usersGet.mockResolvedValue({ docs: [{ id: 'u1', data: () => ({}) }] });

        await notifyEveryone('T', 'B');

        expect(sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('collects every device of every user', async () => {
        usersGet.mockResolvedValue({
            docs: [
                { id: 'u1', data: () => ({ fcmTokens: { phone: {}, laptop: {} } }) },
                { id: 'u2', data: () => ({ fcmToken: 'legacy' }) },
            ],
        });
        sendEachForMulticast.mockResolvedValue({ successCount: 3, failureCount: 0, responses: [ok(), ok(), ok()] });

        await notifyEveryone('T', 'B');

        const tokens = sendEachForMulticast.mock.calls[0]![0].tokens;
        expect(tokens.sort()).toEqual(['laptop', 'legacy', 'phone']);
    });
});

describe('the nudge a Sarthi sends by hand', () => {
    /**
     * The one message on this app written by a driver's tap rather than by the
     * server's own state changes. Its wording is fixed here, and `nudgeRider`
     * cannot reach past this function to change it — which is the whole reason
     * the text lives in this file and not in the callable.
     */
    it('says who is waiting and what to do, and names no child', async () => {
        await notifyStudentSarthiWaiting([{ uid: 'u1', token: 'a' }]);

        const text = JSON.stringify(sendEachForMulticast.mock.calls[0][0]);
        expect(text).toMatch(/Sarthi is waiting/);
        expect(text).toMatch(/outside/i);
        expect(text).toMatch(/sarthi_waiting/);
    });

    it('reports what was delivered, so a bell that reached nobody can say so', async () => {
        sendEachForMulticast.mockResolvedValue({ successCount: 0, failureCount: 1, responses: [fail('messaging/internal-error')] });

        await expect(notifyStudentSarthiWaiting([{ uid: 'u1', token: 'a' }]))
            .resolves.toMatchObject({ delivered: 0 });
    });
});
