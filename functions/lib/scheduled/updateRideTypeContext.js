"use strict";
// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to publish which rides are currently open
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
exports.manuallyUpdateRideContext = exports.updateRideTypeContext = exports.ensureSabhaEvents = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const time_1 = require("../utils/time");
const schedule_1 = require("../utils/schedule");
const events_1 = require("../utils/events");
const notifications_1 = require("../utils/notifications");
const deleteSabhaEvent_1 = require("../http/deleteSabhaEvent");
const events_2 = require("../utils/events");
const authz_1 = require("../utils/authz");
const CONTEXT_DOC = 'system/rideContext';
/**
 * Stamp the gathering's own details onto its attendance record.
 *
 * Attendance lives at `weeklyAttendance/{eventId}/responses/{uid}`, and the
 * parent document was never written — so a record said who was coming but
 * nothing about what they were coming to. Once the sabha time or venue can
 * change week to week, "the 7th of August" alone stops being enough to
 * reconstruct what happened.
 *
 * set+merge, so re-running is harmless and manager edits to the venue mid-week
 * are picked up.
 */
async function recordEventDetails(db, event, venue) {
    try {
        await db.collection('weeklyAttendance').doc(event.eventId).set({
            eventId: event.eventId,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            attendanceLocksAt: event.attendanceLocksAt,
            venue: venue !== null && venue !== void 0 ? venue : null,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    }
    catch (error) {
        // Best-effort. Losing the header must not stop the window opening.
        console.error('[rideContext] Could not record event details:', error);
    }
}
/**
 * Read the manager-set sabha times.
 *
 * These used to be literals in this file, so moving sabha meant a code change
 * and a deploy. Missing or malformed values fall through to the defaults inside
 * resolveScheduleWindow rather than closing the service.
 */
async function readSabhaTimes(db) {
    try {
        const snap = await db.collection('settings').doc('main').get();
        const data = snap.data();
        return {
            sabhaStart: data === null || data === void 0 ? void 0 : data.sabhaStartTime,
            sabhaEnd: data === null || data === void 0 ? void 0 : data.sabhaEndTime,
            timeZone: (data === null || data === void 0 ? void 0 : data.timeZone) || time_1.DEFAULT_TIME_ZONE,
            venue: data === null || data === void 0 ? void 0 : data.sabhaLocation,
        };
    }
    catch (error) {
        console.error('[rideContext] Could not read settings/main:', error);
        return {
            sabhaStart: undefined, sabhaEnd: undefined,
            timeZone: time_1.DEFAULT_TIME_ZONE, venue: undefined,
        };
    }
}
/**
 * Announce that ride requests have opened — once.
 *
 * This function runs every minute, so notifying whenever pickup is open would
 * send roughly 60 pushes an hour for three days. It fires only on the
 * transition INTO a ride type, which is why the previous rideType has to be
 * read before the new one is written.
 */
async function announceIfWindowJustOpened(previousRideType, next) {
    if (!next.rideType || previousRideType === next.rideType)
        return;
    const isPickup = next.rideType === 'home-to-sabha';
    await (0, notifications_1.notifyEveryone)(isPickup ? 'Ride requests are open' : 'Drop-off rides are open', isPickup
        // Not "this Friday" any more — the date can move.
        ? 'Tap to request your ride to the next sabha.'
        : 'Drivers are heading out. Tap when you are ready to leave.', { rideType: next.rideType, reason: 'window-opened' });
}
/**
 * Seed the calendar on a brand-new project — once, ever.
 *
 * A daily job rather than a one-off script so a fresh staging or production
 * project cannot sit with an empty calendar. It does nothing at all once the
 * marker is set, which is what lets a manager delete a gathering and have it stay
 * deleted. How many sabhas exist after the first is the manager's decision.
 */
exports.ensureSabhaEvents = functions.pubsub
    .schedule('every day 03:00')
    .timeZone(time_1.DEFAULT_TIME_ZONE)
    .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();
    try {
        const { sabhaStart, sabhaEnd, timeZone } = await readSabhaTimes(db);
        const created = await (0, events_1.seedFirstEventIfNeeded)(db, now, timeZone, {
            startTime: typeof sabhaStart === 'string' ? sabhaStart : schedule_1.DEFAULT_SABHA_START,
            endTime: typeof sabhaEnd === 'string' ? sabhaEnd : schedule_1.DEFAULT_SABHA_END,
        });
        console.log(created.length > 0
            ? `[events] Seeded ${created.join(', ')}`
            : '[events] Already seeded — the calendar is the manager\'s');
        return null;
    }
    catch (error) {
        console.error('[events] Could not top up the calendar:', error);
        return null;
    }
});
/**
 * Drain dates whose attendance cascade did not finish.
 *
 * Bounded to a few per tick: this is a repair path, not a queue, and a runaway
 * loop here would delay the ride window for everyone.
 */
async function sweepPendingAttendanceDeletes(db) {
    var _a;
    try {
        const marker = await db.doc(events_2.SEED_MARKER_DOC).get();
        const pending = (_a = marker.data()) === null || _a === void 0 ? void 0 : _a.pendingAttendanceDeletes;
        if (!Array.isArray(pending) || pending.length === 0)
            return;
        for (const date of pending.slice(0, 3)) {
            if (typeof date !== 'string')
                continue;
            console.log(`[events] Draining pending attendance delete for ${date}`);
            await (0, deleteSabhaEvent_1.drainAttendanceDelete)(db, date);
        }
    }
    catch (error) {
        console.error('[events] Could not sweep pending attendance deletes:', error);
    }
}
exports.updateRideTypeContext = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async () => {
    var _a;
    const db = admin.firestore();
    try {
        const currentDoc = await db.doc(CONTEXT_DOC).get();
        const current = currentDoc.data();
        const now = new Date();
        // A manual override holds until it expires. Without the expiry a
        // manager who forgot to reset would freeze the schedule
        // indefinitely — and the failure mode of a frozen schedule is
        // people waiting for rides that never open.
        if ((current === null || current === void 0 ? void 0 : current.overrideUntil) && new Date(current.overrideUntil) > now) {
            console.log(`[rideContext] Manual override active until ${current.overrideUntil}`);
            return null;
        }
        // Finish any attendance cascade a deletion did not complete.
        // recursiveDelete cannot be part of the deleting batch, so a crash
        // between the two leaves exactly the invisible orphan the cascade
        // exists to prevent. The date is parked; this drains it.
        await sweepPendingAttendanceDeletes(db);
        const { sabhaStart, sabhaEnd, timeZone, venue } = await readSabhaTimes(db);
        // The gathering now comes from the events collection. No event means
        // nothing is scheduled — closed, and said plainly.
        let scheduled = await (0, events_1.findCurrentEvent)(db, now, timeZone);
        // Seed on the very first run, so a fresh deploy does not sit with the
        // service closed until 03:00. Once the marker is set this does
        // nothing — an empty calendar from then on is the manager's choice,
        // and `calendarStatus` below publishes it so the UI can say so rather
        // than leaving "No rides available" looking like a fault.
        //
        // This is also what makes deletion stick. The previous version treated
        // a missing document as "needs creating", so a deleted date reappeared
        // on the very next tick — within 60 seconds.
        if (!scheduled) {
            const created = await (0, events_1.seedFirstEventIfNeeded)(db, now, timeZone, {
                startTime: typeof sabhaStart === 'string' ? sabhaStart : schedule_1.DEFAULT_SABHA_START,
                endTime: typeof sabhaEnd === 'string' ? sabhaEnd : schedule_1.DEFAULT_SABHA_END,
            });
            if (created.length > 0) {
                console.log(`[events] Seeded the calendar: ${created.join(', ')}`);
                scheduled = await (0, events_1.findCurrentEvent)(db, now, timeZone);
            }
        }
        const event = scheduled
            ? (0, schedule_1.buildCurrentEvent)(scheduled.date, scheduled.startTime, scheduled.endTime, timeZone, {
                venue: scheduled.venue,
                agenda: scheduled.agenda,
            })
            : null;
        const window = (0, schedule_1.resolveScheduleWindow)(now, event, timeZone);
        await db.doc(CONTEXT_DOC).set(Object.assign(Object.assign(Object.assign({}, window), (event !== null && event !== void 0 ? event : { eventId: null })), { 
            // Lets the manager UI say "you cancelled everything" instead of
            // leaving "No rides available" looking like a malfunction.
            calendarStatus: event ? 'ok' : 'no-scheduled-event', overrideUntil: null, lastUpdated: now.toISOString() }));
        // Only when the gathering changes, not every minute.
        if (event && (current === null || current === void 0 ? void 0 : current.eventId) !== event.eventId) {
            await recordEventDetails(db, event, (_a = event.venue) !== null && _a !== void 0 ? _a : venue);
        }
        await announceIfWindowJustOpened(current === null || current === void 0 ? void 0 : current.rideType, window);
        console.log('[rideContext] Updated:', window);
        return null;
    }
    catch (error) {
        console.error('[rideContext] Error updating ride context:', error);
        return null;
    }
});
/**
 * HTTP Callable: manager opens a ride window early, or returns to automatic.
 *
 * Input:
 *   { rideType: 'home-to-sabha' | 'sabha-to-home' }  → open it now
 *   { reset: true }                                   → back to the schedule
 *
 * The override expires at the end of the current day in Sabha local time, so
 * the schedule always resumes on its own even if nobody resets it.
 */
exports.manuallyUpdateRideContext = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const db = admin.firestore();
    const now = new Date();
    // Only a manager may move the service window for everyone.
    await (0, authz_1.assertApprovedManager)(db, context.auth.uid, 'change the ride window');
    const { timeZone } = await readSabhaTimes(db);
    const scheduled = await (0, events_1.findCurrentEvent)(db, now, timeZone);
    const event = scheduled
        ? (0, schedule_1.buildCurrentEvent)(scheduled.date, scheduled.startTime, scheduled.endTime, timeZone, {
            venue: scheduled.venue,
            agenda: scheduled.agenda,
        })
        : null;
    // Reset — hand control straight back to the schedule.
    if (data === null || data === void 0 ? void 0 : data.reset) {
        const window = (0, schedule_1.resolveScheduleWindow)(now, event, timeZone);
        await db.doc(CONTEXT_DOC).set(Object.assign(Object.assign(Object.assign({}, window), (event !== null && event !== void 0 ? event : { eventId: null })), { calendarStatus: event ? 'ok' : 'no-scheduled-event', overrideUntil: null, lastUpdated: now.toISOString() }));
        return window;
    }
    const rideType = data === null || data === void 0 ? void 0 : data.rideType;
    if (rideType !== 'home-to-sabha' && rideType !== 'sabha-to-home') {
        throw new functions.https.HttpsError('invalid-argument', 'rideType must be home-to-sabha or sabha-to-home, or pass reset: true');
    }
    const previous = (await db.doc(CONTEXT_DOC).get()).data();
    const window = {
        rideType,
        displayText: rideType === 'home-to-sabha' ? 'Home → Sabha' : 'Sabha → Home',
        timeContext: 'Opened by a manager',
    };
    if (!event) {
        throw new functions.https.HttpsError('failed-precondition', 'No sabha is scheduled. Add one in the Sabha Calendar before opening a ride window.');
    }
    await db.doc(CONTEXT_DOC).set(Object.assign(Object.assign(Object.assign({}, window), event), { calendarStatus: 'ok', overrideUntil: endOfLocalDay(now, timeZone), openedBy: context.auth.uid, lastUpdated: now.toISOString() }));
    // Same one-shot rule as the scheduler: announce only a real change, so
    // re-tapping the button does not notify the congregation twice.
    await announceIfWindowJustOpened(previous === null || previous === void 0 ? void 0 : previous.rideType, window);
    return window;
});
/**
 * Midnight tonight, in Sabha local time, as an ISO instant.
 *
 * Derived by asking what the local date is and walking forward in hours, rather
 * than by assuming a fixed UTC offset — the offset changes twice a year.
 */
function endOfLocalDay(now, timeZone) {
    const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    // Step forward in 30-minute jumps until the local calendar date changes.
    // At most 48 hours of steps, so this terminates regardless of the zone.
    let cursor = now.getTime();
    for (let i = 0; i < 96; i++) {
        cursor += 30 * 60 * 1000;
        const candidate = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(cursor));
        if (candidate !== localDate)
            return new Date(cursor).toISOString();
    }
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}
//# sourceMappingURL=updateRideTypeContext.js.map