"use strict";
// ============================================
// The manager's recurring sabha schedule: read, write, and top up.
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
exports.updateSabhaRecurrence = exports.RECURRENCE_DOC = void 0;
exports.readRecurrence = readRecurrence;
exports.topUpCalendar = topUpCalendar;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const authz_1 = require("../utils/authz");
const audit_1 = require("../utils/audit");
const settings_1 = require("../utils/settings");
const events_1 = require("../utils/events");
const time_1 = require("../utils/time");
const recurrence_1 = require("../utils/recurrence");
exports.RECURRENCE_DOC = 'settings/sabhaRecurrence';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * Read the pattern, already validated.
 *
 * A config that cannot be understood returns null and generates nothing — see the
 * note on `normaliseRecurrence` for why guessing is worse than stopping.
 */
async function readRecurrence(db) {
    const snap = await db.doc(exports.RECURRENCE_DOC).get();
    return snap.exists ? (0, recurrence_1.normaliseRecurrence)(snap.data()) : null;
}
/**
 * Create whatever the pattern says is missing, and move the watermark.
 *
 * Shared by the daily job and the manager's "Fill the calendar now" button, so the
 * button cannot drift from what the cron actually does — the usual way a manual
 * trigger ends up testing a different code path from the real one.
 *
 * Reads the existing documents across the whole horizon *including cancelled
 * ones*, because a cancelled gathering keeps its document and regenerating over
 * it would both un-cancel it and reject the batch on ALREADY_EXISTS.
 */
async function topUpCalendar(db, config, now, timeZone) {
    if (!config.enabled)
        return [];
    const today = (0, time_1.zonedDateKey)(now, timeZone);
    const horizon = (0, time_1.addDaysToDateKey)(today, config.weeksAhead * 7);
    const scan = await db.collection(events_1.EVENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '>=', today)
        .where(admin.firestore.FieldPath.documentId(), '<=', horizon)
        .get();
    const occupied = new Set(scan.docs.map(d => d.id));
    const dates = (0, recurrence_1.datesToGenerate)(config, now, timeZone, occupied);
    const mark = (0, recurrence_1.advanceWatermark)(config, now, timeZone);
    // The watermark moves whether or not anything was created. If it only moved
    // on a successful create, a horizon already filled by hand would leave the
    // mark short and those dates would be offered again for ever.
    const batch = db.batch();
    for (const date of dates) {
        batch.create(db.collection(events_1.EVENTS_COLLECTION).doc(date), {
            date,
            startTime: config.startTime,
            endTime: config.endTime,
            venue: null,
            status: 'scheduled',
            agenda: '',
            autoCreated: true,
            fromRecurrence: true,
            createdAt: now.toISOString(),
        });
    }
    batch.set(db.doc(exports.RECURRENCE_DOC), { generatedThrough: mark }, { merge: true });
    await batch.commit();
    return dates;
}
/**
 * HTTP Callable: a manager sets the recurring pattern.
 *
 * Input: { enabled, daysOfWeek, startTime, endTime, weeksAhead }
 * Output: { config, created: string[] }
 *
 * Saving fills the calendar immediately rather than waiting for 03:00, so the
 * manager sees the dates appear and can tell the setting worked. A control whose
 * effect is invisible until tomorrow is one nobody trusts.
 */
exports.updateSabhaRecurrence = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const db = admin.firestore();
    // Changing when a whole congregation gathers, and creating documents that
    // drive every ride window. Manager only.
    await (0, authz_1.assertApprovedManager)(db, context.auth.uid, 'change the sabha schedule');
    const enabled = (data === null || data === void 0 ? void 0 : data.enabled) === true;
    // Validate through the same function the scheduled job uses. A pattern the
    // job would refuse must not be saveable — otherwise the manager sees a saved
    // setting that silently never generates anything.
    const candidate = (0, recurrence_1.normaliseRecurrence)({
        enabled,
        daysOfWeek: data === null || data === void 0 ? void 0 : data.daysOfWeek,
        startTime: data === null || data === void 0 ? void 0 : data.startTime,
        endTime: data === null || data === void 0 ? void 0 : data.endTime,
        weeksAhead: (_a = data === null || data === void 0 ? void 0 : data.weeksAhead) !== null && _a !== void 0 ? _a : recurrence_1.DEFAULT_WEEKS_AHEAD,
        // Preserved below from the stored document; never accepted from a client,
        // or a manager could roll it back and resurrect dates they had deleted.
        generatedThrough: null,
    });
    if (!candidate) {
        throw new functions.https.HttpsError('invalid-argument', 'Pick at least one day, and an end time later than the start time.');
    }
    if (typeof (data === null || data === void 0 ? void 0 : data.weeksAhead) === 'number'
        && (data.weeksAhead < recurrence_1.MIN_WEEKS_AHEAD || data.weeksAhead > recurrence_1.MAX_WEEKS_AHEAD)) {
        throw new functions.https.HttpsError('invalid-argument', `Fill the calendar between ${recurrence_1.MIN_WEEKS_AHEAD} and ${recurrence_1.MAX_WEEKS_AHEAD} weeks ahead.`);
    }
    // The watermark is server-owned. Carry the existing one across untouched: it
    // is the only thing keeping a deleted date deleted.
    const existing = await db.doc(exports.RECURRENCE_DOC).get();
    const previousMark = (_b = existing.data()) === null || _b === void 0 ? void 0 : _b.generatedThrough;
    const config = Object.assign(Object.assign({}, candidate), { generatedThrough: typeof previousMark === 'string' ? previousMark : null });
    const now = new Date();
    const timeZone = await (0, settings_1.getTimeZone)();
    await db.doc(exports.RECURRENCE_DOC).set({
        enabled: config.enabled,
        daysOfWeek: config.daysOfWeek,
        startTime: config.startTime,
        endTime: config.endTime,
        weeksAhead: config.weeksAhead,
        generatedThrough: config.generatedThrough,
        updatedAt: now.toISOString(),
        updatedBy: context.auth.uid,
    }, { merge: true });
    const created = await topUpCalendar(db, config, now, timeZone);
    const pattern = config.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
    await (0, audit_1.writeAuditLog)(db, {
        action: 'doc.update',
        actorUid: context.auth.uid,
        actorName: 'Manager',
        targetCollection: 'settings',
        targetDocumentId: 'sabhaRecurrence',
        summary: config.enabled
            ? `Recurring sabha set to ${pattern} ${config.startTime}–${config.endTime}, `
                + `${config.weeksAhead} weeks ahead (created ${created.length})`
            : 'Recurring sabha turned off',
        details: Object.assign(Object.assign({}, config), { created }),
    });
    return { config, created };
});
//# sourceMappingURL=sabhaRecurrence.js.map