/**
 * Sabha timing policy, client side. Mirror of functions/src/utils/schedule.ts —
 * separate tsconfigs, no shared path, so the two files must hold the same values.
 *
 * Pure on purpose: it holds no Firebase import, so both manager screens and the
 * test suite can use it. It lived inside SabhaCalendar.tsx until a test needed it
 * and could not import the component without initialising Firebase Auth.
 *
 * The distinction that matters here, and the one this app has got wrong twice:
 * DEFAULT_SABHA_START/END are **defaults**, not the schedule. Every gathering in
 * the `events` collection carries its own startTime/endTime, and the published
 * ride window is built from those (buildCurrentEvent on the server). These values
 * prefill a new sabha and fill in for a missing or malformed one. They do not move
 * a sabha already on the calendar.
 */

/**
 * Where the standing schedule lives. Mirror of `RECURRENCE_DOC` in
 * functions/src/http/sabhaRecurrence.ts.
 *
 * This string was written out twice — once there, once inline in
 * RecurringSabha.tsx — which is one path with two owners and no way to notice
 * them diverging. A typo in the client copy would not error: `onSnapshot` on a
 * document that does not exist reports "no rule", the form would show its
 * placeholders, and saving would create a schedule at the wrong path while the
 * server kept reading the old one. Silent, and it would look like the rule had
 * simply reset itself.
 *
 * tests/quality/schedule-not-hardcoded.test.ts pins that there are exactly these
 * two definitions and no third.
 */
export const RECURRENCE_DOC = 'settings/sabhaRecurrence';

/**
 * "19:00" -> "7:00 PM". Mirrors formatTimeForDisplay in
 * functions/src/utils/schedule.ts.
 *
 * Moved here from hooks/useSettings.ts, which imports firebase/config — so a pure
 * module that wanted to print a time could not have it, and `describeRule` ended
 * up showing the manager "Every Friday, 20:30-22:00" one line above a card
 * reading "8:30 PM - 10:00 PM". Two clock formats, same card.
 *
 * useSettings still re-exports it, so every existing import is unchanged.
 */
export function formatTime(value: string): string {
    const match = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
    if (!match) return value;

    const hours24 = Number(match[1]);
    const minutes = match[2];
    if (hours24 < 0 || hours24 > 23) return value;

    const suffix = hours24 < 12 ? 'AM' : 'PM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

    return `${hours12}:${minutes} ${suffix}`;
}

/**
 * "2026-08-14" -> "Friday, Aug 14". Built from the date parts, so no timezone shift.
 *
 * Lives here rather than in a component for the same reason `formatTime` does: a
 * third copy had started to appear the moment a second screen needed to name a
 * date, and two formatters drift into disagreeing about the same day.
 */
export function formatDateLong(dateKey: string): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long', day: 'numeric', month: 'short',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** Fallback sabha start and end, "HH:MM" in Sabha local time. */
export const DEFAULT_SABHA_START = '19:00';
export const DEFAULT_SABHA_END = '22:00';

/**
 * Drop-off opens this many minutes before a sabha ends.
 *
 * A sabha must run longer than this or the window inverts: drop-off would open
 * before it started and pickup would flip straight to drop-off. The server clamps
 * it too (buildCurrentEvent), but rejecting it in the UI means the manager finds
 * out at the point of saving rather than never.
 */
export const DROPOFF_LEAD_MINUTES = 15;

/** Ride requests open this many days before a sabha. Mirrors PICKUP_LEAD_DAYS. */
export const PICKUP_LEAD_DAYS = 2;

/** "19:00" → 1140. Null for anything that is not a well-formed time. */
export function minutesOf(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
    if (!m) return null;

    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
}

/** Long enough to hold a sabha AND get drivers moving before it ends. */
export function isUsableDuration(start: string, end: string): boolean {
    const s = minutesOf(start);
    const e = minutesOf(end);
    if (s === null || e === null) return false;
    return e - s > DROPOFF_LEAD_MINUTES;
}

/**
 * The times a newly added sabha starts out with.
 *
 * These MUST come from the manager's saved defaults, never from a constant. The
 * Settings screen labels those fields "Default Start"/"Default End" and tells the
 * manager they are used for a newly added sabha — and for a while that was simply
 * untrue: the Calendar's "Add a sabha" form hardcoded 19:00/22:00, and the only
 * other reader was the one-off calendar seeder, which never runs again once
 * `system/eventGenerator` is marked. So on any project past its first day, saving
 * those times changed nothing anywhere, and reported success while doing it.
 *
 * Falls back to the shipped defaults only for the moment before settings/main has
 * loaded, or when the stored value could not build a window at all.
 */
export function newSabhaTimes(
    saved: { sabhaStartTime?: string | null; sabhaEndTime?: string | null },
): { start: string; end: string } {
    const usable = (value: string | null | undefined): string | null =>
        typeof value === 'string' && minutesOf(value) !== null ? value : null;

    return {
        start: usable(saved.sabhaStartTime) ?? DEFAULT_SABHA_START,
        end: usable(saved.sabhaEndTime) ?? DEFAULT_SABHA_END,
    };
}
