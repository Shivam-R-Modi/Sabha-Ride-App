/**
 * The server's copy of the rule, pinned to the SAME vectors as the client's.
 *
 * See tests/utils/recurrence.test.ts for the pairing. The logic exists twice
 * because the client and the functions have separate tsconfigs and no shared
 * path; this file and its client twin read one fixture, so a drift in either copy
 * fails on both sides. That is the only version of the guard that holds — two
 * suites each asserting their own behaviour in their own words would pass happily
 * while disagreeing.
 *
 * The consequence being guarded is not abstract: if these two disagree, a rider
 * is shown one sabha date while dispatch works towards another.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    dayOfWeekForKey, occurrencesBetween, upcomingOccurrences, normaliseException, effectiveEvent,
    RecurrenceRule, EventException,
} from './recurrence';

const vectors = JSON.parse(readFileSync(
    // functions/src/utils → repo root → tests/fixtures
    path.resolve(__dirname, '../../../tests/fixtures/recurrence-vectors.json'), 'utf8',
));

const asRule = (partial: Record<string, unknown>): RecurrenceRule =>
    ({ ...vectors._ruleDefaults, ...partial } as RecurrenceRule);

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

describe('shared vectors — upcomingOccurrences', () => {
    it.each(vectors.upcomingOccurrences)('$name', (v: any) => {
        const out = upcomingOccurrences(
            asRule(v.rule), asExceptions(v.exceptions), v.from, v.to, v.limit,
        );

        expect(out.map(o => ({
            date: o.date, startTime: o.startTime, source: o.source,
        }))).toEqual(v.expected);
    });
});

describe('the fixture itself', () => {
    it('is actually loaded, so a bad path cannot make this suite vacuous', () => {
        // An it.each over an empty array reports zero tests and a green tick.
        expect(vectors.dayOfWeek.length).toBeGreaterThan(3);
        expect(vectors.occurrencesBetween.length).toBeGreaterThan(3);
        expect(vectors.upcomingOccurrences.length).toBeGreaterThan(3);
        expect(vectors.effectiveEvent.length).toBeGreaterThan(3);
    });
});
