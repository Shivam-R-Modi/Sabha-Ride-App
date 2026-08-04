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
exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { targetUserId, targetUserIds } = data;
    const callerUid = context.auth.uid;
    const db = admin.firestore();
    try {
        // 1. Verify caller is an approved manager
        const callerDoc = await db.collection('users').doc(callerUid).get();
        if (!callerDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Caller profile not found');
        }
        const callerData = callerDoc.data();
        const isCallerManager = ((callerData === null || callerData === void 0 ? void 0 : callerData.role) === 'manager' || (callerData === null || callerData === void 0 ? void 0 : callerData.registeredRole) === 'manager') &&
            (callerData === null || callerData === void 0 ? void 0 : callerData.accountStatus) === 'approved';
        if (!isCallerManager) {
            throw new functions.https.HttpsError('permission-denied', 'Only approved managers can delete users');
        }
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
            batch.delete(db.collection('vehicles').doc(uid));
            batch.delete(db.collection('cars').doc(uid));
            await batch.commit();
            deletedFirestoreCount++;
            // Delete Firebase Authentication Account via Admin SDK
            try {
                await admin.auth().deleteUser(uid);
                deletedAuthCount++;
            }
            catch (authErr) {
                // If user doesn't exist in Auth or was already deleted, log warning
                console.warn(`Auth deletion warning for UID ${uid}:`, authErr.message || authErr);
            }
            // Log Audit Entry
            try {
                await db.collection('auditLogs').add({
                    timestamp: new Date().toISOString(),
                    managerId: callerUid,
                    managerName: (callerData === null || callerData === void 0 ? void 0 : callerData.name) || 'Manager',
                    action: 'DELETE',
                    collection: 'users',
                    documentId: uid,
                    details: 'Admin permanently deleted user Firestore record and Firebase Auth account'
                });
            }
            catch (auditErr) {
                console.warn('Audit log write error:', auditErr);
            }
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