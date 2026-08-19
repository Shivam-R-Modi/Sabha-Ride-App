"use strict";
// ============================================
// HTTP FUNCTION: publishNotice
// A manager posts to the notice board.
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
exports.publishNotice = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const authz_1 = require("../utils/authz");
const rateLimiter_1 = require("../utils/rateLimiter");
const audit_1 = require("../utils/audit");
const notifications_1 = require("../utils/notifications");
/** A long flyer, and nowhere near a payload. Mirrored in firestore.rules. */
const MAX_BODY = 4000;
/** How much of the body a push carries. A notification is a nudge, not the notice. */
const PUSH_EXCERPT = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
exports.publishNotice = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const manager = await (0, authz_1.assertApprovedManager)(db, uid, 'publish a notice');
    // Line breaks are KEPT here, unlike managerBroadcast which collapses them —
    // a notice is rendered as a paragraph block with `whitespace-pre-line`, and
    // the flyer format depends on them. Only trailing whitespace goes.
    const body = String((_a = data === null || data === void 0 ? void 0 : data.body) !== null && _a !== void 0 ? _a : '').trim();
    if (!body) {
        throw new functions.https.HttpsError('invalid-argument', 'A message is required');
    }
    if (body.length > MAX_BODY) {
        throw new functions.https.HttpsError('invalid-argument', `Keep it under ${MAX_BODY} characters`);
    }
    const showUntil = (data === null || data === void 0 ? void 0 : data.showUntil) ? String(data.showUntil) : null;
    if (showUntil && !ISO_DATE.test(showUntil)) {
        throw new functions.https.HttpsError('invalid-argument', 'showUntil must be YYYY-MM-DD');
    }
    const eventId = (data === null || data === void 0 ? void 0 : data.eventId) ? String(data.eventId) : null;
    if (eventId && !ISO_DATE.test(eventId)) {
        throw new functions.https.HttpsError('invalid-argument', 'eventId must be YYYY-MM-DD');
    }
    const imagePath = (data === null || data === void 0 ? void 0 : data.imagePath) ? String(data.imagePath) : null;
    const imageUrl = (data === null || data === void 0 ? void 0 : data.imageUrl) ? String(data.imageUrl) : null;
    // A path without a URL cannot be rendered; a URL without a path cannot be
    // deleted, which is how Storage silently fills up. Refuse half a pair.
    if (Boolean(imagePath) !== Boolean(imageUrl)) {
        throw new functions.https.HttpsError('invalid-argument', 'An image needs both its path and its URL');
    }
    // The path must be inside this notice's own folder — otherwise a manager
    // could point a notice at, and later delete, any object in the bucket.
    if (imagePath && (!imagePath.startsWith('notices/') || imagePath.includes('..'))) {
        throw new functions.https.HttpsError('invalid-argument', 'Image path is not a notice image');
    }
    await (0, rateLimiter_1.checkRateLimit)(uid, {
        maxRequests: 20, windowMs: 60 * 60 * 1000, functionName: 'publishNotice',
    });
    const auditRef = await (0, audit_1.writeAuditLog)(db, {
        action: 'notice.publish',
        actorUid: uid,
        actorName: String((_b = manager.name) !== null && _b !== void 0 ? _b : 'A manager'),
        targetCollection: 'notices',
        targetDocumentId: 'new',
        summary: `Published a notice: "${body.slice(0, 80)}"`,
        outcome: 'pending',
    });
    const ref = await db.collection('notices').add({
        body,
        imagePath,
        imageUrl,
        showUntil,
        eventId,
        createdAt: new Date().toISOString(),
        createdByUid: uid,
        createdByName: String((_c = manager.name) !== null && _c !== void 0 ? _c : 'A manager'),
    });
    if (auditRef) {
        await auditRef.set({ outcome: 'ok', targetDocumentId: ref.id, completedAt: new Date().toISOString() }, { merge: true });
    }
    // The push is deliberately AFTER the write and outside its own try/catch
    // boundary being fatal: the notice is published either way, and
    // notifyEveryone already swallows its own failures. Routing through it also
    // means a notice cannot dodge the congregation broadcast floor.
    if ((data === null || data === void 0 ? void 0 : data.push) === true) {
        const excerpt = body.length > PUSH_EXCERPT ? `${body.slice(0, PUSH_EXCERPT).trimEnd()}…` : body;
        await (0, notifications_1.notifyEveryone)('New notice', excerpt, { type: 'notice', noticeId: ref.id });
    }
    return { success: true, noticeId: ref.id };
});
//# sourceMappingURL=publishNotice.js.map