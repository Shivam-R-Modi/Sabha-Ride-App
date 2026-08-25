/**
 * The schedule is a rule; documents are only its exceptions.
 *
 * The load-bearing property, settled with the owner on 2026-08-17: **editing or
 * cancelling one Friday affects only that week.** The rule and every other week
 * must come out untouched. That is asserted directly, because it is the whole
 * reason this model replaced the generator.
 *
 * The generator's own hazard is gone with it: there is no watermark and no
 * `occupied` set, because nothing is created ahead of time. A cancelled date is a
 * document, and it persists by existing. The tests that used to guard
 * resurrection are deleted rather than ported — there is nothing left to
 * resurrect.
 */

import { describe, it, expect } from 'vitest';
import {
    normaliseRecurrence, normaliseException, coversDate, occurrencesBetween,
    effectiveEvent, upcomingOccurrences, dayOfWeekForKey, toVenue, datesLosingTheirSabha,
    RecurrenceRule, EventException,
} from './recurrence';

const FRIDAYS: RecurrenceRule = {
    enabled: true,
    daysOfWeek: [5],
    startTime: '19:30',
    endTime: '22:00',
    venue: null,
    agenda: '',
};

const MONDAYS: RecurrenceRule = {
    enabled: true,
    daysOfWeek: [1],
    startTime: '20:30',
    endTime: '22:00',
    venue: null,
    agenda: '',
};

const HALL = { lat: 42.3, lng: -71.1, address: 'Other Hall' };

const scheduled = (over: Partial<EventException> = {}): EventException => ({
    kind: 'override', status: 'scheduled',
    startTime: '18:00', endTime: '20:00', venue: null, agenda: '',
    ...over,
});

const cancelled = (kind: EventException['kind'] = 'override'): EventException => ({
    kind, status: 'cancelled', startTime: '', endTime: '', venue: null, agenda: '',
});

describe('dayOfWeekForKey', () => {
    it('reads the weekday without a DST edge shifting it', () => {
        expect(dayOfWeekForKey('2026-08-21')).toBe(5); // Friday
        expect(dayOfWeekForKey('2026-08-22')).toBe(6);
        expect(dayOfWeekForKey('2026-08-23')).toBe(0);
        // The US spring-forward and fall-back Sundays.
        expect(dayOfWeekForKey('2026-03-08')).toBe(0);
        expect(dayOfWeekForKey('2026-11-01')).toBe(0);
    });
});

describe('occurrencesBetween', () => {
    it('lists every matching date in the range, with no horizon of its own', () => {
        expect(occurrencesBetween(FRIDAYS, '2026-08-17', '2026-09-07'))
            .toEqual(['2026-08-21', '2026-08-28', '2026-09-04']);
    });

    it('handles several days a week, in date order', () => {
        const twice = { ...FRIDAYS, daysOfWeek: [0, 5] };

        expect(occurrencesBetween(twice, '2026-08-17', '2026-08-24'))
            .toEqual(['2026-08-21', '2026-08-23']);
    });

    it('returns nothing while the rule is off', () => {
        expect(occurrencesBetween({ ...FRIDAYS, enabled: false }, '2026-08-17', '2026-12-31'))
            .toEqual([]);
    });

    it('returns nothing for a null rule or a backwards range', () => {
        expect(occurrencesBetween(null, '2026-08-17', '2026-12-31')).toEqual([]);
        expect(occurrencesBetween(FRIDAYS, '2026-09-07', '2026-08-17')).toEqual([]);
    });

    it('includes both ends of the range', () => {
        expect(occurrencesBetween(FRIDAYS, '2026-08-21', '2026-08-21')).toEqual(['2026-08-21']);
    });

    it('keeps working across a year boundary', () => {
        expect(occurrencesBetween(FRIDAYS, '2026-12-28', '2027-01-04'))
            .toEqual(['2027-01-01']);
    });
});

describe('effectiveEvent — the priority table', () => {
    it('1. a cancellation beats everything', () => {
        expect(effectiveEvent('2026-08-21', FRIDAYS, cancelled())).toBeNull();
        expect(effectiveEvent('2026-08-25', FRIDAYS, cancelled('one-off'))).toBeNull();
    });

    it('2. a one-off stands alone, on a date the rule does not cover', () => {
        const out = effectiveEvent('2026-08-25', FRIDAYS, scheduled({ kind: 'one-off' }));

        expect(out).toMatchObject({ date: '2026-08-25', startTime: '18:00', source: 'one-off' });
    });

    it('3. an override replaces the rule occurrence entirely', () => {
        const out = effectiveEvent('2026-08-21', FRIDAYS, scheduled({ venue: HALL }));

        expect(out).toMatchObject({
            startTime: '18:00', endTime: '20:00', venue: HALL, source: 'override',
        });
    });

    it('4. otherwise the rule, where it covers the date', () => {
        const out = effectiveEvent('2026-08-21', FRIDAYS, null);

        expect(out).toMatchObject({ startTime: '19:30', endTime: '22:00', source: 'rule' });
    });

    it('5. otherwise nothing', () => {
        expect(effectiveEvent('2026-08-25', FRIDAYS, null)).toBeNull();
        expect(effectiveEvent('2026-08-21', null, null)).toBeNull();
    });

    it('an override off the pattern is INERT, not a phantom gathering', () => {
        // This is what makes turning the rule off safe. The document survives, so
        // re-enabling the rule brings the edit back.
        expect(effectiveEvent('2026-08-25', FRIDAYS, scheduled())).toBeNull();
        expect(effectiveEvent('2026-08-21', { ...FRIDAYS, enabled: false }, scheduled())).toBeNull();
    });
});

describe('editing one week affects ONLY that week', () => {
    // The property the owner asked for, stated as a test rather than a comment.
    const exceptions = new Map<string, EventException>([
        ['2026-08-28', scheduled({ startTime: '17:00', endTime: '19:00', venue: HALL })],
    ]);

    it('the edited week takes its own times and venue', () => {
        const out = upcomingOccurrences(FRIDAYS, exceptions, '2026-08-17', '2026-09-30', 8);
        const edited = out.find(o => o.date === '2026-08-28')!;

        expect(edited).toMatchObject({ startTime: '17:00', venue: HALL, source: 'override' });
    });

    it('every other week is completely unchanged', () => {
        const out = upcomingOccurrences(FRIDAYS, exceptions, '2026-08-17', '2026-09-30', 8);

        for (const o of out.filter(x => x.date !== '2026-08-28')) {
            expect(o).toMatchObject({ startTime: '19:30', endTime: '22:00', source: 'rule' });
        }
    });

    it('cancelling one week removes only that week', () => {
        const out = upcomingOccurrences(
            FRIDAYS, new Map([['2026-08-28', cancelled()]]), '2026-08-17', '2026-09-30', 8);

        expect(out.map(o => o.date)).not.toContain('2026-08-28');
        expect(out.map(o => o.date)).toEqual(
            ['2026-08-21', '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25']);
    });

    it('the rule itself is never mutated by any of this', () => {
        const before = JSON.stringify(FRIDAYS);
        upcomingOccurrences(FRIDAYS, exceptions, '2026-08-17', '2026-12-31', 20);
        expect(JSON.stringify(FRIDAYS)).toBe(before);
    });
});

describe('upcomingOccurrences', () => {
    it('stops at the limit', () => {
        const out = upcomingOccurrences(FRIDAYS, new Map(), '2026-08-17', '2026-12-31', 3);
        expect(out).toHaveLength(3);
    });

    it('sees a one-off the rule would never reach', () => {
        // Driven by the rule alone, a Tuesday gathering is invisible.
        const out = upcomingOccurrences(
            FRIDAYS,
            new Map([['2026-08-18', scheduled({ kind: 'one-off' })]]),
            '2026-08-17', '2026-08-24', 8,
        );

        expect(out.map(o => o.date)).toEqual(['2026-08-18', '2026-08-21']);
    });

    it('ignores exceptions outside the range', () => {
        const out = upcomingOccurrences(
            FRIDAYS,
            new Map([['2027-01-05', scheduled({ kind: 'one-off' })]]),
            '2026-08-17', '2026-08-24', 8,
        );

        expect(out.map(o => o.date)).toEqual(['2026-08-21']);
    });

    it('returns one-offs even with the rule switched off', () => {
        // A manager who turns the weekly schedule off but keeps a special date
        // should still have that date.
        const out = upcomingOccurrences(
            { ...FRIDAYS, enabled: false },
            new Map([['2026-08-18', scheduled({ kind: 'one-off' })]]),
            '2026-08-17', '2026-08-31', 8,
        );

        expect(out.map(o => o.date)).toEqual(['2026-08-18']);
    });

    it('returns nothing when the rule is off and there are no one-offs', () => {
        expect(upcomingOccurrences(
            { ...FRIDAYS, enabled: false }, new Map(), '2026-08-17', '2026-12-31', 8,
        )).toEqual([]);
    });
});

describe('normaliseRecurrence', () => {
    it('accepts a well-formed rule', () => {
        expect(normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
        })).toMatchObject({ enabled: true, daysOfWeek: [5], startTime: '19:30' });
    });

    it('no longer carries a horizon or a watermark', () => {
        // Both deleted with the generator. A stored value must be ignored rather
        // than quietly resurrecting the old behaviour.
        const out = normaliseRecurrence({
            enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
            weeksAhead: 10, generatedThrough: '2026-10-26',
        }) as unknown as Record<string, unknown>;

        expect(out.weeksAhead).toBeUndefined();
        expect(out.generatedThrough).toBeUndefined();
    });

    it('refuses a pattern with no days rather than guessing one', () => {
        expect(normaliseRecurrence({ enabled: true, daysOfWeek: [], startTime: '19:30', endTime: '22:00' })).toBeNull();
        expect(normaliseRecurrence({ enabled: true, startTime: '19:30', endTime: '22:00' })).toBeNull();
    });

    it('drops days that are not weekdays, and de-duplicates', () => {
        expect(normaliseRecurrence({
            enabled: true, daysOfWeek: [5, 5, 9, -1, 0, 2.5], startTime: '19:30', endTime: '22:00',
        })!.daysOfWeek).toEqual([0, 5]);
    });

    it('refuses an end at or before the start, and an unparseable time', () => {
        for (const times of [
            { startTime: '22:00', endTime: '19:30' },
            { startTime: '19:30', endTime: '19:30' },
            { startTime: '25:99', endTime: '22:00' },
            { startTime: '', endTime: '22:00' },
        ]) {
            expect(normaliseRecurrence({ enabled: true, daysOfWeek: [5], ...times })).toBeNull();
        }
    });

    it('defaults enabled to false — an unreadable flag must not start scheduling', () => {
        expect(normaliseRecurrence({
            daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
        })!.enabled).toBe(false);
    });

    it('survives junk', () => {
        expect(normaliseRecurrence(null)).toBeNull();
        expect(normaliseRecurrence('fridays')).toBeNull();
        expect(normaliseRecurrence(42)).toBeNull();
    });
});

describe('normaliseException', () => {
    it('reads an override', () => {
        expect(normaliseException({
            kind: 'override', status: 'scheduled', startTime: '18:00', endTime: '20:00',
        })).toMatchObject({ kind: 'override', status: 'scheduled', startTime: '18:00' });
    });

    it('reads a cancellation without needing usable times', () => {
        // A cancellation cancels. Requiring times would make the most important
        // exception the one most likely to be discarded.
        expect(normaliseException({ status: 'cancelled' }))
            .toMatchObject({ status: 'cancelled' });
    });

    it('treats a document with no kind as an OVERRIDE, the conservative reading', () => {
        // Documents predating this model have no `kind`. As an override they only
        // affect dates the rule already covers; as a one-off they would invent
        // gatherings nobody scheduled.
        expect(normaliseException({
            status: 'scheduled', startTime: '18:00', endTime: '20:00',
        })!.kind).toBe('override');
    });

    it('refuses a scheduled exception with no usable times', () => {
        expect(normaliseException({ status: 'scheduled' })).toBeNull();
        expect(normaliseException({ status: 'scheduled', startTime: '20:00', endTime: '18:00' })).toBeNull();
    });

    it('survives junk', () => {
        expect(normaliseException(null)).toBeNull();
        expect(normaliseException('cancelled')).toBeNull();
    });
});

describe('coversDate and toVenue', () => {
    it('coversDate follows the rule and its enabled flag', () => {
        expect(coversDate(FRIDAYS, '2026-08-21')).toBe(true);
        expect(coversDate(FRIDAYS, '2026-08-22')).toBe(false);
        expect(coversDate({ ...FRIDAYS, enabled: false }, '2026-08-21')).toBe(false);
        expect(coversDate(null, '2026-08-21')).toBe(false);
    });

    it('toVenue rejects null island and half-written coordinates', () => {
        expect(toVenue({ lat: 0, lng: 0, address: 'x' })).toBeNull();
        expect(toVenue({ lat: 42.3, address: 'x' })).toBeNull();
        expect(toVenue({ lat: NaN, lng: -71.1 })).toBeNull();
        expect(toVenue(null)).toBeNull();
        expect(toVenue({ lat: 42.3, lng: -71.1 })).toEqual({ lat: 42.3, lng: -71.1, address: '' });
    });
});

/**
 * Moving the sabha day strands whoever already booked the old one.
 *
 * Found in production on 2026-08-24: the day moved Friday -> Monday, and two
 * riders who had already answered "yes" for Friday the 28th stayed attached to
 * it. Tonight's gathering read zero people coming, and one of the two also had a
 * ride request on a date that could never be dispatched — the manager's queue
 * filters on status, never on whether the date is still a sabha.
 *
 * `datesLosingTheirSabha` is the question that was never asked. It takes the
 * dates that actually hold bookings rather than a horizon of rule dates, so it
 * needs no window and no memory of the previous rule: a date is stranded if
 * nothing happens on it any more, whatever the reason.
 */
describe('datesLosingTheirSabha', () => {
    const dated = (...keys: string[]) => keys.map(dateKey => ({ dateKey, exception: null }));

    it('strands the dates the new rule stopped covering', () => {
        // 08-28 is a Friday, 08-24 and 08-31 are Mondays.
        expect(datesLosingTheirSabha(MONDAYS, dated('2026-08-24', '2026-08-28', '2026-08-31')))
            .toEqual(['2026-08-28']);
    });

    it('strands nothing when the rule is unchanged', () => {
        expect(datesLosingTheirSabha(FRIDAYS, dated('2026-08-21', '2026-08-28'))).toEqual([]);
    });

    it('strands every booked date when repeating is turned off', () => {
        const off: RecurrenceRule = { ...FRIDAYS, enabled: false };
        expect(datesLosingTheirSabha(off, dated('2026-08-21', '2026-08-28')))
            .toEqual(['2026-08-21', '2026-08-28']);
    });

    it('strands the days dropped when several become one', () => {
        const both: RecurrenceRule = { ...FRIDAYS, daysOfWeek: [1, 5] };
        expect(datesLosingTheirSabha(both, dated('2026-08-24', '2026-08-28'))).toEqual([]);
        expect(datesLosingTheirSabha(MONDAYS, dated('2026-08-24', '2026-08-28')))
            .toEqual(['2026-08-28']);
    });

    it('does not strand a one-off that stands on its own date', () => {
        // The whole point of a one-off is that the rule does not cover it. Flagging
        // it would tell the manager to move people off a sabha that is happening.
        const oneOff: EventException = {
            kind: 'one-off', status: 'scheduled',
            startTime: '19:00', endTime: '21:00', venue: null, agenda: '',
        };
        expect(datesLosingTheirSabha(MONDAYS, [
            { dateKey: '2026-08-28', exception: oneOff },
        ])).toEqual([]);
    });

    it('strands a date the manager cancelled, even though the rule still covers it', () => {
        const cancelled: EventException = {
            kind: 'override', status: 'cancelled',
            startTime: '20:30', endTime: '22:00', venue: null, agenda: '',
        };
        expect(datesLosingTheirSabha(MONDAYS, [
            { dateKey: '2026-08-24', exception: cancelled },
        ])).toEqual(['2026-08-24']);
    });

    it('strands nothing when nobody has booked anything', () => {
        expect(datesLosingTheirSabha(MONDAYS, [])).toEqual([]);
    });
});
