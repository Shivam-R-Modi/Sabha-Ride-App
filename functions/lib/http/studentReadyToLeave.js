"use strict";
// ============================================
// HTTP FUNCTION: studentReadyToLeave
// Triggered when student clicks "Ready to Leave"
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
exports.studentReadyToLeave = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * HTTP Callable: Student ready to leave Sabha
 * Updates student status for drop-off assignment
 * Input: { studentId: string }
 * Output: Success confirmation
 */
exports.studentReadyToLeave = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { studentId } = data;
    if (!studentId) {
        throw new functions.https.HttpsError('invalid-argument', 'studentId is required');
    }
    const db = admin.firestore();
    try {
        // Get student details
        const studentDoc = await db.collection('students').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = studentDoc.data();
        // Verify the caller is the student
        if ((student === null || student === void 0 ? void 0 : student.userId) !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the student can mark themselves ready');
        }
        // Check if student is at Sabha (must have completed pickup)
        if ((student === null || student === void 0 ? void 0 : student.status) !== 'at_sabha') {
            throw new functions.https.HttpsError('failed-precondition', 'You must be at Sabha to request drop-off');
        }
        // Check if it's after 10 PM on Friday
        const now = new Date();
        const dayOfWeek = now.getDay();
        const hour = now.getHours();
        if (dayOfWeek !== 5 || hour < 22) {
            throw new functions.https.HttpsError('failed-precondition', 'Drop-off requests only available after 10 PM on Friday');
        }
        // Update student status
        await db.collection('students').doc(studentId).update({
            status: 'waiting_for_dropoff',
            dropoffRequested: true,
            currentRideId: null
        });
        return {
            success: true,
            studentId,
            message: 'You are now in the queue for drop-off',
            status: 'waiting_for_dropoff'
        };
    }
    catch (error) {
        console.error('Error marking student ready:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to mark student ready');
    }
});
//# sourceMappingURL=studentReadyToLeave.js.map