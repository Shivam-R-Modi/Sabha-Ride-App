"use strict";
// ============================================
// HTTP FUNCTION: verifyManagerCode
// Server-side verification of manager access code
// Reads from Firestore settings — no user doc required
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
/**
 * HTTP Callable: Verify manager access code
 * Input: { code: string }
 * Output: { valid: boolean }
 *
 * Simply checks the code against settings/managerCode in Firestore.
 * Does NOT require the user doc to exist yet (called before doc creation).
 * The client is responsible for writing the user doc with the correct status.
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
    try {
        // Read manager code from Firestore settings
        const managerCodeDoc = await db.collection('settings').doc('managerCode').get();
        if (!managerCodeDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Manager access code not configured. Please contact administrator.');
        }
        const managerCodeData = managerCodeDoc.data();
        const validCode = managerCodeData === null || managerCodeData === void 0 ? void 0 : managerCodeData.code;
        if (!validCode) {
            throw new functions.https.HttpsError('failed-precondition', 'Manager access code not configured properly.');
        }
        // Verify the code
        const isValid = code === validCode;
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