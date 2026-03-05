"use strict";
// ============================================
// HTTP FUNCTION: verifyManagerCode
// Server-side verification of manager access code
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
// Manager code stored server-side only — never exposed to client
const MANAGER_ACCESS_CODE = 'SABHA2024';
/**
 * HTTP Callable: Verify manager access code
 * Input: { code: string }
 * Output: { valid: boolean }
 *
 * If valid, auto-approves the calling user's account.
 */
exports.verifyManagerCode = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { code } = data;
    if (!code || typeof code !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Access code is required');
    }
    const db = admin.firestore();
    const userId = context.auth.uid;
    try {
        // Get user profile to verify they selected manager role
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User profile not found');
        }
        const userData = userDoc.data();
        if ((userData === null || userData === void 0 ? void 0 : userData.role) !== 'manager' && (userData === null || userData === void 0 ? void 0 : userData.registeredRole) !== 'manager') {
            throw new functions.https.HttpsError('permission-denied', 'Only manager accounts can verify access codes');
        }
        // Verify the code server-side
        const isValid = code === MANAGER_ACCESS_CODE;
        if (isValid) {
            // Auto-approve the manager account
            await db.collection('users').doc(userId).update({
                accountStatus: 'approved',
            });
        }
        return { valid: isValid };
    }
    catch (error) {
        console.error('Error verifying manager code:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to verify access code');
    }
});
//# sourceMappingURL=verifyManagerCode.js.map