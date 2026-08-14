/**
 * One answer to "is this caller an approved manager?".
 *
 * There were six, hand-inlined, and all six were spelled differently:
 *
 *   | site                          | role | registeredRole | roles[] | activeRole | approved |
 *   | deleteSabhaEvent assertManager|  y   |       y        |    y    |     n      |    y     |
 *   | updateRideTypeContext         |  y   |       y        |    y    |     n      |    y     |
 *   | adminDeleteUser               |  y   |       y        |    n    |     n      |    y     |
 *   | manualAssignStudent           |  y   |       n        |    y    |     y      |   NO     |
 *   | generateEventCSV              |  y   |       n        |    y    |     n      |   NO     |
 *   | firestore.rules isManager()   |  y   |       y        |    y    |     n      |    y     |
 *
 * The two missing `approved` checks were not a theoretical weakness. `Reject` in
 * the manager console (`updateUserStatus`, hooks/useUsers.ts) writes
 * `accountStatus` and nothing else — `role: 'manager'` stays on the document. So
 * a revoked manager kept manual assignment and kept `generateEventCSV`, which
 * exports every family's name, phone number and home address. Revocation did not
 * reach the two functions that mattered most.
 *
 * `activeRole` is deliberately NOT an authority signal. It answers "which hat is
 * this person wearing in the UI", not "what are they allowed to do", and
 * `manualAssignStudent` accepting it is the whole reason that function was weaker
 * than the rules it was supposed to mirror.
 *
 * Kept in step with `isManager()` in firestore.rules. If the definition changes,
 * both move together — and firestore.rules is the one that matters, because the
 * Admin SDK bypasses it.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { hasRecordedRole, hasGrantedRole, RoleBearing } from './roles';

/**
 * The authority test, as a pure function over a user document.
 *
 * Separated from the read so it can be exhaustively tested without a Firestore
 * fake — the truth table is the part that was wrong five times.
 *
 * Uses `hasRecordedRole`, not `hasGrantedRole`: the role hierarchy expands
 * downward only, so nothing below manager may imply it. Reading the granted set
 * here would make every driver a manager.
 */
export function isApprovedManagerData(data: unknown): boolean {
    const user = data as RoleBearing | null | undefined;
    if (!user) return false;

    return user.accountStatus === 'approved' && hasRecordedRole(user, 'manager');
}

/**
 * Throw unless `uid` belongs to an approved manager. Returns their document, so
 * callers that need the manager's name for an audit row do not read it twice.
 *
 * Reads the document every time rather than trusting a custom claim: a claim
 * lives on an ID token for up to an hour after a demotion, and every caller here
 * is a destructive or PII-exporting path. Claims are an optimisation for reads,
 * not a source of authority.
 */
export async function assertApprovedManager(
    db: admin.firestore.Firestore,
    uid: string,
    action = 'do this',
): Promise<Record<string, unknown>> {
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.data();

    if (!isApprovedManagerData(data)) {
        throw new functions.https.HttpsError(
            'permission-denied',
            `Only approved managers can ${action}.`,
        );
    }

    return data as Record<string, unknown>;
}

/**
 * The same test for someone acting as a driver.
 *
 * `hasGrantedRole`, not `hasRecordedRole` — the opposite of the manager check
 * above, and deliberately so. Manager is the top of the hierarchy, so reading
 * the granted set there would promote every driver. Driver is below it, and in
 * this congregation every driver is recorded as a manager who also drives, so
 * reading only the recorded set here would refuse all of them.
 */
export function isApprovedDriverData(data: unknown): boolean {
    const user = data as RoleBearing | null | undefined;
    if (!user) return false;

    return user.accountStatus === 'approved' && hasGrantedRole(user, 'driver');
}

/**
 * Throw unless `uid` belongs to an approved driver. Returns their document so
 * the caller does not read it twice.
 *
 * ADDED 2026-08-14, and it was never there before. globalAssignDriver checked
 * that a caller was dispatching themselves, and nothing else — no account
 * status, no role. The only mention of `accountStatus` anywhere in that function
 * was inside the query that built K-means SEEDS, which authorises nobody; a test
 * named "a revoked driver gets no riders" asserted the clause was in that query
 * and never that a revoked caller was refused.
 *
 * So a revoked account that was still signed in and still holding a car could
 * tap Assign Me and be handed riders — receiving the names, phone numbers and
 * home addresses of children, which is precisely what revoking was meant to stop.
 *
 * Read fresh every time, for the same reason as assertApprovedManager: a custom
 * claim survives on an ID token for up to an hour after a revocation.
 */
export async function assertApprovedDriver(
    db: admin.firestore.Firestore,
    uid: string,
    action = 'do this',
): Promise<Record<string, unknown>> {
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.data();

    if (!isApprovedDriverData(data)) {
        throw new functions.https.HttpsError(
            'permission-denied',
            `Only approved drivers can ${action}.`,
        );
    }

    return data as Record<string, unknown>;
}
