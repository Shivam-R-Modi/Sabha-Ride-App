/**
 * The one line that stands for a notice when it is collapsed.
 *
 * Notices are a list now, one row each, opened one at a time. A row has to say
 * what the notice IS without showing it, so it needs a heading — and until
 * 2026-08-24 a notice had only a `body`.
 *
 * `title` is therefore OPTIONAL on the type and REQUIRED by the composer. Both
 * are deliberate: every notice written from now on has one, and the two already
 * on the board when the field landed still need a row to sit in. Their bodies
 * happen to open with a short line, because the composer's own placeholder has
 * always taught that shape, so the first line is the honest fallback rather than
 * a guess.
 */

/**
 * Mirrored in `functions/src/http/publishNotice.ts` and in `firestore.rules`,
 * with the parity pinned by tests/quality/notice-title-cap.test.ts.
 *
 * 80 characters is about what a phone shows on one line at this type size. The
 * cap is what keeps a row a row: past it a heading wraps to three lines and the
 * list stops being scannable, which is the whole reason for collapsing.
 */
export const NOTICE_TITLE_MAX = 80;

/**
 * What to print on the collapsed row.
 *
 * The fallback is capped as hard as the field is. Without that a legacy notice
 * written as one long paragraph has NO first line to speak of — the whole body
 * is the first line — and the row would render 655 characters where a heading
 * belongs. Capping turns that into a readable, if unglamorous, opener.
 *
 * Never returns an empty string: a row with no text is a control nobody can see
 * or describe, and `publishNotice` has always refused an empty body, so the last
 * resort is unreachable in practice rather than load-bearing.
 */
export function noticeHeading(notice: { title?: string; body?: string }): string {
    const title = (notice.title ?? '').trim();
    if (title) return cap(title);

    // `split` always yields at least one element, so `[0]` is safe on '' too.
    const firstLine = (notice.body ?? '').split('\n')[0].trim();
    return firstLine ? cap(firstLine) : 'Notice';
}

function cap(text: string): string {
    if (text.length <= NOTICE_TITLE_MAX) return text;
    // Trimmed again after slicing so the ellipsis never follows a space.
    return `${text.slice(0, NOTICE_TITLE_MAX).trimEnd()}…`;
}
