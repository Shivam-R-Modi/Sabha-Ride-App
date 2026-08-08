/**
 * Manager invites: mint one, redeem one.
 *
 * Replaces `settings/managerCode` — one static string, no expiry, no single use,
 * no record of who received it, and revocable only by changing it for everyone at
 * once. Any approved manager could also read it in plaintext (firestore.rules
 * allowed it), so anyone who became a manager could mint managers forever, and
 * nothing recorded that they had.
 *
 * An invite is single-use, expires, names who issued it and who redeemed it, and
 * is stored only as a salted scrypt hash — so no path, including the Database
 * Console and a database dump, yields a working code.
 *
 * The collection is FLAT rather than nested under a location. A flat collection
 * carrying `cityId` survives a later re-key into a per-location hierarchy without
 * the documents moving.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
import { checkRateLimit } from '../utils/rateLimiter';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../constants/tenancy';
import {
    generateInvite, splitCode, makeSalt, hashSecret, rejectionFor,
    INVITE_TTL_DAYS, InviteRejection,
} from '../utils/invites';

export const INVITES_COLLECTION = 'managerInvites';

/** One message per refusal. "Invalid code" for all five hides a fixable mistake. */
const REJECTION_MESSAGE: Record<InviteRejection, string> = {
    'not-found': 'That invite code was not recognised. Check it and try again.',
    'already-used': 'That invite has already been used. Ask for a new one.',
    'revoked': 'That invite was cancelled. Ask for a new one.',
    'expired': 'That invite has expired. Ask for a new one.',
    'wrong-code': 'That invite code was not recognised. Check it and try again.',
};

/**
 * Mint an invite. Approved managers only. Returns the plaintext ONCE.
 */
export const createManagerInvite = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    const caller = await assertApprovedManager(db, uid, 'create manager invites');

    // Minting is cheap for a legitimate manager and noisy for anyone farming
    // codes out of a compromised account.
    await checkRateLimit(uid, {
        maxRequests: 10,
        windowMs: 60 * 60 * 1000,
        functionName: 'createManagerInvite',
    });

    const label = typeof data?.label === 'string' ? data.label.trim().slice(0, 120) : '';

    const { ref, secret, code } = generateInvite();
    const salt = makeSalt();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    // create(), not set(): a reference collision must fail rather than overwrite
    // a live invite. 6 characters over a 30-character alphabet makes that
    // vanishingly unlikely, and silently replacing someone else's invite is not
    // a failure mode worth leaving open.
    await db.collection(INVITES_COLLECTION).doc(ref).create({
        codeHash: hashSecret(secret, salt),
        salt,
        label,
        cityId: FOUNDING_CITY_ID,
        locationId: FOUNDING_LOCATION_ID,
        createdBy: uid,
        createdByName: String(caller.name || 'Manager'),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        usedBy: null,
        usedAt: null,
        revokedAt: null,
    });

    await writeAuditLog(db, {
        action: 'manager.promote',
        actorUid: uid,
        actorName: String(caller.name || 'Manager'),
        targetCollection: INVITES_COLLECTION,
        targetDocumentId: ref,
        summary: `Created a manager invite${label ? ` for ${label}` : ''}, expires ${expiresAt.toISOString().slice(0, 10)}`,
        details: { label, expiresAt: expiresAt.toISOString() },
    });

    // The only time the plaintext exists outside the recipient's hands.
    return { code, ref, expiresAt: expiresAt.toISOString() };
});

/**
 * Redeem an invite and become an approved manager.
 */
export const redeemManagerInvite = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    // Same shape as the old verifyManagerCode limit. A redeem endpoint is a
    // guessing oracle for a short secret, so the limit is the security control
    // that makes a 50-bit code sufficient.
    await checkRateLimit(uid, {
        maxRequests: 5,
        windowMs: 15 * 60 * 1000,
        functionName: 'redeemManagerInvite',
    });

    const raw = data?.code;
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new functions.https.HttpsError('invalid-argument', 'An invite code is required.');
    }

    const parts = splitCode(raw);
    if (!parts) {
        // Wrong length — reject without a read, and without telling the caller
        // which part was wrong.
        return { redeemed: false, reason: 'wrong-code', message: REJECTION_MESSAGE['wrong-code'] };
    }

    const inviteRef = db.collection(INVITES_COLLECTION).doc(parts.ref);
    const now = new Date();

    // The transaction is what makes an invite single-use: two people redeeming
    // the same code at once, one wins.
    let rejection: InviteRejection | null = null;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(inviteRef);
        rejection = rejectionFor(snap.exists ? snap.data() : null, parts.secret, now);
        if (rejection) return;

        tx.update(inviteRef, { usedBy: uid, usedAt: now.toISOString() });

        tx.set(db.collection('users').doc(uid), {
            role: 'manager',
            registeredRole: 'manager',
            // The granted set, so one query answers "who can drive?" everywhere.
            roles: ['manager', 'driver', 'student'],
            activeRole: 'manager',
            accountStatus: 'approved',
            email: context.auth?.token.email ?? null,
            cityId: FOUNDING_CITY_ID,
            locationId: FOUNDING_LOCATION_ID,
            approvedAt: now.toISOString(),
            approvedVia: 'managerInvite',
            approvedViaInvite: parts.ref,
        }, { merge: true });
    });

    if (rejection) {
        console.warn(`[redeemManagerInvite] ${uid} rejected: ${rejection}`);
        return { redeemed: false, reason: rejection, message: REJECTION_MESSAGE[rejection] };
    }

    // Claims cannot join a Firestore transaction, so they follow it. Best-effort:
    // firestore.rules falls back to the user document, so a failure here costs a
    // lookup per read and nothing else — whereas failing the call would tell
    // someone their valid invite did not work, after it had already been spent.
    try {
        await admin.auth().setCustomUserClaims(uid, {
            mgr: true, sm: false, city: FOUNDING_CITY_ID,
        });
    } catch (claimErr) {
        console.error('[redeemManagerInvite] Could not set manager claim:', claimErr);
    }

    await writeAuditLog(db, {
        action: 'manager.promote',
        actorUid: uid,
        actorName: String(context.auth.token.email || uid),
        targetCollection: 'users',
        targetDocumentId: uid,
        summary: `Became a manager by redeeming invite ${parts.ref}`,
        details: { inviteRef: parts.ref },
    });

    console.log(`[redeemManagerInvite] ${uid} became a manager via ${parts.ref}`);
    return { redeemed: true };
});
