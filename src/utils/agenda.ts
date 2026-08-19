/**
 * The sabha agenda, as long-form text.
 *
 * It used to be a one-line `<input type="text">` shown only inside the manager's
 * own calendar — `useCurrentEvent` read it off `system/rideContext` and no
 * component ever rendered it, so a manager could type an agenda and nobody in the
 * congregation would ever see it. Widening it to a paragraph is only half the
 * job; the other half is that it now appears on every dashboard.
 *
 * Pure, so the ceiling and the summarising can be tested without a browser.
 */

/**
 * Ceiling on an agenda, in characters.
 *
 * MIRRORED AS A LITERAL IN `firestore.rules` — the events block cannot import
 * this. `tests/quality/agenda-cap.test.ts` fails if the two drift apart. The
 * client writes `events/{date}` directly, so the rules copy is the one that
 * actually enforces it; this copy exists to give a readable message first.
 */
export const AGENDA_MAX_CHARS = 2000;

/** A message for a manager, or null when the text is fine. */
export function describeAgendaProblem(text: string): string | null {
    if (text.length > AGENDA_MAX_CHARS) {
        return `That agenda is ${text.length} characters. Please keep it under ${AGENDA_MAX_CHARS}.`;
    }
    return null;
}

/**
 * One line, for the calendar list — where each sabha is a single row and a
 * pasted paragraph would push the times and venue off the card.
 *
 * Ends in an ellipsis whenever anything was left out, including when the first
 * line fits but more lines follow. A summary that silently drops four paragraphs
 * reads like the agenda is one line long.
 */
export function agendaSummary(text: string | undefined | null, max = 60): string {
    if (!text) return '';
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return '';

    const [first, ...rest] = lines as [string, ...string[]];
    if (first.length <= max) return rest.length > 0 ? `${first} …` : first;
    return `${first.slice(0, max).trimEnd()}…`;
}
