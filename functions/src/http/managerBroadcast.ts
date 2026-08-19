// ============================================
// HTTP FUNCTION: managerBroadcast
// A manager sends one message to every phone.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import { notifyEveryone } from '../utils/notifications';

/** Long enough for a real message, short enough not to be truncated everywhere. */
const MAX_BODY = 200;

/**
 * The floor that actually bounds blast radius.
 *
 * `checkRateLimit` is keyed per user and FAILS OPEN by design. For the six
 * endpoints already using it that is the right trade — it only over-permits
 * someone already proven to be an approved manager spending their own budget.
 *
 * Broadcasts are different: what is at risk is not the caller's budget but every
 * phone in the congregation, and two managers each comfortably under their own
 * limit still double the noise. A per-user limiter structurally cannot see that.
 * So there is a single congregation-wide document, reserved in a transaction
 * BEFORE any message is sent.
 */
const FLOOR_DOC = 'system/broadcastState';
const MIN_GAP_MS = 10 * 60 * 1000;
const MAX_PER_DAY = 5;

export const managerBroadcast = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    const manager = await assertApprovedManager(db, uid, 'send a broadcast');

    // Newlines stripped: a multi-line body renders unpredictably across
    // platforms and is a cheap way to make a push look like several.
    const body = String(data?.body ?? '').replace(/\s+/g, ' ').trim();
    if (!body) {
        throw new functions.https.HttpsError('invalid-argument', 'A message is required');
    }
    if (body.length > MAX_BODY) {
        throw new functions.https.HttpsError(
            'invalid-argument', `Keep it under ${MAX_BODY} characters`);
    }

    // Per-actor arm: the house pattern.
    await checkRateLimit(uid, {
        maxRequests: 5, windowMs: 60 * 60 * 1000, functionName: 'managerBroadcast',
    });

    // Congregation floor: reserve the send before anything goes out, so two
    // managers racing cannot both pass.
    const floorRef = db.doc(FLOOR_DOC);
    const now = Date.now();
    await db.runTransaction(async tx => {
        const snap = await tx.get(floorRef);
        const state = snap.data() ?? {};
        const lastAt = typeof state.lastBroadcastAt === 'number' ? state.lastBroadcastAt : 0;
        const dayKey = new Date(now).toISOString().slice(0, 10);
        const sentToday = state.dayKey === dayKey && typeof state.sentToday === 'number'
            ? state.sentToday : 0;

        if (now - lastAt < MIN_GAP_MS) {
            const wait = Math.ceil((MIN_GAP_MS - (now - lastAt)) / 60000);
            throw new functions.https.HttpsError(
                'resource-exhausted',
                `A message went out recently. Please wait about ${wait} minute(s).`,
            );
        }
        if (sentToday >= MAX_PER_DAY) {
            throw new functions.https.HttpsError(
                'resource-exhausted', 'That is the limit of broadcasts for today.');
        }

        tx.set(floorRef, { lastBroadcastAt: now, dayKey, sentToday: sentToday + 1 }, { merge: true });
    });

    // Pending first, closed after — a broadcast that dies mid-fan-out still
    // leaves a record that it was attempted. This is the one manager action
    // that reaches every phone at once.
    const auditRef = await writeAuditLog(db, {
        action: 'broadcast.send',
        actorUid: uid,
        actorName: String(manager.name ?? 'A manager'),
        targetCollection: 'users',
        targetDocumentId: 'everyone',
        summary: `Broadcast to everyone: "${body}"`,
        outcome: 'pending',
    });

    try {
        // The manager supplies the BODY only. A free-text title would let a
        // broadcast impersonate a system push — "Sarthi has arrived" to the
        // whole congregation, indistinguishable from the real thing.
        await notifyEveryone('Bhulka Gaadi', body, { type: 'broadcast' });
        // writeAuditLog swallows its own failures and returns null, so the close
        // is conditional. An unclosed row reads as 'pending', which is honest.
        if (auditRef) {
            await auditRef.set({ outcome: 'ok', completedAt: new Date().toISOString() }, { merge: true });
        }
        return { success: true };
    } catch (error) {
        if (auditRef) {
            await auditRef.set({ outcome: 'failed', completedAt: new Date().toISOString() }, { merge: true });
        }
        throw new functions.https.HttpsError('internal', 'Could not send the message');
    }
});
