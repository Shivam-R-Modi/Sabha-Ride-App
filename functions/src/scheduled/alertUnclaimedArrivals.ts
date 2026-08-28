// ============================================
// SCHEDULED: alertUnclaimedArrivals
// Nobody has taken an arrival and the plane is getting closer.
// ============================================
//
// PUSH IS THE BACKSTOP HERE, NOT THE MECHANISM — and it stays the backstop even now
// that it works. Delivery was confirmed end to end on 2026-08-28, once
// `VITE_FIREBASE_VAPID_KEY` was finally set; before that no prompt could render, so
// nobody held a token and every send went nowhere.
//
// It is still not the guarantee, because a token only exists for somebody who granted
// permission on a device that supports it — an iPhone must be installed to the Home
// Screen first, and a refusal there is permanent. So the alert that always works is
// the coordinator's own screen, which derives the same urgency from `arrivalAt` on
// every render. This job exists for the case where nobody is looking at it, and it
// must not be the only thing that can raise the alarm.
//
// THE BANDS ARE 48h / 24h / 10h / 2h, and `alertsSent` is what stops them repeating.
// `bandFor` returns the TIGHTEST band already crossed, so a request filed nine hours
// before landing fires once at '10h' rather than three times at once — and because
// time only ever decreases, a band that has been passed can never come round again,
// which is what makes a stamp per band a sufficient record.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE } from '../utils/time';
import { isAirportCoordinatorData } from '../utils/authz';
import { sendNotification, tokensOf, Recipient } from '../utils/notifications';
import { writeAuditLog } from '../utils/audit';
import { PICKUPS_COLLECTION, airportLabel, bandFor, AlertBand } from '../utils/arrival';

/** Same ceiling as the other sweeps: a runaway run is worse than a slow one. */
const MAX_PER_RUN = 100;

const HOUR_MS = 60 * 60 * 1000;
/** How far ahead to look. The widest band, plus nothing — 48h is the first alert. */
const HORIZON_MS = 48 * HOUR_MS;
/**
 * How far PAST an arrival to keep alerting.
 *
 * A plane that landed twenty minutes ago with nobody assigned is the most urgent
 * thing this job can find, so the window deliberately extends backwards. Six hours,
 * after which somebody has either sorted it out by phone or is not going to.
 */
const OVERDUE_MS = 6 * HOUR_MS;

const BAND_WORDS: Record<AlertBand, string> = {
    '48h': 'in about two days',
    '24h': 'in about a day',
    '10h': 'in under ten hours',
    '2h': 'in under two hours',
};

/**
 * Who to tell.
 *
 * COORDINATORS ONLY, and that is the one thing the `airportCoordinator` flag really
 * gates. It cannot hide the board from a manager — the role hierarchy makes every
 * manager a granted Sarthi — but it can decide who gets woken at 5am, which is what
 * the flag was asked for.
 *
 * Reads the whole users collection, like `notifyEveryone`. Fine for one
 * congregation; the same note applies about FCM topics when this is multi-city.
 */
export async function coordinatorRecipients(
    db: admin.firestore.Firestore,
): Promise<Recipient[]> {
    const snap = await db.collection('users').get();
    return snap.docs
        .filter(d => isAirportCoordinatorData(d.data()))
        .flatMap(d => tokensOf(d.id, d.data()));
}

export const alertUnclaimedArrivals = functions.pubsub
    // Every 30 minutes, not hourly. The tightest band is two hours out, and an hourly
    // job could fire it 59 minutes late — by which point "in under two hours" is a
    // lie. ponytail: still up to 30 minutes late at the 2h band. The coordinator's
    // panel is always current, so the cost is bounded; a shorter interval is the
    // upgrade path if it ever matters.
    .schedule('every 30 minutes')
    .timeZone(DEFAULT_TIME_ZONE)
    .onRun(async () => {
        const db = admin.firestore();
        const now = Date.now();

        // ONE FIELD in the query, then filtered in memory — the deliberate house
        // pattern. A `status == 'open'` clause beside the range would need a composite
        // index, and a missing index fails as an EMPTY RESULT rather than an error,
        // which would turn this job into one that runs, reports success and alerts
        // nobody.
        const snap = await db.collection(PICKUPS_COLLECTION)
            .where('arrivalAt', '>=', new Date(now - OVERDUE_MS).toISOString())
            .where('arrivalAt', '<=', new Date(now + HORIZON_MS).toISOString())
            .orderBy('arrivalAt')
            .limit(MAX_PER_RUN)
            .get();

        const due: Array<{ ref: admin.firestore.DocumentReference; band: AlertBand; data: admin.firestore.DocumentData }> = [];

        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.status !== 'open') continue;

            const band = bandFor(new Date(data.arrivalAt).getTime() - now);
            if (!band) continue;
            if (data.alertsSent?.[band]) continue;

            due.push({ ref: doc.ref, band, data });
        }

        if (due.length === 0) {
            console.log('[alertUnclaimedArrivals] nothing due');
            return null;
        }

        const recipients = await coordinatorRecipients(db);

        for (const { ref, band, data } of due) {
            const summary = `${data.requesterName ?? 'Somebody'} lands at`
                + ` ${airportLabel(String(data.airportCode ?? ''))} ${BAND_WORDS[band]}`
                + ' and no Sarthi has taken it.';

            // STAMPED BEFORE THE PUSH, and stamped even when there is nobody to push
            // to. If the stamp came after, a send that threw would leave the band
            // unrecorded and the same alert would fire every half hour for two days.
            // And a congregation with push switched off must not accumulate a backlog
            // of "unsent" bands that all fire at once the day somebody enables it.
            await ref.set({ alertsSent: { [band]: new Date().toISOString() } }, { merge: true });

            if (recipients.length > 0) {
                await sendNotification(recipients, 'Airport pickup still unclaimed', summary, {
                    type: 'airport-unclaimed',
                    pickupId: ref.id,
                    band,
                });
            }

            // Audited even when nothing was sent, because "no coordinator had push on"
            // is exactly the fact somebody will need when they ask why nobody was told.
            await writeAuditLog(db, {
                action: 'airport.update',
                actorUid: 'system:alertUnclaimedArrivals',
                actorName: 'Scheduled alert',
                targetCollection: PICKUPS_COLLECTION,
                targetDocumentId: ref.id,
                summary,
                details: { band, recipients: recipients.length },
            });
        }

        console.log(`[alertUnclaimedArrivals] alerted on ${due.length}, ${recipients.length} devices`);
        return null;
    });
