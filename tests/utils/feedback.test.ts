/**
 * Feedback: the spreadsheet, and the one-per-day key.
 *
 * TWO THINGS HERE ARE EASY TO GET WRONG AND INVISIBLE WHEN THEY ARE
 * ------------------------------------------------------------------
 * **The BOM.** Without it Excel reads a UTF-8 file as Latin-1 and mangles every
 * non-ASCII name — which in this congregation is most of them. The file still
 * opens, the columns still line up, and the names are quietly wrong. The two
 * exports this app already had are missing it, so this is not hypothetical.
 *
 * **The escaping.** A comment is free text from a phone keyboard: it will contain
 * commas, quotes and newlines. Any of the three unescaped shifts every column to
 * its right for that row only, so a spreadsheet looks fine until you scroll to
 * the row that broke it.
 *
 * `feedbackDocId` is the whole anti-spam mechanism. The document id is the person
 * and the day, and the rules deny `update`, so a second submission is refused by
 * the database rather than by a client that can be reloaded. If this function
 * ever returns something unstable within a day, that guarantee silently
 * disappears.
 */

import { describe, it, expect } from 'vitest';
import { buildFeedbackCsv, feedbackDocId, MAX_FEEDBACK, type FeedbackRow } from '../../src/utils/feedback';

const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
    createdAt: '2026-08-21T19:30:00.000Z',
    name: 'Kishan Parekh',
    role: 'student',
    rating: 5,
    comment: 'The pickup was on time.',
    ...over,
});

/** The data rows, with the header and the BOM line stripped off. */
const dataRows = (csv: string) => csv.replace(/^﻿/, '').split('\n').slice(1);

describe('buildFeedbackCsv', () => {
    it('starts with a UTF-8 BOM so Excel does not mangle names', () => {
        // Not decoration. Without this, "Kiran Desai" survives and a Gujarati name
        // does not, and nothing about the file looks wrong.
        expect(buildFeedbackCsv([row()]).startsWith('﻿')).toBe(true);
    });

    it('names its columns', () => {
        const header = buildFeedbackCsv([row()]).replace(/^﻿/, '').split('\n')[0];

        expect(header).toBe('Date,Name,Role,Rating,Comment');
    });

    it('writes one line per submission', () => {
        expect(dataRows(buildFeedbackCsv([row(), row({ name: 'He Het' })]))).toHaveLength(2);
    });

    it('quotes a comment containing a comma', () => {
        const csv = buildFeedbackCsv([row({ comment: 'Good, mostly' })]);

        expect(csv).toContain('"Good, mostly"');
        expect(dataRows(csv)).toHaveLength(1);
    });

    it('doubles a quote inside a comment', () => {
        const csv = buildFeedbackCsv([row({ comment: 'He said "on time"' })]);

        expect(csv).toContain('"He said ""on time"""');
    });

    it('keeps a newline inside its cell instead of starting a new row', () => {
        // A phone keyboard puts newlines in a textarea. Unquoted, this row would
        // become two rows and every column after it would be wrong.
        const csv = buildFeedbackCsv([row({ comment: 'Line one\nLine two' })]);

        expect(csv).toContain('"Line one\nLine two"');
        // Header + a two-physical-line record.
        expect(csv.replace(/^﻿/, '').split('\n')).toHaveLength(3);
    });

    it('escapes a comma in a name too, not just in the comment', () => {
        const csv = buildFeedbackCsv([row({ name: 'Parekh, Kishan' })]);

        expect(csv).toContain('"Parekh, Kishan"');
    });

    it('says so when the name could not be resolved', () => {
        // The name comes from users/{uid} at read time, and a deleted account or a
        // read that failed must not print `undefined` into a spreadsheet a manager
        // will act on.
        const csv = buildFeedbackCsv([row({ name: null })]);

        expect(csv).toContain('Unknown');
        expect(csv).not.toContain('undefined');
        expect(csv).not.toContain('null');
    });

    it('writes the rating as a bare number, so a spreadsheet can sort it', () => {
        const line = dataRows(buildFeedbackCsv([row({ rating: 3 })]))[0];

        expect(line).toContain(',3,');
    });

    it('writes the date as a plain calendar day', () => {
        const line = dataRows(buildFeedbackCsv([row()]))[0];

        expect(line.startsWith('2026-08-21')).toBe(true);
    });

    it('survives a submission with no comment at all', () => {
        expect(() => buildFeedbackCsv([row({ comment: '' })])).not.toThrow();
    });

    it('returns just the header for an empty list', () => {
        // Better than throwing: the caller disables the button, and a builder that
        // explodes on an empty list is one more thing to remember.
        const csv = buildFeedbackCsv([]);

        expect(csv.replace(/^﻿/, '')).toBe('Date,Name,Role,Rating,Comment');
    });
});

describe('feedbackDocId', () => {
    it('is derived from nothing but the person and the day', () => {
        // Asserted as an EXACT string, not by calling it twice and comparing.
        // Two calls in the same millisecond agree even if the id secretly carries
        // a clock — which is how a version appending `Date.now()` passed an
        // earlier draft of this test. Same timing trap as the one fixed in
        // completeRideAbsence.test.ts.
        expect(feedbackDocId('u1', '2026-08-21')).toBe('u1_2026-08-21');
    });

    it('changes the next day', () => {
        expect(feedbackDocId('u1', '2026-08-21')).not.toBe(feedbackDocId('u1', '2026-08-22'));
    });

    it('differs between people on the same day', () => {
        expect(feedbackDocId('u1', '2026-08-21')).not.toBe(feedbackDocId('u2', '2026-08-21'));
    });

    it('produces a usable Firestore id — no slashes', () => {
        // A `/` would silently create a subcollection path instead of a document.
        expect(feedbackDocId('u1', '2026-08-21')).not.toContain('/');
    });
});

describe('MAX_FEEDBACK', () => {
    it('is a sane ceiling for a comment', () => {
        expect(MAX_FEEDBACK).toBe(1000);
    });
});
