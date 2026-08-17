"use strict";
/**
 * Sabha events — the list of actual gatherings.
 *
 * Everything used to be derived from "the upcoming Friday", so the day was a
 * constant in the code. This replaces that with a list of real events, each with
 * its own date, times, venue and status.
 *
 * Documents are `events/{YYYY-MM-DD}`, keyed by their own date. Deliberate:
 *
 *  - Attendance is stored under `weeklyAttendance/{eventId}`, and eventId has
 *    always been the gathering's date. Keying events the same way means every
 *    existing attendance record still lines up, so this needs no migration.
 *  - It makes "is there a sabha on the 14th?" a document read rather than a
 *    query.
 *
 * The cost is that two gatherings cannot share a date. That is a real
 * limitation, and the right time to lift it is when locations arrive (roadmap
 * phase 2), because per-location events need a compound key anyway.
 */
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
exports.SEED_MARKER_DOC = exports.EVENTS_COLLECTION = void 0;
exports.eventKeyFromRide = eventKeyFromRide;
exports.findCurrentEvent = findCurrentEvent;
const admin = __importStar(require("firebase-admin"));
const time_1 = require("./time");
const recurrence_1 = require("./recurrence");
exports.EVENTS_COLLECTION = 'events';
/**
 * Where the seed marker lives.
 *
 * `system/*` is denied to every client in firestore.rules, so only a Cloud
 * Function can write this. That matters: if a manager could clear it, they could
 * make the seeder run again and resurrect a date they had just deleted.
 */
exports.SEED_MARKER_DOC = 'system/eventGenerator';
/**
 * How far ahead `findCurrentEvent` will look for the next gathering.
 *
 * A DATE bound, not a document-count bound. `.limit(20)` meant a long run of
 * skipped documents ahead of a scheduled event returned null while a scheduled
 * event existed — closing the service on the 21st document rather than on
 * anything meaningful.
 */
const LOOKAHEAD_DAYS = 90;
/** An event id is the gathering's own date. */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Which gathering a ride belongs to, taken from the ride itself.
 *
 * Returns null when the ride cannot say — callers then fall back to today's date
 * *in the congregation's zone*, never to a UTC one. That distinction is the whole
 * point of this function: a Friday-night drop-off in Boston completes after
 * midnight UTC, so a UTC date files it under Saturday, splitting one gathering's
 * numbers across two documents and leaving the Friday one unfindable.
 *
 * `eventId` is preferred over `eventDate` because the server writes it from
 * `system/rideContext` when the ride is assigned, whereas `eventDate` comes from
 * the requesting browser. Both are the gathering's date, so they agree whenever
 * the device clock did.
 */
function eventKeyFromRide(ride) {
    const r = ride;
    if (!r)
        return null;
    for (const candidate of [r.eventId, r.eventDate]) {
        if (typeof candidate === 'string' && DATE_KEY_PATTERN.test(candidate)) {
            return candidate;
        }
    }
    return null;
}
/**
 * The gathering the app should currently be working towards.
 *
 * Today's event if there is one, otherwise the soonest scheduled one after
 * today. Cancelled events are skipped, so cancelling next Friday correctly rolls
 * everything on to the one after.
 *
 * Today's event stays current for the WHOLE day, including after it has ended —
 * drop-off rides are still running then, and rolling the eventId over at the end
 * of sabha would move the attendance key out from under them.
 *
 * Returns null when nothing is scheduled. Callers must treat that as "closed"
 * rather than inventing a date: quietly falling back to a guessed Friday is how
 * the old code hid the fact that nobody had scheduled anything.
 */
async function findCurrentEvent(db, now, timeZone, rule = null) {
    const today = (0, time_1.zonedDateKey)(now, timeZone);
    const horizon = (0, time_1.addDaysToDateKey)(today, LOOKAHEAD_DAYS);
    try {
        // THE SAME SINGLE QUERY AS BEFORE.
        //
        // Worth stating plainly, because moving from "documents are gatherings" to
        // "a rule, with documents as its exceptions" sounds like it should cost
        // more reads and does not. It reads the same date range; those documents
        // are now exceptions rather than the schedule itself, and the schedule is
        // computed. This runs every minute, so the cost mattered.
        //
        // Both bounds on documentId(), so no composite index is needed. Adding a
        // status equality would force one for no gain — `normaliseException` and
        // `effectiveEvent` decide what each document means anyway.
        const snapshot = await db.collection(exports.EVENTS_COLLECTION)
            .where(admin.firestore.FieldPath.documentId(), '>=', today)
            .where(admin.firestore.FieldPath.documentId(), '<=', horizon)
            .orderBy(admin.firestore.FieldPath.documentId())
            .get();
        const exceptions = new Map();
        for (const doc of snapshot.docs) {
            const exception = (0, recurrence_1.normaliseException)(doc.data());
            if (exception)
                exceptions.set(doc.id, exception);
        }
        // One occurrence is all this needs; the manager's calendar asks the same
        // function for more. Sharing it is what keeps the scheduler and the
        // calendar from disagreeing about what the schedule says.
        const [occurrence] = (0, recurrence_1.upcomingOccurrences)(rule, exceptions, today, horizon, 1);
        if (!occurrence)
            return null;
        return {
            date: occurrence.date,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            venue: occurrence.venue,
            status: 'scheduled',
            agenda: occurrence.agenda,
            // "Not created by hand" now means "came from the rule", which is the
            // same distinction under a different mechanism.
            autoCreated: occurrence.source === 'rule',
        };
    }
    catch (error) {
        console.error('[events] Could not read events:', error);
        return null;
    }
}
/**
 * The seeding machinery that used to live here is gone.
 *
 * `weeklySlotDate` and `seedFirstEventIfNeeded` existed to create ONE gathering
 * on a brand-new project so the service was not closed on day one, plus the
 * `toEvent` reader that turned a document into a gathering. All three assumed
 * documents ARE the schedule.
 *
 * Under the rule model the schedule is `settings/sabhaRecurrence`, and a project
 * with no rule is honestly closed — `calendarStatus: 'no-scheduled-event'` says
 * so on the manager's calendar, next to the control that fixes it. Seeding a
 * gathering nobody asked for, to avoid admitting that, was papering over exactly
 * the thing the manager needs to see.
 *
 * SEED_MARKER_DOC stays. It is no longer a seed marker — it carries
 * `pendingAttendanceDeletes`, drained by the scheduler. Deleting the constant
 * would orphan that queue.
 */
//# sourceMappingURL=events.js.map