import { describe, it, expect } from 'vitest';
import {
    newSabhaTimes, isUsableDuration, minutesOf,
    DEFAULT_SABHA_START, DEFAULT_SABHA_END, DROPOFF_LEAD_MINUTES,
} from '../../src/constants/schedule';

/**
 * The Settings screen's "Default Start"/"Default End" control must actually reach
 * something.
 *
 * The defect these cover: Settings wrote `sabhaStartTime`/`sabhaEndTime` to
 * settings/main and showed a success state, while the Calendar's "Add a sabha"
 * form hardcoded 19:00/22:00 and the only other reader — the one-off calendar
 * seeder — never runs again once `system/eventGenerator` is marked. So on any
 * project past its first day, saving those times changed nothing anywhere.
 *
 * `newSabhaTimes` is where that now lands, so these are the tests that fail if it
 * regresses to a constant.
 */
describe('newSabhaTimes', () => {
    it('uses the manager\'s saved defaults', () => {
        expect(newSabhaTimes({ sabhaStartTime: '18:30', sabhaEndTime: '21:15' }))
            .toEqual({ start: '18:30', end: '21:15' });
    });

    // The regression guard. A saved default that differs from the shipped
    // constant must come back changed — if this ever returns 19:00/22:00 for a
    // manager who saved 17:45/20:30, the control is silently doing nothing again.
    it('does not fall back to the shipped constant when a default is saved', () => {
        const times = newSabhaTimes({ sabhaStartTime: '17:45', sabhaEndTime: '20:30' });

        expect(times.start).not.toBe(DEFAULT_SABHA_START);
        expect(times.end).not.toBe(DEFAULT_SABHA_END);
        expect(times).toEqual({ start: '17:45', end: '20:30' });
    });

    it('carries an early-morning default through rather than clamping it', () => {
        expect(newSabhaTimes({ sabhaStartTime: '06:00', sabhaEndTime: '08:00' }))
            .toEqual({ start: '06:00', end: '08:00' });
    });

    // Falling back is correct only while settings/main has not loaded, or when the
    // stored value could not build a window at all.
    it('falls back to the shipped defaults when nothing is saved', () => {
        expect(newSabhaTimes({}))
            .toEqual({ start: DEFAULT_SABHA_START, end: DEFAULT_SABHA_END });
    });

    it('falls back for null, empty and malformed values', () => {
        for (const bad of [null, undefined, '', '  ', 'seven', '19', '19:0', '1900']) {
            expect(newSabhaTimes({ sabhaStartTime: bad as string, sabhaEndTime: bad as string }))
                .toEqual({ start: DEFAULT_SABHA_START, end: DEFAULT_SABHA_END });
        }
    });

    it('falls back per field, so one bad value does not discard a good one', () => {
        expect(newSabhaTimes({ sabhaStartTime: '18:00', sabhaEndTime: 'nope' }))
            .toEqual({ start: '18:00', end: DEFAULT_SABHA_END });
        expect(newSabhaTimes({ sabhaStartTime: 'nope', sabhaEndTime: '21:00' }))
            .toEqual({ start: DEFAULT_SABHA_START, end: '21:00' });
    });

    // The prefill feeds straight into the Add button's enabled state. If a saved
    // default produced a pair the Calendar rejects, the manager would open the
    // form to a blocked Add with no way to see why from Settings — which is why
    // LocationSettings now validates with isUsableDuration too.
    it('produces a pair the Add form accepts', () => {
        for (const saved of [
            {},
            { sabhaStartTime: '18:30', sabhaEndTime: '21:15' },
            { sabhaStartTime: '06:00', sabhaEndTime: '08:00' },
            { sabhaStartTime: 'nope', sabhaEndTime: '21:00' },
        ]) {
            const { start, end } = newSabhaTimes(saved);
            expect(isUsableDuration(start, end)).toBe(true);
        }
    });
});

/**
 * The shared rule between the two screens. Settings used to accept anything with
 * `end > start`, so 19:00–19:10 saved cleanly and then failed in the Calendar.
 */
describe('isUsableDuration', () => {
    it('accepts a normal sabha', () => {
        expect(isUsableDuration('19:00', '22:00')).toBe(true);
    });

    it('rejects a sabha shorter than the drop-off lead', () => {
        expect(isUsableDuration('19:00', '19:10')).toBe(false);
        expect(isUsableDuration('19:00', '19:15')).toBe(false);
    });

    it('sits exactly on the drop-off lead boundary', () => {
        const hhmm = (m: number) =>
            `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const start = minutesOf('19:00')!;

        expect(isUsableDuration('19:00', hhmm(start + DROPOFF_LEAD_MINUTES))).toBe(false);
        expect(isUsableDuration('19:00', hhmm(start + DROPOFF_LEAD_MINUTES + 1))).toBe(true);
    });

    it('rejects an inverted or zero-length sabha', () => {
        expect(isUsableDuration('22:00', '19:00')).toBe(false);
        expect(isUsableDuration('19:00', '19:00')).toBe(false);
    });

    it('rejects malformed input rather than guessing', () => {
        expect(isUsableDuration('', '22:00')).toBe(false);
        expect(isUsableDuration('19:00', '')).toBe(false);
        expect(isUsableDuration('seven', 'ten')).toBe(false);
    });
});

describe('minutesOf', () => {
    it('parses a well-formed time', () => {
        expect(minutesOf('19:00')).toBe(19 * 60);
        expect(minutesOf('00:00')).toBe(0);
        expect(minutesOf('23:59')).toBe(23 * 60 + 59);
        expect(minutesOf('9:05')).toBe(9 * 60 + 5);
    });

    // The copy that lived in SabhaCalendar had no range check, so "25:99" parsed
    // to 1599 minutes — an out-of-range stored default would have sailed through
    // isUsableDuration and into a new event.
    it('rejects an out-of-range hour or minute', () => {
        expect(minutesOf('24:00')).toBeNull();
        expect(minutesOf('25:99')).toBeNull();
        expect(minutesOf('19:60')).toBeNull();
    });

    it('returns null for malformed input', () => {
        expect(minutesOf('')).toBeNull();
        expect(minutesOf('1900')).toBeNull();
        expect(minutesOf('19:0')).toBeNull();
        expect(minutesOf('seven')).toBeNull();
    });
});
