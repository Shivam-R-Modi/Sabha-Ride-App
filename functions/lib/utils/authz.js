"use strict";
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
exports.isApprovedManagerData = isApprovedManagerData;
exports.assertApprovedManager = assertApprovedManager;
const functions = __importStar(require("firebase-functions"));
const roles_1 = require("./roles");
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
function isApprovedManagerData(data) {
    const user = data;
    if (!user)
        return false;
    return user.accountStatus === 'approved' && (0, roles_1.hasRecordedRole)(user, 'manager');
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
async function assertApprovedManager(db, uid, action = 'do this') {
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.data();
    if (!isApprovedManagerData(data)) {
        throw new functions.https.HttpsError('permission-denied', `Only approved managers can ${action}.`);
    }
    return data;
}
//# sourceMappingURL=authz.js.map