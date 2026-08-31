/**
 * WHICH NOTIFICATIONS EXIST, AND WHAT A MANAGER MAY DO TO THEM.
 *
 * MIRRORED into functions/src/constants/notifications.ts, byte for byte, and pinned by
 * tests/quality/notification-catalogue-parity.test.ts. Both sides need it and neither
 * can import the other: the client renders the control panel from this list, and the
 * server enforces it inside `sendNotification`. The same arrangement as
 * src/utils/arrival.ts, and for the same reason — two copies of a table that must
 * agree, held together by a test rather than by hope.
 *
 * WHY A CATALOGUE AT ALL, rather than a boolean per call site: this app's recurring
 * defect is a control that looks wired up and silently does nothing. A manager screen
 * built from a hand-written list would drift the moment somebody adds a notification
 * and forgets the row, and the drift is INVISIBLE — the screen just quietly does not
 * mention it. So the list is one object, the guard reads the same object, and
 * tests/quality/notifications-are-manageable.test.ts fails if any send in
 * functions/src carries a `type` that is not in here.
 *
 * EVERY ENTRY IS KEYED BY THE `type` TAG ALREADY IN THE PUSH PAYLOAD. That tag was
 * there before this file for client-side click routing, so nothing new has to be
 * threaded through thirteen call sites — the guard reads `data.type` and looks it up.
 *
 * WHAT IS DELIBERATELY NOT HERE: the message text. The wording in
 * functions/src/utils/notifications.ts is a privacy control, not a preference — no
 * rider names, no addresses, no destinations, because a push lands on a lock screen
 * that may belong to a child. `ride_completed` used to read "Home Safe! You have
 * arrived home safely", which told anybody holding the phone that this particular
 * child is home and when. Handing a manager a free-text box puts that back one
 * well-meaning edit later. Broadcasts and notices stay free-text because they are
 * about the congregation, not about one child.
 */

/** The `type` tag on the push payload. One per notification the app can send. */
export type NotificationKey =
    // ---- Sabha Seva ----
    | 'driver_assigned'
    | 'students_assigned'
    | 'ride_starting'
    | 'sarthi_arrived'
    | 'sarthi_waiting'
    | 'ride_completed'
    | 'window-opened'
    | 'sabha-deleted'
    | 'ride-reminder'
    | 'broadcast'
    | 'notice'
    // ---- Airport Seva ----
    | 'airport-claimed'
    | 'airport-changed'
    | 'airport-unclaimed';

export type NotificationService = 'sabha' | 'airport';

/**
 * What kind of cadence this notification has, which decides whether the panel shows a
 * frequency control beside its switch.
 *
 * 'none' IS THE ANSWER FOR ELEVEN OF THE FOURTEEN, and saying so explicitly is the
 * point. They fire once, when a thing happens; there is no frequency to edit. A
 * frequency field rendered against one of them would be a control that changes
 * nothing — exactly the failure this codebase keeps removing.
 */
export type FrequencyKind = 'none' | 'bands' | 'cooldown' | 'reminder';

export interface NotificationSpec {
    key: NotificationKey;
    service: NotificationService;
    /** Row heading in the manager panel. */
    label: string;
    /** Who receives it — shown so a manager knows whose phone goes quiet. */
    audience: string;
    /** When it fires. */
    trigger: string;
    frequency: FrequencyKind;
    /**
     * Muting this one strands somebody, so the panel asks twice.
     *
     * NOT disabled, deliberately. A toggle a manager cannot move and cannot be told why
     * is the same dead control in a different coat — and there are legitimate reasons to
     * silence any of these (a test congregation, a push provider outage sending
     * duplicates). The confirmation is friction, not a veto, and every toggle writes an
     * audit row either way.
     */
    important?: boolean;
}

/**
 * The whole catalogue, in the order the panel renders it.
 *
 * `notifyManagerUnassignedStudents` is NOT here and is deleted from
 * functions/src/utils/notifications.ts in the same change. It was defined, carried a
 * `type: 'unassigned_students'` tag, and was called from nowhere — so listing it would
 * have given a manager a switch over a notification that has never once been sent.
 */
export const NOTIFICATION_CATALOGUE: readonly NotificationSpec[] = [
    // ---- Sabha Seva ----
    {
        key: 'window-opened',
        service: 'sabha',
        label: 'Ride requests are open',
        audience: 'Everybody',
        trigger: 'The request window opens for the next sabha',
        frequency: 'none',
    },
    {
        key: 'ride-reminder',
        service: 'sabha',
        label: 'Reminder to request a ride',
        audience: 'Bhulka who have not asked yet',
        trigger: 'Every day while the window is open',
        frequency: 'reminder',
    },
    {
        key: 'driver_assigned',
        service: 'sabha',
        label: 'Sarthi assigned',
        audience: 'The Bhulku',
        trigger: 'A Sarthi is put on their ride',
        frequency: 'none',
    },
    {
        key: 'students_assigned',
        service: 'sabha',
        label: 'Bhulka assigned',
        audience: 'The Sarthi',
        trigger: 'Bhulka are put on their route',
        frequency: 'none',
    },
    {
        key: 'ride_starting',
        service: 'sabha',
        label: 'Sarthi on the way',
        audience: 'The Bhulku',
        trigger: 'The Sarthi starts the ride',
        frequency: 'none',
    },
    {
        key: 'sarthi_arrived',
        service: 'sabha',
        label: 'Sarthi has arrived',
        audience: 'The Bhulku',
        trigger: 'The Sarthi taps that they are outside',
        frequency: 'none',
        important: true,
    },
    {
        key: 'sarthi_waiting',
        service: 'sabha',
        label: 'Sarthi is waiting',
        audience: 'The Bhulku',
        trigger: 'The Sarthi nudges, because nobody came out',
        frequency: 'cooldown',
        important: true,
    },
    {
        key: 'ride_completed',
        service: 'sabha',
        label: 'Ride complete',
        audience: 'The Bhulku',
        trigger: 'The ride is finished',
        frequency: 'none',
    },
    {
        key: 'sabha-deleted',
        service: 'sabha',
        label: 'Sabha cancelled',
        audience: 'Everybody who asked for a ride',
        trigger: 'A manager cancels a sabha',
        frequency: 'none',
        important: true,
    },
    {
        key: 'broadcast',
        service: 'sabha',
        label: 'Manager broadcast',
        audience: 'Everybody',
        trigger: 'A manager sends a message',
        frequency: 'none',
    },
    {
        key: 'notice',
        service: 'sabha',
        label: 'New notice',
        audience: 'Everybody',
        trigger: 'A manager publishes a notice',
        frequency: 'none',
    },
    // ---- Airport Seva ----
    {
        key: 'airport-claimed',
        service: 'airport',
        label: 'A Sarthi is coming for you',
        audience: 'The traveller',
        trigger: 'A Sarthi claims their pickup',
        frequency: 'none',
        important: true,
    },
    {
        key: 'airport-changed',
        service: 'airport',
        label: 'An airport pickup changed',
        audience: 'The Sarthi who claimed it',
        trigger: 'The traveller edits a claimed pickup',
        frequency: 'none',
    },
    {
        key: 'airport-unclaimed',
        service: 'airport',
        label: 'Pickup still unclaimed',
        audience: 'Airport coordinators',
        trigger: 'Nobody has taken a pickup, as the plane gets closer',
        frequency: 'bands',
    },
];

export const NOTIFICATION_KEYS: readonly NotificationKey[] =
    NOTIFICATION_CATALOGUE.map(spec => spec.key);

export function specFor(key: string): NotificationSpec | undefined {
    return NOTIFICATION_CATALOGUE.find(spec => spec.key === key);
}

export function catalogueFor(service: NotificationService): readonly NotificationSpec[] {
    return NOTIFICATION_CATALOGUE.filter(spec => spec.service === service);
}

// ── What a manager may set ──────────────────────────────────────────────────

/**
 * The bands a manager may pick for the unclaimed-pickup escalation, in hours.
 *
 * A FIXED SET, not a free number field. Two reasons, and only the first is taste.
 * `alertUnclaimedArrivals` runs every 30 minutes, so a band tighter than an hour
 * CANNOT BE HONOURED — it would fire up to half an hour late and the message would
 * read "in under 30 minutes" while the plane is on the ground. Offering a number box
 * would let a manager set a value the scheduler is physically unable to keep, which is
 * a promise the app breaks silently.
 *
 * 10 is in the list only because it is one of the shipped defaults. Dropping it would
 * mean the default configuration is not expressible in the UI that edits it, so the
 * first save from an untouched panel would quietly change behaviour.
 */
export const ALERT_BAND_CHOICES: readonly number[] = [1, 2, 6, 10, 12, 24, 48];

/** What the job has always used. Unchanged, now merely editable. */
export const DEFAULT_ALERT_BANDS: readonly number[] = [48, 24, 10, 2];

/**
 * At most this many bands. Four is the shipped default and six is already a lot of
 * pushes for one pickup; the cap is what stops "a bit more warning" becoming a pager.
 */
export const MAX_ALERT_BANDS = 6;

/** How long a Sarthi must wait before nudging the same rider again, in seconds. */
export const NUDGE_COOLDOWN_CHOICES: readonly number[] = [30, 60, 120, 300];
export const DEFAULT_NUDGE_COOLDOWN_SEC = 60;

/**
 * How often the un-requested reminder repeats.
 *
 * 'daily' is what was asked for: from the moment the window opens until the sabha, a
 * Bhulku who has not booked hears once a day. 'day-before' is the narrower option, and
 * it is here because it needs NO STORED STATE to implement — it is simply "is tomorrow
 * the sabha" — so offering it costs nothing. Anything like "every third day" would
 * need a per-person record of when they were last reminded, which is a new pile of
 * writes against documents belonging to minors for very little.
 */
export type ReminderCadence = 'daily' | 'day-before';
export const REMINDER_CADENCES: readonly ReminderCadence[] = ['daily', 'day-before'];

/**
 * The hour the reminder goes out, in Sabha local time, 0–23.
 *
 * TEN IN THE MORNING, and the default matters more than it looks. The reminder is
 * pinned to a clock hour rather than to "when the window opens" because the window
 * opens at midnight — see `requestsOpenTime` in functions/src/utils/schedule.ts, whose
 * default this change also moves to 10:00. A notification that fires the instant a
 * window opens at 00:00 wakes a congregation to tell them they may book a lift in two
 * days' time.
 */
export const DEFAULT_REMINDER_HOUR = 10;

/** The resolved, always-complete configuration. Never partial, never undefined. */
export interface NotificationSettings {
    enabled: Record<NotificationKey, boolean>;
    /** Escalation points for 'airport-unclaimed', in hours, widest first. */
    alertBands: number[];
    /** Nudge cooldown for 'sarthi_waiting', in seconds. */
    nudgeCooldownSec: number;
    /** Local hour 0–23 at which 'ride-reminder' goes out. */
    reminderHour: number;
    reminderCadence: ReminderCadence;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
    enabled: NOTIFICATION_KEYS.reduce(
        (acc, key) => { acc[key] = true; return acc; },
        {} as Record<NotificationKey, boolean>,
    ),
    alertBands: [...DEFAULT_ALERT_BANDS],
    nudgeCooldownSec: DEFAULT_NUDGE_COOLDOWN_SEC,
    reminderHour: DEFAULT_REMINDER_HOUR,
    reminderCadence: 'daily',
};

/**
 * Turn whatever is in `settings/notifications` into a complete configuration.
 *
 * FAILS OPEN, IN EVERY DIRECTION, and that is the single most important property in
 * this file. A missing document, a malformed one, a hand-edit in the Database Console,
 * a half-written save — all of them resolve to "send it". The alternative is a config
 * bug that silences "Your Sarthi is outside waiting for you", which is strictly worse
 * than a config bug that sends a notification somebody wanted off. Same shape as
 * `getSabhaLocation` and `getTimeZone`, which fall back rather than throw for the same
 * reason: this is read inside scheduled jobs and ride completions, and refusing would
 * take the ride down with it.
 *
 * ONLY `=== false` DISABLES. Not falsy — `undefined`, `null`, `0` and `''` all mean
 * "nobody has said otherwise", and only an explicit false is a manager's decision.
 *
 * Pure, so the whole matrix is testable without Firestore.
 */
export function resolveNotificationSettings(raw: unknown): NotificationSettings {
    const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const rawEnabled = (doc.enabled && typeof doc.enabled === 'object'
        ? doc.enabled : {}) as Record<string, unknown>;
    const enabled = NOTIFICATION_KEYS.reduce((acc, key) => {
        acc[key] = rawEnabled[key] !== false;
        return acc;
    }, {} as Record<NotificationKey, boolean>);

    return {
        enabled,
        alertBands: resolveAlertBands(doc.alertBands),
        nudgeCooldownSec: NUDGE_COOLDOWN_CHOICES.includes(doc.nudgeCooldownSec as number)
            ? (doc.nudgeCooldownSec as number)
            : DEFAULT_NUDGE_COOLDOWN_SEC,
        reminderHour: Number.isInteger(doc.reminderHour)
            && (doc.reminderHour as number) >= 0 && (doc.reminderHour as number) <= 23
            ? (doc.reminderHour as number)
            : DEFAULT_REMINDER_HOUR,
        reminderCadence: REMINDER_CADENCES.includes(doc.reminderCadence as ReminderCadence)
            ? (doc.reminderCadence as ReminderCadence)
            : 'daily',
    };
}

/**
 * Clean a band list: known values only, no duplicates, widest first, capped.
 *
 * AN EMPTY RESULT FALLS BACK TO THE DEFAULTS rather than meaning "never alert". Turning
 * the whole escalation off is what the `airport-unclaimed` switch is for, and it says
 * so on the panel; an empty array arriving here is far more likely to be a broken save
 * than a deliberate silence, and the failure mode of guessing wrong is a traveller
 * standing in an arrivals hall with nobody coming.
 */
export function resolveAlertBands(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [...DEFAULT_ALERT_BANDS];

    const clean = Array.from(new Set(
        raw.filter((h): h is number => ALERT_BAND_CHOICES.includes(h as number)),
    )).sort((a, b) => b - a).slice(0, MAX_ALERT_BANDS);

    return clean.length > 0 ? clean : [...DEFAULT_ALERT_BANDS];
}
