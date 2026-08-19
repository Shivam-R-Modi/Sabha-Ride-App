"use strict";
// ============================================
// PUSH NOTIFICATION UTILITIES (FCM)
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
exports.tokensOf = tokensOf;
exports.sendNotification = sendNotification;
exports.notifyEveryone = notifyEveryone;
exports.notifyStudentDriverAssigned = notifyStudentDriverAssigned;
exports.notifyDriverStudentsAssigned = notifyDriverStudentsAssigned;
exports.notifyStudentRideStarting = notifyStudentRideStarting;
exports.notifyStudentSarthiArrived = notifyStudentSarthiArrived;
exports.notifyStudentRideCompleted = notifyStudentRideCompleted;
exports.notifyManagerUnassignedStudents = notifyManagerUnassignedStudents;
const admin = __importStar(require("firebase-admin"));
/**
 * Every live token for one user document.
 *
 * `fcmTokens` is a MAP keyed by a sanitised token, not an array and not a single
 * string. A single string meant last-device-wins: register on a phone, later
 * open the app on a laptop, and the phone silently stopped receiving. A map
 * rather than an array because pruning one dead token is then a single field
 * delete instead of a read-modify-write race between two concurrent sends.
 *
 * The legacy single `fcmToken` is still read, so a document written before the
 * change still delivers. Nothing writes it any more.
 */
function tokensOf(uid, data) {
    if (!data)
        return [];
    const out = [];
    const map = data.fcmTokens;
    if (map && typeof map === 'object') {
        for (const token of Object.keys(map)) {
            if (token)
                out.push({ uid, token });
        }
    }
    const legacy = data.fcmToken;
    if (typeof legacy === 'string' && legacy.length > 0 && !out.some(r => r.token === legacy)) {
        out.push({ uid, token: legacy });
    }
    return out;
}
/** FCM accepts at most 500 tokens per multicast call. */
const MULTICAST_BATCH_SIZE = 500;
/**
 * Error codes that mean the token is permanently gone.
 *
 * Deliberately NOT including transient failures. Pruning on
 * `messaging/internal-error` or a 5xx would silently unsubscribe the whole
 * congregation during an FCM outage — invisible, self-inflicted, and nothing
 * would ever put the tokens back.
 */
const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);
/**
 * Send to a set of devices, and drop the ones FCM reports as dead.
 *
 * `sendEachForMulticast` does NOT throw on partial failure — it resolves with a
 * `responses[]` array positionally matching the tokens. The previous version
 * awaited it and discarded the return value, which is where every per-token
 * failure lives. That is why dead tokens could never be cleaned up.
 *
 * The pruning write is created and committed HERE, in its own batch. It must
 * never be handed to a caller: a dead FCM token joining `globalAssignDriver`'s
 * batch would let a notification failure fail a ride assignment.
 */
async function dispatch(recipients, title, body, data) {
    const result = { delivered: 0, failed: 0, pruned: 0 };
    if (recipients.length === 0)
        return result;
    const dead = [];
    for (let i = 0; i < recipients.length; i += MULTICAST_BATCH_SIZE) {
        const batch = recipients.slice(i, i + MULTICAST_BATCH_SIZE);
        try {
            const response = await admin.messaging().sendEachForMulticast({
                tokens: batch.map(r => r.token),
                notification: { title, body },
                data: data || {},
                android: {
                    priority: 'high',
                    notification: { channelId: 'ride-updates', priority: 'high' },
                },
                apns: {
                    payload: { aps: { alert: { title, body }, badge: 1, sound: 'default' } },
                },
            });
            result.delivered += response.successCount;
            result.failed += response.failureCount;
            response.responses.forEach((r, index) => {
                var _a;
                if (r.success)
                    return;
                const code = (_a = r.error) === null || _a === void 0 ? void 0 : _a.code;
                if (DEAD_TOKEN_CODES.has(code !== null && code !== void 0 ? code : ''))
                    dead.push(batch[index]);
            });
        }
        catch (error) {
            // A messaging outage must not throw into a ride path.
            console.error('[push] multicast failed:', error);
            result.failed += batch.length;
        }
    }
    if (dead.length > 0) {
        try {
            const db = admin.firestore();
            const writes = db.batch();
            for (const { uid, token } of dead) {
                writes.update(db.collection('users').doc(uid), {
                    [`fcmTokens.${token}`]: admin.firestore.FieldValue.delete(),
                });
            }
            await writes.commit();
            result.pruned = dead.length;
        }
        catch (error) {
            console.error('[push] could not prune dead tokens:', error);
        }
    }
    return result;
}
/** Send to one set of devices. Never throws — notifications are best-effort. */
async function sendNotification(recipients, title, body, data) {
    return dispatch(recipients, title, body, data);
}
/**
 * Notify every user who has push enabled.
 *
 * Used when a ride window opens, which is congregation-wide news rather than
 * something aimed at one person.
 *
 * Only reaches accounts with a token — that is, people who granted notification
 * permission. Everyone else sees the change on their dashboard, which is live
 * either way.
 *
 * This reads the whole users collection. Fine for one congregation; when the
 * platform is multi-city this should become an FCM topic per location so it does
 * not scale with total membership. Topics are deliberately NOT used yet: a topic
 * send returns one message id and no per-token result, which would take away the
 * only signal that a token has died.
 */
async function notifyEveryone(title, body, data) {
    try {
        const snapshot = await admin.firestore().collection('users').get();
        const recipients = snapshot.docs.flatMap(doc => tokensOf(doc.id, doc.data()));
        if (recipients.length === 0) {
            console.log('[notifyEveryone] No push tokens registered — nothing sent');
            return;
        }
        const result = await dispatch(recipients, title, body, data);
        console.log(`[notifyEveryone] "${title}" -> ${result.delivered} delivered, ` +
            `${result.failed} failed, ${result.pruned} pruned`);
    }
    catch (error) {
        // Best-effort, like every other notification here. A push failure must
        // not stop the ride window from opening.
        console.error('[notifyEveryone] Error:', error);
    }
}
// ── Copy ────────────────────────────────────────────────────────────────────
//
// Every body below is written on one assumption: A NOTIFICATION IS READ OFF A
// LOCK SCREEN BY WHOEVER IS HOLDING THE PHONE, AND THE PHONE MAY BELONG TO A
// CHILD.
//
// So a body never carries a rider's name, their address, their destination, or
// the fact that they are now home alone. It says that something happened and
// that the app has the detail — which is behind firestore.rules, where it is
// already scoped correctly.
//
// This replaces copy that named the Sarthi and described their car
// ("Mira will pick you up in a red Odyssey"), announced the destination, and
// announced arrival home. Same rule the dispatcher already follows at
// globalAssignDriver.ts:394, where the waiting summary is built with no names.
async function notifyStudentDriverAssigned(recipients) {
    await sendNotification(recipients, 'Sarthi assigned', 'Your ride is arranged. Open the app for your Sarthi and car.', { type: 'driver_assigned' });
}
async function notifyDriverStudentsAssigned(recipients, riderCount) {
    // A count is safe; the names of children are not.
    await sendNotification(recipients, 'Bhulka assigned', `${riderCount} Bhulka on your route. Open the app to start.`, { type: 'students_assigned' });
}
async function notifyStudentRideStarting(recipients) {
    // The destination is deliberately absent — it used to say where the child
    // was going.
    await sendNotification(recipients, 'Sarthi on the way', 'Your ride has started. Please be ready.', { type: 'ride_starting' });
}
/** The new one: the Sarthi is outside. */
async function notifyStudentSarthiArrived(recipients) {
    await sendNotification(recipients, 'Sarthi has arrived', 'Your Sarthi is outside. Please come out when you can.', { type: 'sarthi_arrived' });
}
async function notifyStudentRideCompleted(recipients) {
    // Was "Home Safe! You have arrived home safely" — which told anyone holding
    // the phone that this particular child is home, and when.
    await sendNotification(recipients, 'Ride complete', 'Thanks for riding with Bhulka Gaadi.', { type: 'ride_completed' });
}
async function notifyManagerUnassignedStudents(recipients) {
    // No count: a number on a lock screen is a headcount of unaccompanied
    // children waiting somewhere.
    await sendNotification(recipients, 'Bhulka still waiting', 'Some Bhulka need manual assignment. Open the app.', { type: 'unassigned_students' });
}
//# sourceMappingURL=notifications.js.map