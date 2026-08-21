/**
 * Feedback: what a person may say, and how it reaches a spreadsheet.
 *
 * Pure — no React, no Firestore — so the rules below can be tested without
 * rendering a form or standing up an emulator. Same shape as src/utils/theme.ts
 * and src/utils/navOrder.ts.
 *
 * ONE SUBMISSION PER PERSON PER DAY, ENFORCED BY THE DATABASE
 * ----------------------------------------------------------
 * The document id IS the throttle. `feedback/{uid}_{YYYY-MM-DD}` plus
 * `allow update: if false` in firestore.rules means a second submission on the
 * same day is a write to a document that already exists, which is an update, and
 * updates are denied. No callable, no rate limiter, no extra reads — and unlike a
 * client-side counter it cannot be got around by reloading the page.
 *
 * The cost, stated rather than hidden: somebody with a second thought that
 * afternoon has to wait until tomorrow. For a feedback form that is a fair trade;
 * if it ever is not, the upgrade is a callable with `checkRateLimit`, the way
 * nudgeRider does it.
 */

/**
 * Longest comment accepted.
 *
 * Mirrored as a literal in firestore.rules, which cannot import this — so
 * tests/quality/feedback-cap.test.ts fails if the two ever drift. The rules copy
 * is the one that matters: this one only produces the message.
 */
export const MAX_FEEDBACK = 1000;

/** Ratings offered, low to high. */
export const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * One row as the manager's screen and the export see it.
 *
 * `name` is resolved from `users/{uid}` at read time and may be null — a deleted
 * account, or a read that failed. It is deliberately NOT stored on the feedback
 * document: a client-supplied name is unverifiable, and a forged name on a
 * complaint about a named volunteer is worse than no name at all. `uid` stays the
 * authoritative key.
 */
export interface FeedbackRow {
    createdAt: string;
    name: string | null;
    role: string | null;
    rating: number;
    comment: string;
}

/** The person and the day. Stable within a day, which is the whole point. */
export function feedbackDocId(uid: string, dateKey: string): string {
    return `${uid}_${dateKey}`;
}

/**
 * CSV escaping, lifted from generateEventCSV's `escapeCsvField`.
 *
 * A comment is free text typed on a phone: it will contain commas, quotes and
 * newlines. Any one of them unescaped shifts every column to its right — for that
 * row only, so the spreadsheet looks correct until you scroll to the row that
 * broke.
 */
function escapeCsvField(field: string): string {
    if (!field) return '';
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}

const HEADER = 'Date,Name,Role,Rating,Comment';

/**
 * The spreadsheet.
 *
 * Begins with a UTF-8 BOM. Without it Excel reads the bytes as Latin-1 and
 * mangles every non-ASCII name, which here is most of them — and nothing about
 * the file looks wrong, so the mistake survives being checked. The two exports
 * this app already had were missing it.
 *
 * An empty list returns the header rather than throwing: the caller disables its
 * button when there is nothing to export, and a builder that explodes on an empty
 * list is one more thing for the next caller to remember.
 */
export function buildFeedbackCsv(rows: FeedbackRow[]): string {
    const lines = rows.map(r => [
        escapeCsvField((r.createdAt || '').slice(0, 10)),
        escapeCsvField(r.name || 'Unknown'),
        escapeCsvField(r.role || 'Unknown'),
        // Bare, so a spreadsheet treats it as a number and can sort on it.
        String(r.rating),
        escapeCsvField(r.comment || ''),
    ].join(','));

    return `﻿${[HEADER, ...lines].join('\n')}`;
}
