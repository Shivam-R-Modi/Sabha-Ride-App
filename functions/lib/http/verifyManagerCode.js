"use strict";
// ============================================
// HTTP FUNCTION: verifyManagerCode
// Server-side verification of the manager access code.
//
// This is the ONLY path by which an account becomes a manager. It exists
// because the browser must never learn the code and must never grant itself
// the role:
//
//  - RoleSelection used to compare the typed code against
//    ['sabha2026', 'sabha2024'], hardcoded in the client and therefore shipped
//    in the JS bundle to every visitor. A permanent backdoor that could not be
//    rotated without a redeploy, and that anyone could read with View Source.
//  - It also read settings/managerCode straight from the client, so the real
//    code was exposed to any account that could sign up. firestore.rules now
//    denies that read, which had quietly left the hardcoded pair as the only
//    working codes.
//  - Having verified the code in the browser, it then wrote
//    accountStatus: 'approved' onto its own user document. Self-granted
//    authority: skip the check, write the field, become a manager.
//
// So the code is compared here, and the profile is written here with the Admin
// SDK, which bypasses security rules. The client sends a candidate code and
// receives a boolean.
// ============================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyManagerCode = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const rateLimiter_1 = require("../utils/rateLimiter");
const tenancy_1 = require("../constants/tenancy");
/** Codes are compared case-insensitively and ignoring spaces, as they always were. */
function normalise(code) {
    return code.toLowerCase().replace(/\s+/g, '');
}
/**
 * HTTP Callable: verify the manager access code and, on success, make the
 * caller an approved manager.
 *
 * Input:  { code: string }
 * Output: { valid: boolean }
 *
 * An invalid code returns { valid: false } rather than throwing, so the client
 * can show an inline "wrong code" message and let the user retry. Everything
 * else — unauthenticated, missing code, code not configured — throws.
 */
exports.verifyManagerCode = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // This endpoint is a guessing oracle for a short shared secret, so it needs
    // a limit. Five attempts per fifteen minutes leaves room for a typo and
    // makes brute force impractical.
    await (0, rateLimiter_1.checkRateLimit)(context.auth.uid, {
        maxRequests: 5,
        windowMs: 15 * 60 * 1000,
        functionName: 'verifyManagerCode',
    });
    const { code } = data;
    if (!code || typeof code !== 'string' || !code.trim()) {
        throw new functions.https.HttpsError('invalid-argument', 'Access code is required');
    }
    const db = admin.firestore();
    const userId = context.auth.uid;
    try {
        const managerCodeDoc = await db.collection('settings').doc('managerCode').get();
        if (!managerCodeDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Manager access code not configured. Please contact administrator.');
        }
        const validCode = (_a = managerCodeDoc.data()) === null || _a === void 0 ? void 0 : _a.code;
        if (!validCode || typeof validCode !== 'string') {
            throw new functions.https.HttpsError('failed-precondition', 'Manager access code not configured properly.');
        }
        if (normalise(code) !== normalise(validCode)) {
            console.warn(`[verifyManagerCode] Rejected attempt by ${userId}`);
            return { valid: false };
        }
        // Valid. Write the manager profile here rather than letting the client
        // do it — the whole point of the callable. merge:true covers both
        // entry points: RoleSelection, where no user document exists yet, and
        // PendingApproval, where one exists and only needs approving.
        await db.collection('users').doc(userId).set({
            role: 'manager',
            registeredRole: 'manager',
            // The GRANTED set, so one query answers "who can drive?" everywhere.
            // This wrote ['manager'], and every driver in this congregation is a
            // manager — so the dispatch pool and the driver picker matched nobody.
            roles: ['manager', 'driver', 'student'],
            activeRole: 'manager',
            accountStatus: 'approved',
            email: (_b = context.auth.token.email) !== null && _b !== void 0 ? _b : null,
            approvedAt: new Date().toISOString(),
            approvedVia: 'managerCode',
        }, { merge: true });
        // Mint the read claim in the same operation as the promotion, so the two
        // never drift. Best-effort on purpose: firestore.rules falls back to the
        // user document, so a failure here costs a get() per read and nothing
        // else. Failing the promotion over it would be the worse trade — the user
        // would be told the code was wrong when it was not.
        try {
            await admin.auth().setCustomUserClaims(userId, {
                mgr: true, sm: false, city: tenancy_1.FOUNDING_CITY_ID,
            });
        }
        catch (claimErr) {
            console.error('[verifyManagerCode] Could not set manager claim:', claimErr);
        }
        console.log(`[verifyManagerCode] Approved ${userId} as manager`);
        return { valid: true };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error('Error verifying manager code:', error);
        throw new functions.https.HttpsError('internal', 'Failed to verify access code');
    }
});
//# sourceMappingURL=verifyManagerCode.js.map