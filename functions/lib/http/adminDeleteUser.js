"use strict";
// ============================================
// HTTP FUNCTION: adminDeleteUser
// Server-side permanent deletion of user profile,
// mirror documents (students, drivers, cars), and Firebase Auth account.
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
exports.adminDeleteUser = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const authz_1 = require("../utils/authz");
const audit_1 = require("../utils/audit");
const fleet_1 = require("../utils/fleet");
exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { targetUserId, targetUserIds } = data;
    const callerUid = context.auth.uid;
    const db = admin.firestore();
    try {
        // 1. Verify caller is an approved manager.
        // This check omitted the `roles` array arm, so it disagreed with the other
        // four call sites and with firestore.rules: a manager whose document
        // records the role only in `roles[]` was refused here while passing
        // everywhere else.
        const callerData = await (0, authz_1.assertApprovedManager)(db, callerUid, 'delete users');
        // Collect array of target UIDs to delete
        const uidsToDelete = [];
        if (typeof targetUserId === 'string' && targetUserId.trim()) {
            uidsToDelete.push(targetUserId.trim());
        }
        if (Array.isArray(targetUserIds)) {
            targetUserIds.forEach((id) => {
                if (typeof id === 'string' && id.trim()) {
                    uidsToDelete.push(id.trim());
                }
            });
        }
        if (uidsToDelete.length === 0) {
            throw new functions.https.HttpsError('invalid-argument', 'targetUserId or targetUserIds is required');
        }
        let deletedAuthCount = 0;
        let deletedFirestoreCount = 0;
        for (const uid of uidsToDelete) {
            const batch = db.batch();
            // Delete Firestore documents across collections
            batch.delete(db.collection('users').doc(uid));
            batch.delete(db.collection('students').doc(uid));
            batch.delete(db.collection('drivers').doc(uid));
            // Hand back any car this person was holding.
            //
            // This used to be `batch.delete(vehicles/{uid})` and
            // `batch.delete(cars/{uid})` — documents keyed by the USER's uid.
            // Vehicles have their own ids, so those two lines matched nothing on
            // any real fleet and quietly did NOTHING. Deleting a driver therefore
            // left `assignedDriverId` pointing at a uid with no user document, and
            // because every release path reads the DRIVER's record to find their
            // car, no code in the app could ever free it again.
            //
            // Found in production on 2026-08-14: one of three cars in the fleet
            // was permanently `in_use`, held by a deleted account, which is a
            // third of the fleet gone with nothing reporting it.
            //
            // Released BEFORE the commit and in the same batch, so the car cannot
            // be orphaned by a crash between deleting the user and freeing it.
            const releasedVehicleIds = await (0, fleet_1.releaseVehiclesHeldBy)(db, batch, uid);
            await batch.commit();
            deletedFirestoreCount++;
            if (releasedVehicleIds.length > 0) {
                console.log(`[adminDeleteUser] Released ${releasedVehicleIds.join(', ')} held by ${uid}`);
            }
            // Delete Firebase Authentication Account via Admin SDK
            try {
                await admin.auth().deleteUser(uid);
                deletedAuthCount++;
            }
            catch (authErr) {
                // If user doesn't exist in Auth or was already deleted, log warning
                console.warn(`Auth deletion warning for UID ${uid}:`, authErr.message || authErr);
            }
            // Log Audit Entry. writeAuditLog swallows its own failures, for the
            // same reason the try/catch here did: the account is already gone, and
            // failing the call now would report a deletion that did happen as an
            // error.
            await (0, audit_1.writeAuditLog)(db, {
                action: 'user.delete',
                actorUid: callerUid,
                actorName: String((callerData === null || callerData === void 0 ? void 0 : callerData.name) || 'Manager'),
                targetCollection: 'users',
                targetDocumentId: uid,
                summary: releasedVehicleIds.length > 0
                    ? `Permanently deleted the user's profile and sign-in account, and released ${releasedVehicleIds.length} vehicle(s) they held`
                    : 'Permanently deleted the user\'s profile and sign-in account',
                details: {
                    deletedAuthAccount: deletedAuthCount > 0,
                    // Named so a manager reading the log can tell which car came
                    // back, rather than discovering it changed status for no
                    // recorded reason.
                    releasedVehicleIds,
                },
            });
        }
        return {
            success: true,
            deletedCount: uidsToDelete.length,
            deletedAuthCount,
            deletedFirestoreCount
        };
    }
    catch (error) {
        console.error('Error in adminDeleteUser:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to permanently delete user(s)');
    }
});
//# sourceMappingURL=adminDeleteUser.js.map