import { describe, it, expect } from 'vitest';
import {
    resolveScheduleWindow, parseTimeToMinutes, formatTimeForDisplay,
    DEFAULT_SABHA_START, DEFAULT_SABHA_END,
} from './schedule';

const ZONE = 'America/New_York';

/** A Date at a given Boston wall-clock time. August, so EDT (UTC-4). */
const boston = (day: string, hhmm: string) =>
    new Date(`2026-08-${day}T${hhmm}:00-04:00`);

// August 2026: 3rd = Mon, 4th = Tue, 5th = Wed, 6th = Thu, 7th = Fri, 8th = Sat
const MON = '03', TUE = '04', WED = '05', THU = '06', FRI = '07', SAT = '08';

const windowAt = (day: string, hhmm: string, start = '19:00', end = '22:00') =>
    resolveScheduleWindow(boston(day, hhmm), ZONE, start, end);

describe('parseTimeToMinutes', () => {
    it('parses HH:MM', () => {
        expect(parseTimeToMinutes('19:00')).toBe(19 * 60);
        expect(parseTimeToMinutes('7:05')).toBe(7 * 60 + 5);
        expect(parseTimeToMinutes('00:00')).toBe(0);
    });

    it('refuses anything it cannot parse rather than guessing', () => {
        // A malformed setting silently becoming 00:00 would open drop-off all day.
        expect(parseTimeToMinutes('7pm')).toBeNull();
        expect(parseTimeToMinutes('25:00')).toBeNull();
        expect(parseTimeToMinutes('19:99')).toBeNull();
        expect(parseTimeToMinutes('')).toBeNull();
        expect(parseTimeToMinutes(undefined)).toBeNull();
        expect(parseTimeToMinutes(1900)).toBeNull();
    });
});

describe('formatTimeForDisplay', () => {
    it('converts to 12-hour for riders', () => {
        expect(formatTimeForDisplay('19:00')).toBe('7:00 PM');
        expect(formatTimeForDisplay('09:30')).toBe('9:30 AM');
        expect(formatTimeForDisplay('00:15')).toBe('12:15 AM');
        expect(formatTimeForDisplay('12:00')).toBe('12:00 PM');
    });
});

describe('resolveScheduleWindow', () => {
    it('opens pickups on Wednesday', () => {
        expect(windowAt(WED, '00:01').rideType).toBe('home-to-sabha');
        expect(windowAt(WED, '14:00').rideType).toBe('home-to-sabha');
        expect(windowAt(WED, '23:59').rideType).toBe('home-to-sabha');
    });

    it('keeps pickups open on Thursday', () => {
        expect(windowAt(THU, '09:00').rideType).toBe('home-to-sabha');
    });

    it('keeps pickups open on Friday until sabha starts', () => {
        expect(windowAt(FRI, '09:00').rideType).toBe('home-to-sabha');
        expect(windowAt(FRI, '18:59').rideType).toBe('home-to-sabha');
    });

    it('closes rides once sabha has started', () => {
        expect(windowAt(FRI, '19:00').rideType).toBeNull();
        expect(windowAt(FRI, '21:00').rideType).toBeNull();
    });

    it('opens drop-off 15 minutes before sabha ends', () => {
        expect(windowAt(FRI, '21:44').rideType).toBeNull();
        expect(windowAt(FRI, '21:45').rideType).toBe('sabha-to-home');
        expect(windowAt(FRI, '23:30').rideType).toBe('sabha-to-home');
    });

    it('is closed Saturday through Tuesday', () => {
        expect(windowAt(SAT, '12:00').rideType).toBeNull();
        expect(windowAt(MON, '12:00').rideType).toBeNull();
        expect(windowAt(TUE, '23:00').rideType).toBeNull();
    });

    it('follows the times a manager sets, not hardcoded ones', () => {
        // Sabha moved to 4:30–6:00 PM. Drop-off should open at 5:45, and 7 PM —
        // which used to be the hardcoded pickup cutoff — is now drop-off.
        expect(windowAt(FRI, '16:00', '16:30', '18:00').rideType).toBe('home-to-sabha');
        expect(windowAt(FRI, '17:00', '16:30', '18:00').rideType).toBeNull();
        expect(windowAt(FRI, '17:45', '16:30', '18:00').rideType).toBe('sabha-to-home');
        expect(windowAt(FRI, '19:00', '16:30', '18:00').rideType).toBe('sabha-to-home');
    });

    it('falls back to the defaults when settings are missing or junk', () => {
        // Throwing here would mean "no rides at all", which strands people.
        expect(resolveScheduleWindow(boston(FRI, '18:00'), ZONE, undefined, undefined).rideType)
            .toBe('home-to-sabha');
        expect(resolveScheduleWindow(boston(FRI, '23:00'), ZONE, 'half seven', 'ten').rideType)
            .toBe('sabha-to-home');
        expect(parseTimeToMinutes(DEFAULT_SABHA_START)).toBe(19 * 60);
        expect(parseTimeToMinutes(DEFAULT_SABHA_END)).toBe(22 * 60);
    });

    it('survives an end time at or before the start', () => {
        // A manager typo must not open drop-off before pickup closes.
        const during = windowAt(FRI, '19:30', '19:00', '19:00');
        expect(during.rideType).toBeNull();

        const after = windowAt(FRI, '20:00', '19:00', '19:00');
        expect(after.rideType).toBe('sabha-to-home');
    });

    it('reads Boston time, not the UTC server clock', () => {
        // Fri 10:30 PM Boston is Sat 02:30 UTC. Read as UTC this is "not Friday"
        // and drop-off closes every week — the Stage 0 bug.
        expect(windowAt(FRI, '22:30').rideType).toBe('sabha-to-home');

        // Wed 00:30 Boston is Wed 04:30 UTC — still Wednesday either way, but
        // Tue 20:30 Boston is Wed 00:30 UTC and must stay closed.
        expect(windowAt(TUE, '20:30').rideType).toBeNull();
    });
});
