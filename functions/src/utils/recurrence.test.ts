/**
 * The recurring schedule must never resurrect a date a manager removed.
 *
 * An earlier seeder decided whether a slot had been dealt with by whether a
 * document existed there, so deleting a date erased the evidence and the
 * per-minute self-heal recreated it within 60 seconds. Two guards now stand in
 * the way — the `generatedThrough` watermark for deletions, and the `occupied`
 * set for cancellations — and both are asserted here separately, because either
 * one alone leaves a hole.
 */

import { describe, it, expect } from 'vitest';
import {
    normaliseRecurrence, datesToGenerate, advanceWatermark, dayOfWeekForKey,
    MAX_WEEKS_AHEAD, DEFAULT_WEEKS_AHEAD, RecurrenceConfig,
} from './recurrence';

const TZ = 'America/New_York';
/** A Saturday. 2026-08-15 is a Saturday; noon local keeps the key unambiguous. */
const NOW = new Date('2026-08-15T16:00:00Z');

const FRIDAYS: RecurrenceConfig = {
    enabled: true,
    daysOfWeek: [5],
    startTime: '19:00',
    endTime: '22:00',
    weeksAhead: 3,
    generatedThrough: null,
};

const none = new Set<string>();

describe('dayOfWeekForKey', () => {
    it('reads the weekday without a DST edge shifting it', () => {
        expect(dayOfWeekForKey('2026-08-14')).toBe(5); // Friday
        expect(dayOfWeekForKey('2026-08-15')).toBe(6); // Saturday
        expect(dayOfWeekForKey('2026-08-16')).toBe(0); // Sunday
        // The US spring-forward Sunday, historically where naive maths slips.
        expect(dayOfWeekForKey('2026-03-08')).toBe(0);
        expect(dayOfWeekForKey('2026-11-01')).toBe(0);
    });
});

describe('datesToGenerate', () => {
    it('fills every matching weekday out to the horizon', () => {
        expect(datesToGenerate(FRIDAYS, NOW, TZ, none))
            .toEqual(['2026-08-21', '2026-08-28', '2026-09-04']);
    });

    it('does nothing at all while disabled', () => {
        expect(datesToGenerate({ ...FRIDAYS, enabled: false }, NOW, TZ, none)).toEqual([]);
    });

    it('NEVER regenerates a date at or before the watermark', () => {
        // The deletion guard. The manager deleted 2026-08-21; it is behind the
        // mark, so it must not come back however empty the calendar looks.
        const config = { ...FRIDAYS, generatedThrough: '2026-08-28' };

        const dates = datesToGenerate(config, NOW, TZ, none);

        expect(dates).not.toContain('2026-08-21');
        expect(dates).toEqual(['2026-09-04']);
    });

    it('skips a date that already holds a document', () => {
        // The cancellation guard. A cancelled gathering keeps its document, and
        // regenerating over it would both un-cancel it and reject the batch.
        const occupied = new Set(['2026-08-28']);

        expect(datesToGenerate(FRIDAYS, NOW, TZ, occupied))
            .toEqual(['2026-08-21', '2026-09-04']);
    });

    it('needs BOTH guards — the watermark alone does not cover cancellation', () => {
        // A cancelled date ahead of the watermark is only protected by `occupied`.
        const config = { ...FRIDAYS, generatedThrough: null };

        expect(datesToGenerate(config, NOW, TZ, new Set(['2026-08-21'])))
            .not.toContain('2026-08-21');
    });

    it('needs BOTH guards — occupied alone does not cover deletion', () => {
        // A deleted date leaves no document, so `occupied` cannot see it.
        const config = { ...FRIDAYS, generatedThrough: '2026-08-21' };

        expect(datesToGenerate(config, NOW, TZ, none)).not.toContain('2026-08-21');
    });

    it('includes today when today matches the pattern', () => {
        // Enabling this on a Friday afternoon should offer that evening, not make
        // the congregation wait a week.
        const saturdays = { ...FRIDAYS, daysOfWeek: [6] };

        expect(datesToGenerate(saturdays, NOW, TZ, none)[0]).toBe('2026-08-15');
    });

    it('never offers a date in the past', () => {
        const dates = datesToGenerate({ ...FRIDAYS, weeksAhead: 26 }, NOW, TZ, none);

        expect(dates.every(d => d >= '2026-08-15')).toBe(true);
    });

    it('handles several days a week, in order', () => {
        // Two weeks from Sat 2026-08-15 is a horizon of 2026-08-29, so Sunday the
        // 30th falls outside it — the horizon is a date, not a count of weeks of
        // each day.
        const twice = { ...FRIDAYS, daysOfWeek: [0, 5], weeksAhead: 2 };

        expect(datesToGenerate(twice, NOW, TZ, none))
            .toEqual(['2026-08-16', '2026-08-21', '2026-08-23', '2026-08-28']);
    });

    it('ignores a watermark that is already in the past', () => {
        // A calendar left alone for months must start filling from today, not
        // from wherever it stopped.
        const stale = { ...FRIDAYS, generatedThrough: '2026-01-01' };

        expect(datesToGenerate(stale, NOW, TZ, none))
            .toEqual(['2026-08-21', '2026-08-28', '2026-09-04']);
    });
});

describe('advanceWatermark', () => {
    it('moves to the horizon, not the last date created', () => {
        // Otherwise a week the manager already filled leaves the mark short and
        // those dates get offered again next run.
        expect(advanceWatermark(FRIDAYS, NOW, TZ)).toBe('2026-09-05');
    });

    it('never moves backwards when the horizon shrinks', () => {
        const shrunk = { ...FRIDAYS, weeksAhead: 1, generatedThrough: '2026-12-01' };

        expect(advanceWatermark(shrunk, NOW, TZ)).toBe('2026-12-01');
    });
});

describe('normaliseRecurrence', () => {
    it('accepts a well-formed config', () => {
        const out = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00', weeksAhead: 4,
        });

        expect(out).toMatchObject({ enabled: true, daysOfWeek: [5], weeksAhead: 4 });
    });

    it('refuses a pattern with no days rather than guessing one', () => {
        // A scheduled job that guesses the day sends drivers out on the wrong
        // evening. A missing date is visible; a wrong one is not.
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [], startTime: '19:00', endTime: '22:00' })).toBeNull();
        expect(normaliseRecurrence({ enabled: true, startTime: '19:00', endTime: '22:00' })).toBeNull();
    });

    it('drops days that are not real weekdays, and de-duplicates', () => {
        const out = normaliseRecurrence({
            enabled: true, daysOfWeek: [5, 5, 9, -1, 0, 2.5], startTime: '19:00', endTime: '22:00',
        });

        expect(out!.daysOfWeek).toEqual([0, 5]);
    });

    it('refuses an end that is not after the start', () => {
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [5], startTime: '22:00', endTime: '19:00' })).toBeNull();
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '19:00' })).toBeNull();
    });

    it('refuses an unparseable time rather than defaulting it', () => {
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [5], startTime: '25:99', endTime: '22:00' })).toBeNull();
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [5], startTime: '', endTime: '22:00' })).toBeNull();
    });

    it('clamps the horizon instead of accepting a two-year promise', () => {
        const far = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00', weeksAhead: 500,
        });
        expect(far!.weeksAhead).toBe(MAX_WEEKS_AHEAD);

        const tiny = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00', weeksAhead: 0,
        });
        expect(tiny!.weeksAhead).toBe(1);
    });

    it('defaults a missing horizon', () => {
        const out = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
        });
        expect(out!.weeksAhead).toBe(DEFAULT_WEEKS_AHEAD);
    });

    it('treats a malformed watermark as absent rather than trusting it', () => {
        const out = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
            generatedThrough: 'whenever',
        });
        expect(out!.generatedThrough).toBeNull();
    });

    it('defaults enabled to false — an unreadable flag must not start generating', () => {
        const out = normaliseRecurrence({
            daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
        });
        expect(out!.enabled).toBe(false);
    });

    it('survives junk', () => {
        expect(normaliseRecurrence(null)).toBeNull();
        expect(normaliseRecurrence('friday')).toBeNull();
        expect(normaliseRecurrence(42)).toBeNull();
    });
});
