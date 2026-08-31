// ============================================
// PUSH NOTIFICATION UTILITIES (FCM)
// ============================================

import * as admin from 'firebase-admin';
import { notificationEnabled } from './notificationSettings';

/**
 * One deliverable device. The uid travels WITH the token because pruning is
 * impossible without it: FCM tells you a token is dead, and you need to know
 * whose document to remove it from. The old API took a bare token, which is why
 * dead tokens could only ever accumulate.
 */
export interface Recipient {
    uid: string;
    token: string;
}

/** What one device's entry looks like on a user document. */
export interface DeviceToken {
    /** e.g. "iPhone · Safari" — so a person can tell their devices apart. */
    label?: string;
    updatedAt?: string;
}

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
export function tokensOf(uid: string, data: FirebaseFirestore.DocumentData | undefined): Recipient[] {
    if (!data) return [];

    const out: Recipient[] = [];
    const map = data.fcmTokens;
    if (map && typeof map === 'object') {
        for (const token of Object.keys(map)) {
            if (token) out.push({ uid, token });
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

export interface DispatchResult {
    delivered: number;
    failed: number;
    pruned: number;
}

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
async function dispatch(
    recipients: Recipient[],
    title: string,
    body: string,
    data?: Record<string, string>,
): Promise<DispatchResult> {
    const result: DispatchResult = { delivered: 0, failed: 0, pruned: 0 };
    if (recipients.length === 0) return result;

    // THE MANAGER'S SWITCH, CHECKED IN ONE PLACE. `dispatch` is the only path to FCM
    // in this codebase — `sendNotification` and `notifyEveryone` both come through
    // here — so one guard covers every notification rather than thirteen scattered
    // checks that a fourteenth send would quietly not inherit.
    //
    // Keyed on `data.type`, which was already on the payload for client-side click
    // routing, so nothing had to be threaded through the call sites. An absent or
    // unrecognised type sends: see the note on `notificationEnabled`.
    if (!(await notificationEnabled(data?.type))) {
        console.log(`[push] "${data?.type}" is switched off by a manager — not sent`);
        return result;
    }

    const dead: Recipient[] = [];

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
                if (r.success) return;
                const code = (r.error as { code?: string } | undefined)?.code;
                if (DEAD_TOKEN_CODES.has(code ?? '')) dead.push(batch[index]!);
            });
        } catch (error) {
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
        } catch (error) {
            console.error('[push] could not prune dead tokens:', error);
        }
    }

    return result;
}

/** Send to one set of devices. Never throws — notifications are best-effort. */
export async function sendNotification(
    recipients: Recipient[],
    title: string,
    body: string,
    data?: Record<string, string>,
): Promise<DispatchResult> {
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
export async function notifyEveryone(
    title: string,
    body: string,
    data?: Record<string, string>,
): Promise<void> {
    try {
        const snapshot = await admin.firestore().collection('users').get();
        const recipients = snapshot.docs.flatMap(doc => tokensOf(doc.id, doc.data()));

        if (recipients.length === 0) {
            console.log('[notifyEveryone] No push tokens registered — nothing sent');
            return;
        }

        const result = await dispatch(recipients, title, body, data);
        console.log(
            `[notifyEveryone] "${title}" -> ${result.delivered} delivered, ` +
            `${result.failed} failed, ${result.pruned} pruned`,
        );
    } catch (error) {
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

export async function notifyStudentDriverAssigned(recipients: Recipient[]): Promise<void> {
    await sendNotification(
        recipients,
        'Sarthi assigned',
        'Your ride is arranged. Open the app for your Sarthi and car.',
        { type: 'driver_assigned' },
    );
}

export async function notifyDriverStudentsAssigned(
    recipients: Recipient[],
    riderCount: number,
): Promise<void> {
    // A count is safe; the names of children are not.
    await sendNotification(
        recipients,
        'Bhulka assigned',
        `${riderCount} Bhulka on your route. Open the app to start.`,
        { type: 'students_assigned' },
    );
}

export async function notifyStudentRideStarting(recipients: Recipient[]): Promise<void> {
    // The destination is deliberately absent — it used to say where the child
    // was going.
    await sendNotification(
        recipients,
        'Sarthi on the way',
        'Your ride has started. Please be ready.',
        { type: 'ride_starting' },
    );
}

/** The new one: the Sarthi is outside. */
export async function notifyStudentSarthiArrived(recipients: Recipient[]): Promise<void> {
    await sendNotification(
        recipients,
        'Sarthi has arrived',
        'Your Sarthi is outside. Please come out when you can.',
        { type: 'sarthi_arrived' },
    );
}

/**
 * The second ask, sent by hand.
 *
 * `notifyStudentSarthiArrived` fires once on its own. This is what the Sarthi
 * taps when nobody has come out — deliberately more urgent in tone and
 * deliberately still fixed text, because the caller is a volunteer driver and
 * the recipient is somebody's child.
 */
export async function notifyStudentSarthiWaiting(recipients: Recipient[]): Promise<DispatchResult> {
    return sendNotification(
        recipients,
        'Sarthi is waiting',
        'Your Sarthi is outside waiting for you. Please come out now.',
        { type: 'sarthi_waiting' },
    );
}

export async function notifyStudentRideCompleted(recipients: Recipient[]): Promise<void> {
    // Was "Home Safe! You have arrived home safely" — which told anyone holding
    // the phone that this particular child is home, and when.
    await sendNotification(
        recipients,
        'Ride complete',
        'Thanks for riding with Bhulka Gaadi.',
        { type: 'ride_completed' },
    );
}

/**
 * SOMEBODY IS COMING FOR THEM. Sent when a Sarthi claims an airport pickup.
 *
 * This is the single thing the traveller is actually waiting for, and until now the
 * only way to learn it was to open the app and look. It also exists so the push
 * pre-prompt on their screen has something true to promise — a permission asked for
 * against a notification that never arrives is worse than not asking, because iOS
 * only allows one refusal and it is permanent.
 *
 * The SARTHI'S NAME IS INCLUDED, deliberately, and it is the exception to the
 * no-names rule the ride notifications follow. Those omit names because naming a
 * child on a lock screen tells a stranger who is travelling and when. This names the
 * VOLUNTEER, to the person being collected — which is exactly the reassurance the
 * whole service is for, and is the same fact the card already shows.
 */
export async function notifyTravellerSarthiAssigned(
    recipients: Recipient[],
    sarthiName: string,
    pickupId: string,
): Promise<void> {
    await sendNotification(
        recipients,
        'A Sarthi is coming for you',
        `${sarthiName} will meet you at arrivals.`,
        { type: 'airport-claimed', pickupId },
    );
}

/**
 * A claimed airport pickup changed in a way that affects the drive.
 *
 * NO TRAVELLER NAME AND NO ADDRESS, same rule as the ride notifications above: this
 * lands on a lock screen anybody can read. It names WHAT changed and nothing else,
 * because "the arrival time" is enough to make somebody open the app and "Ramesh lands
 * at 06:30 at Terminal E" is an itinerary handed to a stranger.
 *
 * PUSH IS THE BACKSTOP, NOT THE MECHANISM — the same note alertUnclaimedArrivals
 * carries. Almost nobody in this congregation has granted notification permission, so
 * the guarantee is the red line on the card, which is derived from `changedFields` on
 * every render. This exists for the Sarthi who is not looking at the app.
 */
export async function notifyArrivalChanged(
    recipients: Recipient[],
    changed: string[],
    pickupId: string,
): Promise<void> {
    // "the arrival time and the terminal have changed" — the list is built from the
    // shared table so the wording matches the card exactly.
    const what = changed.length === 1
        ? changed[0]
        : `${changed.slice(0, -1).join(', ')} and ${changed[changed.length - 1]}`;
    await sendNotification(
        recipients,
        'An airport pickup changed',
        `Something you are collecting has changed: ${what}. Open the app.`,
        { type: 'airport-changed', pickupId },
    );
}

/**
 * A Bhulku has not asked for a lift and the window is open.
 *
 * THE ONE REPEATING NOTIFICATION IN THE APP, and the only one aimed at somebody who
 * has done nothing. Everything else here reports an event; this one is a nudge, which
 * is exactly the kind that becomes noise if it is careless. So it is bounded three
 * ways: it stops the moment they request, it never fires outside the request window,
 * and `remindUnrequestedRiders` sends it at most once a calendar day whatever the
 * scheduler does.
 *
 * NO NAME, NO DATE, NO DESTINATION — the same rule the ride notifications follow. A
 * lock screen reading "Ramesh, you have not booked your lift to sabha on Friday" tells
 * a stranger who is going out and when. The app has the detail, behind the rules.
 */
export async function notifyRideReminder(recipients: Recipient[]): Promise<DispatchResult> {
    return sendNotification(
        recipients,
        'Need a ride to sabha?',
        'Requests are open. Tap to ask for a lift.',
        { type: 'ride-reminder' },
    );
}
