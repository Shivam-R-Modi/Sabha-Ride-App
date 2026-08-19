"use strict";
// ============================================
// HTTP FUNCTION: deleteNotice
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
exports.deleteNotice = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const authz_1 = require("../utils/authz");
const audit_1 = require("../utils/audit");
const noticeStorage_1 = require("../utils/noticeStorage");
/**
 * Take a notice down, and its image with it.
 *
 * A client cannot do this — `firestore.rules` denies delete on `notices`
 * outright — because deleting the document first loses the only reference to the
 * Storage object and orphans it forever. Image first, then document.
 */
exports.deleteNotice = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const noticeId = String((_a = data === null || data === void 0 ? void 0 : data.noticeId) !== null && _a !== void 0 ? _a : '');
    if (!noticeId) {
        throw new functions.https.HttpsError('invalid-argument', 'noticeId is required');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const manager = await (0, authz_1.assertApprovedManager)(db, uid, 'remove a notice');
    const ref = db.collection('notices').doc(noticeId);
    const snap = await ref.get();
    if (!snap.exists) {
        // Idempotent: a second tap, or two managers at once, is not an error.
        return { success: true, alreadyGone: true };
    }
    const imageRemoved = await (0, noticeStorage_1.deleteNoticeImage)((_b = snap.data()) === null || _b === void 0 ? void 0 : _b.imagePath);
    await ref.delete();
    await (0, audit_1.writeAuditLog)(db, {
        action: 'notice.delete',
        actorUid: uid,
        actorName: String((_c = manager.name) !== null && _c !== void 0 ? _c : 'A manager'),
        targetCollection: 'notices',
        targetDocumentId: noticeId,
        summary: `Removed a notice${imageRemoved ? '' : ' (its image could not be deleted)'}`,
        outcome: 'ok',
    });
    return { success: true, alreadyGone: false, imageRemoved };
});
//# sourceMappingURL=deleteNotice.js.map