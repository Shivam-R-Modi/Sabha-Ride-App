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
exports.findCurrentEvent = findCurrentEvent;
exports.weeklySlotDate = weeklySlotDate;
exports.seedFirstEventIfNeeded = seedFirstEventIfNeeded;
const admin = __importStar(require("firebase-admin"));
const time_1 = require("./time");
const schedule_1 = require("./schedule");
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
/** How far the one-off seed will look for a free weekly slot. Bounds the loop. */
const SEED_SEARCH_DAYS = 56;
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
 * Seed the very first gathering — once, ever.
 *
 * A brand-new project has an empty calendar, and an empty calendar means no rides
 * at all with no error shown to anyone. So one gathering is created so the service
 * is never closed on day one. After that the calendar belongs to the manager: how
 * many sabhas exist is their decision, not a cron job's.
 *
 * `seededAt` in system/eventGenerator is what makes "once, ever" true, and it is
 * what makes DELETION possible. The previous version worked out whether a slot had
 * been "decided" by whether a document existed on that date — so deleting a date
 * removed the evidence and the date was recreated as freshly scheduled within 60
 * seconds by the per-minute self-heal. A marker outside the events collection
 * cannot be erased by deleting an event.
 *
 * Failure is biased towards seeding, never towards closing: a missing or malformed
 * marker is treated as "not yet seeded". This runs inside a scheduled job whose
 * failure mode is "no rides at all", and stranding a congregation is worse than
 * creating one gathering a manager then deletes.
 *
 * Returns the dates it created — at most one, and only on the very first run.
 */
async function seedFirstEventIfNeeded(db, now, timeZone, defaults, dayOfWeek = schedule_1.SABHA_DAY) {
    var _a;
    try {
        const markerRef = db.doc(exports.SEED_MARKER_DOC);
        const marker = await markerRef.get();
        const seededAt = marker.exists ? (_a = marker.data()) === null || _a === void 0 ? void 0 : _a.seededAt : undefined;
        // Already seeded. Never create again, whatever the calendar looks like —
        // an empty calendar from here on is the manager's choice and is surfaced
        // as `calendarStatus: 'no-scheduled-event'` rather than papered over.
        if (typeof seededAt === 'string' && seededAt.length > 0)
            return [];
        // A calendar the manager has already filled needs no seed. Still record
        // the marker, so a later deletion cannot make this run again.
        const alreadyScheduled = await findCurrentEvent(db, now, timeZone);
        if (alreadyScheduled) {
            await markerRef.set({
                seededAt: new Date().toISOString(),
                seededDate: null,
                note: 'Calendar was already populated; marker recorded without seeding.',
            }, { merge: true });
            return [];
        }
        // Seed the first weekly slot that has no document at all.
        //
        // Slot 0 is usually free, but not always: a legacy CANCELLED document
        // sitting on it is skipped by findCurrentEvent above, so we get here — and
        // then batch.create would hit its ALREADY_EXISTS precondition, reject the
        // whole commit, and leave a project whose only events are cancelled with
        // no sabha and no marker, retrying forever.
        const today = (0, time_1.zonedDateKey)(now, timeZone);
        const occupied = new Set();
        const scan = await db.collection(exports.EVENTS_COLLECTION)
            .where(admin.firestore.FieldPath.documentId(), '>=', today)
            .where(admin.firestore.FieldPath.documentId(), '<=', (0, time_1.addDaysToDateKey)(today, SEED_SEARCH_DAYS))
            .orderBy(admin.firestore.FieldPath.documentId())
            .get();
        scan.docs.forEach(doc => occupied.add(doc.id));
        let date = null;
        for (let week = 0; week * 7 <= SEED_SEARCH_DAYS; week++) {
            const candidate = weeklySlotDate(now, timeZone, dayOfWeek, week);
            if (!occupied.has(candidate)) {
                date = candidate;
                break;
            }
        }
        if (!date) {
            // Every slot in the search window is taken by a document, none of them
            // scheduled. Nothing sensible to seed; leave it to the manager and let
            // calendarStatus say so.
            console.warn('[events] No free weekly slot to seed — leaving it to a manager');
            return [];
        }
        // One batch, so the event and the marker land together or not at all.
        // Split across two writes, a crash in between would leave the event
        // created and the marker unset — and then deleting that event would seed
        // it straight back, which is the exact loop this marker removes.
        //
        // batch.create keeps the ALREADY_EXISTS precondition, so if a concurrent
        // run won the race this whole commit rejects and neither write lands.
        const batch = db.batch();
        batch.create(db.collection(exports.EVENTS_COLLECTION).doc(date), {
            date,
            startTime: defaults.startTime,
            endTime: defaults.endTime,
            venue: null,
            status: 'scheduled',
            agenda: '',
            autoCreated: true,
            createdAt: new Date().toISOString(),
        });
        batch.set(markerRef, {
            seededAt: new Date().toISOString(),
            seededDate: date,
        }, { merge: true });
        try {
            await batch.commit();
            return [date];
        }
        catch (error) {
            // ALREADY_EXISTS (6): a concurrent run created it first, so a
            // gathering exists either way and its marker was written with it.
            if ((error === null || error === void 0 ? void 0 : error.code) === 6)
                return [];
            console.error(`[events] Could not seed ${date}:`, error);
            return [];
        }
    }
    catch (error) {
        console.error('[events] Could not seed the calendar:', error);
        return [];
    }
}
//# sourceMappingURL=events.js.map