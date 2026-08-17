"use strict";
// ============================================
// The manager's recurring sabha schedule: read and write the rule.
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
exports.describeRule = describeRule;
/**
 * One record, no horizon.
 *
 * `topUpCalendar` used to live here and wrote one `events/{date}` document per
 * occurrence out to a chosen horizon. It is gone. The rule in
 * `settings/sabhaRecurrence` IS the schedule now, and `findCurrentEvent` computes
 * from it — see the long note at the top of utils/recurrence.ts for why that is
 * both simpler and one whole bug class smaller.
 *
 * So this file has one job: validate and store the rule. Nothing is generated,
 * which is why nothing here needs a watermark, an `occupied` set, or a batch.
 */
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const authz_1 = require("../utils/authz");
const audit_1 = require("../utils/audit");
const recurrence_1 = require("../utils/recurrence");
exports.RECURRENCE_DOC = 'settings/sabhaRecurrence';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * Read the rule, already validated.
 *
 * A rule that cannot be understood returns null and schedules nothing — see the
 * note on `normaliseRecurrence` for why guessing is worse than stopping.
 */
async function readRecurrence(db) {
    const snap = await db.doc(exports.RECURRENCE_DOC).get();
    return snap.exists ? (0, recurrence_1.normaliseRecurrence)(snap.data()) : null;
}
/** How the schedule reads on a manager's screen and in an audit row. */
function describeRule(rule) {
    if (!rule.enabled)
        return 'Recurring sabha turned off';
    const days = rule.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
    return `Every ${days}, ${rule.startTime}–${rule.endTime}`;
}
/**
 * HTTP Callable: a manager sets the recurring pattern.
 *
 * Input: { enabled, daysOfWeek, startTime, endTime }
 * Output: { rule }
 *
 * No `weeksAhead`. There is no horizon any more: the rule repeats until a manager
 * changes it, and a single date is changed by writing an exception for that date
 * rather than by re-generating a window.
 */
exports.updateSabhaRecurrence = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const db = admin.firestore();
    // Changing when a whole congregation gathers. Manager only.
    await (0, authz_1.assertApprovedManager)(db, context.auth.uid, 'change the sabha schedule');
    // Validated through the same function the scheduler uses, so a rule the
    // scheduler would refuse cannot be saved — otherwise the manager sees a saved
    // setting that silently schedules nothing.
    const rule = (0, recurrence_1.normaliseRecurrence)({
        enabled: (data === null || data === void 0 ? void 0 : data.enabled) === true,
        daysOfWeek: data === null || data === void 0 ? void 0 : data.daysOfWeek,
        startTime: data === null || data === void 0 ? void 0 : data.startTime,
        endTime: data === null || data === void 0 ? void 0 : data.endTime,
        venue: (_a = data === null || data === void 0 ? void 0 : data.venue) !== null && _a !== void 0 ? _a : null,
        agenda: (_b = data === null || data === void 0 ? void 0 : data.agenda) !== null && _b !== void 0 ? _b : '',
    });
    if (!rule) {
        throw new functions.https.HttpsError('invalid-argument', 'Pick at least one day, and an end time later than the start time.');
    }
    const now = new Date();
    await db.doc(exports.RECURRENCE_DOC).set({
        enabled: rule.enabled,
        daysOfWeek: rule.daysOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        venue: rule.venue,
        agenda: rule.agenda,
        updatedAt: now.toISOString(),
        updatedBy: context.auth.uid,
        // Deleted along with the generator. Removed rather than left behind, so a
        // stale value cannot be read back by anything that has not been updated.
        weeksAhead: admin.firestore.FieldValue.delete(),
        generatedThrough: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    await (0, audit_1.writeAuditLog)(db, {
        action: 'doc.update',
        actorUid: context.auth.uid,
        actorName: 'Manager',
        targetCollection: 'settings',
        targetDocumentId: 'sabhaRecurrence',
        summary: describeRule(rule),
        details: Object.assign({}, rule),
    });
    return { rule };
});
//# sourceMappingURL=sabhaRecurrence.js.map