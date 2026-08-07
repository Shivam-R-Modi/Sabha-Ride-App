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
exports.AUTOCREATE_WEEKS_AHEAD = exports.EVENTS_COLLECTION = void 0;
exports.findCurrentEvent = findCurrentEvent;
exports.weeklySlotDate = weeklySlotDate;
exports.ensureUpcomingEvents = ensureUpcomingEvents;
const admin = __importStar(require("firebase-admin"));
const time_1 = require("./time");
const schedule_1 = require("./schedule");
exports.EVENTS_COLLECTION = 'events';
/** How many weeks ahead the weekly template keeps events populated. */
exports.AUTOCREATE_WEEKS_AHEAD = 8;
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
        const snapshot = await db.collection(exports.EVENTS_COLLECTION)
            .where(admin.firestore.FieldPath.documentId(), '>=', today)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(20)
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
 * Keep the calendar populated.
 *
 * With a list of events instead of a hardcoded Friday, an empty calendar means
 * no rides at all — so forgetting to add next week would silently close the
 * service on a congregation that has no way to tell why. This fills the next
 * AUTOCREATE_WEEKS_AHEAD occurrences of the weekly slot from the default times.
 *
 * Only ever CREATES missing documents. It never touches an existing one, so a
 * manager's edited time, moved venue or cancellation is never overwritten.
 */
async function ensureUpcomingEvents(db, now, timeZone, defaults, dayOfWeek = schedule_1.SABHA_DAY) {
    const created = [];
    for (let week = 0; week < exports.AUTOCREATE_WEEKS_AHEAD; week++) {
        const date = weeklySlotDate(now, timeZone, dayOfWeek, week);
        const ref = db.collection(exports.EVENTS_COLLECTION).doc(date);
        try {
            const existing = await ref.get();
            if (existing.exists)
                continue;
            await ref.create({
                date,
                startTime: defaults.startTime,
                endTime: defaults.endTime,
                venue: null,
                status: 'scheduled',
                agenda: '',
                autoCreated: true,
                createdAt: new Date().toISOString(),
            });
            created.push(date);
        }
        catch (error) {
            // ALREADY_EXISTS means a concurrent run won the race, which is fine.
            if ((error === null || error === void 0 ? void 0 : error.code) !== 6) {
                console.error(`[events] Could not create ${date}:`, error);
            }
        }
    }
    return created;
}
//# sourceMappingURL=events.js.map