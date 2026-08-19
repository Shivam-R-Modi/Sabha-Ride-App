"use strict";
// ============================================
// SCHEDULED: expireNotices
// Takes down notices that are past, and their images.
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
exports.expireNotices = void 0;
exports.noticeIsPast = noticeIsPast;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const time_1 = require("../utils/time");
const noticeStorage_1 = require("../utils/noticeStorage");
/** Same ceiling as expireStaleRequests: a runaway sweep is worse than a slow one. */
const MAX_PER_RUN = 200;
/**
 * A notice is past when the day it names has ENDED.
 *
 * Compared as `YYYY-MM-DD` strings in the sabha's own timezone, via
 * `zonedDateKey` — not `toISOString().slice(0, 10)`. A UTC comparison would take
 * an evening notice down five hours early on the east coast, which is exactly
 * during the sabha it was advertising.
 *
 * `showUntil` wins if both are set; `eventId` is the fallback so a notice tied to
 * a sabha disappears with it without the manager also picking a date.
 */
function noticeIsPast(notice, todayKey) {
    var _a, _b;
    const until = (_b = (_a = notice.showUntil) !== null && _a !== void 0 ? _a : notice.eventId) !== null && _b !== void 0 ? _b : null;
    if (!until)
        return false; // no date given: it stays until removed
    return until < todayKey; // shows for the whole of its own day
}
exports.expireNotices = functions.pubsub
    .schedule('every day 03:00')
    .timeZone(time_1.DEFAULT_TIME_ZONE)
    .onRun(async () => {
    var _a;
    const db = admin.firestore();
    try {
        const todayKey = (0, time_1.zonedDateKey)(new Date(), time_1.DEFAULT_TIME_ZONE);
        const snapshot = await db.collection('notices').get();
        const past = snapshot.docs
            .filter(doc => { var _a; return noticeIsPast((_a = doc.data()) !== null && _a !== void 0 ? _a : {}, todayKey); })
            .slice(0, MAX_PER_RUN);
        if (past.length === 0) {
            console.log('[expireNotices] nothing to take down');
            return null;
        }
        let imagesLeft = 0;
        for (const doc of past) {
            // Image FIRST. Deleting the document first loses the only
            // reference to the object and orphans it for ever.
            const removed = await (0, noticeStorage_1.deleteNoticeImage)((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.imagePath);
            if (!removed)
                imagesLeft += 1;
            await doc.ref.delete();
        }
        console.log(`[expireNotices] removed ${past.length} notice(s)` +
            (imagesLeft ? `; ${imagesLeft} image(s) could not be deleted` : ''));
        return null;
    }
    catch (error) {
        // Never throw. This shares the 03:00 slot with the sweep that expires
        // ride requests, and a notice-board failure must not take that down.
        console.error('[expireNotices] Error:', error);
        return null;
    }
});
//# sourceMappingURL=expireNotices.js.map