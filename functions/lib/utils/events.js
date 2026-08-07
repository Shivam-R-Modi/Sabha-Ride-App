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
exports.UPCOMING_SCHEDULED_TARGET = exports.CALENDAR_HORIZON_DAYS = exports.EVENTS_COLLECTION = void 0;
exports.findCurrentEvent = findCurrentEvent;
exports.weeklySlotDate = weeklySlotDate;
exports.ensureUpcomingScheduled = ensureUpcomingScheduled;
exports.hasScheduledEventAhead = hasScheduledEventAhead;
const admin = __importStar(require("firebase-admin"));
const time_1 = require("./time");
const schedule_1 = require("./schedule");
exports.EVENTS_COLLECTION = 'events';
/**
 * How far ahead the generator looks, and therefore the longest shutdown a
 * manager can declare: cancel every weekly slot inside this window and
 * generation stops, because each slot has a document saying they decided.
 *
 * Must span at least TWO weekly slots. With a 7-day horizon there is exactly one
 * candidate, so cancelling it leaves nothing to create and rides close until the
 * slot pointer walks past — the outage this constant exists to prevent.
 */
exports.CALENDAR_HORIZON_DAYS = 14;
/**
 * How many SCHEDULED events must exist inside the horizon.
 *
 * One. How many sabhas there are is a manager's decision; the generator only
 * guarantees the service is never silently closed.
 */
exports.UPCOMING_SCHEDULED_TARGET = 1;
/**
 * How far ahead `findCurrentEvent` will look for the next gathering.
 *
 * A DATE bound, not a document-count bound. `.limit(20)` meant a long run of
 * cancelled tombstones ahead of a scheduled event returned null while a
 * scheduled event existed — closing the service on the 21st document rather than
 * on anything meaningful.
 */
const LOOKAHEAD_DAYS = 90;
/** Normalise a Firestore document into a usable event, or null if unusable. */
function toEvent(id, data) {
    if (!data)
        return null;
    const startTime = typeof data.startTime === 'string' && (0, schedule_1.parseTimeToMinutes)(data.startTime) !== null
        ? data.startTime
        : schedule_1.DEFAULT_SABHA_START;
    const endTime = typeof data.endTime === 'string' && (0, schedule_1.parseTimeToMinutes)(data.endTime) !== null
        ? data.endTime
        : schedule_1.DEFAULT_SABHA_END;
    const venue = data.venue
        && typeof data.venue.lat === 'number'
        && typeof data.venue.lng === 'number'
        ? {
            lat: data.venue.lat,
            lng: data.venue.lng,
            address: typeof data.venue.address === 'string' ? data.venue.address : '',
        }
        : null;
    return {
        date: typeof data.date === 'string' ? data.date : id,
        startTime,
        endTime,
        venue,
        status: data.status === 'cancelled' ? 'cancelled' : 'scheduled',
        agenda: typeof data.agenda === 'string' ? data.agenda : '',
        autoCreated: data.autoCreated === true,
    };
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
async function findCurrentEvent(db, now, timeZone) {
    const today = (0, time_1.zonedDateKey)(now, timeZone);
    try {
        // Both bounds on documentId(), so no composite index is needed. Adding
        // a status equality here would force one, for no gain — the loop below
        // filters by status anyway.
        const snapshot = await db.collection(exports.EVENTS_COLLECTION)
            .where(admin.firestore.FieldPath.documentId(), '>=', today)
            .where(admin.firestore.FieldPath.documentId(), '<=', (0, time_1.addDaysToDateKey)(today, LOOKAHEAD_DAYS))
            .orderBy(admin.firestore.FieldPath.documentId())
            .get();
        for (const doc of snapshot.docs) {
            const event = toEvent(doc.id, doc.data());
            if (event && event.status === 'scheduled')
                return event;
        }
        return null;
    }
    catch (error) {
        console.error('[events] Could not read events:', error);
        return null;
    }
}
/**
 * The date of the Nth upcoming occurrence of the weekly slot.
 *
 * Offset 0 is the next one, counting today if today is the day.
 */
function weeklySlotDate(now, timeZone, dayOfWeek, weeksAhead) {
    const { dayOfWeek: todayDow } = (0, time_1.getZonedParts)(now, timeZone);
    const daysUntil = (dayOfWeek - todayDow + 7) % 7;
    return (0, time_1.addDaysToDateKey)((0, time_1.zonedDateKey)(now, timeZone), daysUntil + weeksAhead * 7);
}
/**
 * Keep at least one SCHEDULED gathering inside the horizon.
 *
 * The invariant is deliberately about scheduled events, not about document
 * count. "Create the next slot if it is missing" is not equivalent: a manager who
 * cancels the only upcoming sabha leaves a document on that date, so nothing gets
 * created, `findCurrentEvent` returns null, and rides close until the weekly slot
 * pointer walks past the cancelled date — days later, recovering only by
 * accident. Asking "is there a scheduled event ahead?" instead makes cancelling
 * roll forward.
 *
 * Only ever CREATES. It never updates and never un-cancels, so an edited time, a
 * moved venue or a cancellation is never overwritten. That is the most important
 * property of this function.
 *
 * A corollary worth knowing: a cancelled future event inside the horizon is a
 * load-bearing tombstone. DELETING one makes this function recreate it as
 * scheduled. Cancel, never delete.
 *
 * Returns the dates it created — at most one.
 */
async function ensureUpcomingScheduled(db, now, timeZone, defaults, dayOfWeek = schedule_1.SABHA_DAY) {
    const today = (0, time_1.zonedDateKey)(now, timeZone);
    const horizonEnd = (0, time_1.addDaysToDateKey)(today, exports.CALENDAR_HORIZON_DAYS);
    try {
        // ONE query answers both questions below: is the invariant satisfied, and
        // which slots already have a document. The previous version re-read each
        // slot individually, which is what made it eight reads per call.
        const snapshot = await db.collection(exports.EVENTS_COLLECTION)
            .where(admin.firestore.FieldPath.documentId(), '>=', today)
            .where(admin.firestore.FieldPath.documentId(), '<=', horizonEnd)
            .orderBy(admin.firestore.FieldPath.documentId())
            .get();
        const existing = new Set();
        let scheduledAhead = 0;
        for (const doc of snapshot.docs) {
            existing.add(doc.id);
            const event = toEvent(doc.id, doc.data());
            if (event && event.status === 'scheduled')
                scheduledAhead++;
        }
        if (scheduledAhead >= exports.UPCOMING_SCHEDULED_TARGET)
            return [];
        for (let week = 0;; week++) {
            const date = weeklySlotDate(now, timeZone, dayOfWeek, week);
            if (date > horizonEnd)
                break;
            // A document here means a manager already decided this slot, whether
            // that decision was "moved" or "cancelled". Leave it alone.
            if (existing.has(date))
                continue;
            try {
                await db.collection(exports.EVENTS_COLLECTION).doc(date).create({
                    date,
                    startTime: defaults.startTime,
                    endTime: defaults.endTime,
                    venue: null,
                    status: 'scheduled',
                    agenda: '',
                    autoCreated: true,
                    createdAt: new Date().toISOString(),
                });
                return [date];
            }
            catch (error) {
                // ALREADY_EXISTS (6): a concurrent run won the race, so the
                // invariant now holds either way.
                if ((error === null || error === void 0 ? void 0 : error.code) === 6)
                    return [];
                console.error(`[events] Could not create ${date}:`, error);
                return [];
            }
        }
        // Every slot in the horizon has a document and none of them is scheduled.
        // The manager has closed the service deliberately. Callers surface this
        // rather than retrying, so it is visible instead of looking like a bug.
        return [];
    }
    catch (error) {
        console.error('[events] Could not top up the calendar:', error);
        return [];
    }
}
/**
 * Is there a scheduled gathering inside the horizon?
 *
 * Used to tell "the manager closed the service" apart from "something is broken",
 * which are indistinguishable to a rider otherwise.
 */
async function hasScheduledEventAhead(db, now, timeZone) {
    return (await findCurrentEvent(db, now, timeZone)) !== null;
}
//# sourceMappingURL=events.js.map