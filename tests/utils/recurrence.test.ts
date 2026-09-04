/**
 * The client's copy of the rule, pinned to the SAME vectors as the server's.
 *
 * The logic lives twice — here and in functions/src/utils/recurrence.ts —
 * because the client and the functions have separate tsconfigs and no shared
 * path. The repo already mirrors constants like this, but occurrence maths is far
 * easier to get subtly wrong than three integers, and the failure mode is worse:
 * if the two copies disagree, a rider is shown one date while dispatch works
 * towards another.
 *
 * So both sides read `tests/fixtures/recurrence-vectors.json` and assert their own
 * implementation produces those answers. A drift in either copy fails on both
 * sides, which is the only version of this guard that actually holds.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    dayOfWeekForKey, occurrencesBetween, upcomingOccurrences, normaliseException, effectiveEvent, effectiveEventFor,
    normaliseRecurrence, describeRule, labelForSource, addDaysToDateKey,
    RecurrenceRule, EventException,
} from '../../src/utils/recurrence';

const vectors = JSON.parse(
    readFileSync(path.resolve(__dirname, '../fixtures/recurrence-vectors.json'), 'utf8'),
);

/** Vectors carry only what varies; the rest comes from the shared defaults. */
const asRule = (partial: Record<string, unknown>): RecurrenceRule => ({
    ...vectors._ruleDefaults,
    ...partial,
} as RecurrenceRule);

const asExceptions = (raw: Record<string, unknown>): Map<string, EventException> => {
    const out = new Map<string, EventException>();
    for (const [date, value] of Object.entries(raw ?? {})) {
        const exception = normaliseException(value);
        if (exception) out.set(date, exception);
    }
    return out;
};

describe('shared vectors — dayOfWeekForKey', () => {
    it.each(vectors.dayOfWeek)('$date is day $expected', ({ date, expected }: any) => {
        expect(dayOfWeekForKey(date)).toBe(expected);
    });
});

describe('shared vectors — occurrencesBetween', () => {
    it.each(vectors.occurrencesBetween)('$name', (v: any) => {
        expect(occurrencesBetween(asRule(v.rule), v.from, v.to)).toEqual(v.expected);
    });
});

describe('shared vectors — effectiveEvent', () => {
    // Directly, not via upcomingOccurrences: an override off the pattern never
    // reaches effectiveEvent through that path, so the guard inside it was
    // provably untested until these cases existed.
    it.each(vectors.effectiveEvent)('$name', (v: any) => {
        const out = effectiveEvent(
            v.date, asRule(v.rule), v.exception ? normaliseException(v.exception) : null,
        );

        if (v.expected === null) {
            expect(out).toBeNull();
        } else {
            expect(out).toMatchObject(v.expected);
        }
    });
});

describe('shared vectors — effectiveEventFor', () => {
    it.each(vectors.effectiveEventFor)('$name', (v: any) => {
        const out = effectiveEventFor(
            v.date,
            asRule(v.rule),
            v.dateException ? normaliseException(v.dateException) : null,
            v.hallException ? normaliseException(v.hallException) : null,
        );

        if (v.expected === null) {
            expect(out).toBeNull();
        } else {
            expect(out).toMatchObject(v.expected);
        }
    });

    it('every scheduled hall exception in the fixture actually normalises', () => {
        // The trap this suite would otherwise fall into: normaliseException returns
        // null for a scheduled exception missing a time, so a one-field snapshot
        // silently becomes "no hall exception" and the case passes while asserting
        // the date layer's own answer. Check the inputs, not just the outputs.
        for (const v of vectors.effectiveEventFor) {
            if (!v.hallException || v.hallException.status === 'cancelled') continue;
            expect(normaliseException(v.hallException), v.name).not.toBeNull();
        }
    });
});

describe('shared vectors — upcomingOccurrences', () => {
    it.each(vectors.upcomingOccurrences)('$name', (v: any) => {
        const out = upcomingOccurrences(
            asRule(v.rule), asExceptions(v.exceptions), v.from, v.to, v.limit,
        );

        expect(out.map((o) => ({
            date: o.date, startTime: o.startTime, source: o.source,
        }))).toEqual(v.expected);
    });
});

// ── client-only helpers, not part of the shared contract ─────────

describe('the fixture itself', () => {
    it('is actually loaded, so a bad path cannot make this suite vacuous', () => {
        // Every block above is an it.each. Over an empty array that reports zero
        // tests and a green tick, so a broken relative path would delete the client
        // half of the mirror guard without failing anything. The server copy has
        // carried this check since it was written; this one had not.
        expect(vectors.dayOfWeek.length).toBeGreaterThan(3);
        expect(vectors.occurrencesBetween.length).toBeGreaterThan(3);
        expect(vectors.upcomingOccurrences.length).toBeGreaterThan(3);
        expect(vectors.effectiveEvent.length).toBeGreaterThan(3);
        expect(vectors.effectiveEventFor.length).toBeGreaterThan(3);
    });
});

describe('addDaysToDateKey', () => {
    it('crosses months and years', () => {
        expect(addDaysToDateKey('2026-08-31', 1)).toBe('2026-09-01');
        expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('is unaffected by the DST switch', () => {
        // UTC arithmetic on purpose: a local-time step over the spring-forward
        // Sunday can land on the same day twice.
        expect(addDaysToDateKey('2026-03-07', 1)).toBe('2026-03-08');
        expect(addDaysToDateKey('2026-03-08', 1)).toBe('2026-03-09');
    });
});

describe('describeRule', () => {
    it('reads as a schedule', () => {
        expect(describeRule(asRule({ enabled: true, daysOfWeek: [5] })))
            // 12-hour, like every other time this app shows a person. It printed
            // the stored 24-hour value until 2026-08-21, which put two clock
            // formats on one card.
            .toBe('Every Friday, 7:30 PM–10:00 PM');
    });

    it('names every day when there are several', () => {
        expect(describeRule(asRule({ enabled: true, daysOfWeek: [0, 5] })))
            .toMatch(/Sunday, Friday/);
    });

    it('says so plainly when there is no repeat', () => {
        expect(describeRule(asRule({ enabled: false, daysOfWeek: [5] }))).toBe('Not repeating');
        expect(describeRule(null)).toBe('Not repeating');
    });
});

describe('labelForSource', () => {
    it('badges only the rows that diverge from the schedule', () => {
        // A date straight from the rule gets no badge. Labelling every row "from
        // the schedule" is noise, and noise is what made the old calendar
        // unreadable.
        expect(labelForSource('rule')).toBeNull();
        expect(labelForSource('override')).toBe('Edited');
        expect(labelForSource('one-off')).toBe('One-off');
    });
});

describe('normaliseRecurrence — client copy', () => {
    it('ignores a horizon left over from the generator', () => {
        const out = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
            weeksAhead: 10, generatedThrough: '2026-10-26',
        }) as unknown as Record<string, unknown>;

        expect(out.weeksAhead).toBeUndefined();
        expect(out.generatedThrough).toBeUndefined();
    });

    it('refuses a rule the server would also refuse', () => {
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [], startTime: '19:30', endTime: '22:00' })).toBeNull();
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [5], startTime: '25:99', endTime: '22:00' })).toBeNull();
        expect(normaliseRecurrence(null)).toBeNull();
    });
});
