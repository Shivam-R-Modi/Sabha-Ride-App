import { describe, it, expect } from 'vitest';
import {
    resolveScheduleWindow, buildCurrentEvent, parseTimeToMinutes, formatTimeForDisplay,
    DEFAULT_SABHA_START, DEFAULT_SABHA_END, PICKUP_LEAD_DAYS,
} from './schedule';

const ZONE = 'America/New_York';

/** A Date at a given Boston wall-clock time in August 2026 (EDT, UTC-4). */
const boston = (day: string, hhmm: string) =>
    new Date(`2026-08-${day}T${hhmm}:00-04:00`);

// August 2026: 3rd = Mon, 4th = Tue, 5th = Wed, 6th = Thu, 7th = Fri, 8th = Sat
const MON = '03', TUE = '04', WED = '05', THU = '06', FRI = '07', SAT = '08';

/** The Friday-the-7th gathering, 7-10 PM, as the events collection would hold it. */
const fridayEvent = (start = '19:00', end = '22:00') =>
    buildCurrentEvent('2026-08-07', start, end, ZONE);

const windowAt = (day: string, hhmm: string, start = '19:00', end = '22:00') =>
    resolveScheduleWindow(boston(day, hhmm), fridayEvent(start, end), ZONE);

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

describe('buildCurrentEvent', () => {
    it('publishes absolute instants for the gathering', () => {
        const event = fridayEvent();
        expect(event.eventId).toBe('2026-08-07');
        expect(event.startsAt).toBe('2026-08-07T23:00:00.000Z');        // 7 PM EDT
        expect(event.endsAt).toBe('2026-08-08T02:00:00.000Z');          // 10 PM EDT
        expect(event.dropoffOpensAt).toBe('2026-08-08T01:45:00.000Z');  // 9:45 PM
    });

    it('opens requests PICKUP_LEAD_DAYS before, at local midnight', () => {
        // Two days before Friday the 7th is Wednesday the 5th — the same
        // behaviour as the old hardcoded "Wednesday", but now it moves with the
        // date instead of being a fixed weekday.
        expect(PICKUP_LEAD_DAYS).toBe(2);
        expect(fridayEvent().requestsOpenAt).toBe('2026-08-05T04:00:00.000Z'); // Wed 00:00 EDT
    });

    it('closes at the end of the gathering\'s own day', () => {
        // Not at the end of sabha — late drop-off runs are still going.
        expect(fridayEvent().closesAt).toBe('2026-08-08T04:00:00.000Z'); // Sat 00:00 EDT
    });

    it('locks attendance at 6 PM the day before', () => {
        expect(fridayEvent().attendanceLocksAt).toBe('2026-08-06T22:00:00.000Z');
    });

    it('follows the times given, not hardcoded ones', () => {
        const event = fridayEvent('16:30', '18:00');
        expect(event.startsAt).toBe('2026-08-07T20:30:00.000Z');       // 4:30 PM EDT
        expect(event.dropoffOpensAt).toBe('2026-08-07T21:45:00.000Z'); // 5:45 PM EDT
    });

    it('works for a gathering on any day, not just Friday', () => {
        // The whole point of the change. A Tuesday sabha resolves normally.
        const tuesday = buildCurrentEvent('2026-08-11', '18:00', '20:00', ZONE);
        expect(tuesday.eventId).toBe('2026-08-11');
        expect(tuesday.startsAt).toBe('2026-08-11T22:00:00.000Z');
        expect(tuesday.requestsOpenAt).toBe('2026-08-09T04:00:00.000Z'); // Sun 9th 00:00
    });

    it('converts correctly in winter, when the offset changes', () => {
        const winter = buildCurrentEvent('2026-01-09', '19:00', '22:00', ZONE);
        expect(winter.startsAt).toBe('2026-01-10T00:00:00.000Z'); // 7 PM EST
    });

    it('falls back to the defaults when times are missing or junk', () => {
        const event = buildCurrentEvent('2026-08-07', undefined, 'half ten', ZONE);
        expect(event.startsAt).toBe('2026-08-07T23:00:00.000Z');
        expect(event.endsAt).toBe('2026-08-08T02:00:00.000Z');
        expect(parseTimeToMinutes(DEFAULT_SABHA_START)).toBe(19 * 60);
        expect(parseTimeToMinutes(DEFAULT_SABHA_END)).toBe(22 * 60);
    });

    it('survives an end time at or before the start', () => {
        // A manager typo must not open drop-off before pickup closes.
        const event = buildCurrentEvent('2026-08-07', '19:00', '19:00', ZONE);
        expect(new Date(event.endsAt) > new Date(event.startsAt)).toBe(true);
        expect(new Date(event.dropoffOpensAt) > new Date(event.startsAt)).toBe(true);
    });

    it('keeps drop-off after the start for a sabha shorter than the lead', () => {
        // A 10-minute sabha would put dropoffOpensAt 5 minutes BEFORE it starts.
        // The "sabha in progress" interval then vanishes and pickup flips straight
        // to drop-off the instant sabha begins — drivers sent to take people home
        // as they arrive.
        const event = buildCurrentEvent('2026-08-07', '19:00', '19:10', ZONE);

        expect(new Date(event.dropoffOpensAt) > new Date(event.startsAt)).toBe(true);
        expect(new Date(event.dropoffOpensAt) <= new Date(event.endsAt)).toBe(true);

        // And the window still moves through all three states in order.
        const at = (hhmm: string) =>
            resolveScheduleWindow(boston(FRI, hhmm), event, ZONE).rideType;
        expect(at('18:00')).toBe('home-to-sabha');
        expect(at('19:00')).toBeNull();
        expect(at('19:30')).toBe('sabha-to-home');
    });
});

describe('resolveScheduleWindow', () => {
    it('says so plainly when nothing is scheduled', () => {
        // Guessing a date here is what hid an empty calendar before.
        const closed = resolveScheduleWindow(boston(FRI, '12:00'), null, ZONE);
        expect(closed.rideType).toBeNull();
        expect(closed.timeContext).toMatch(/no sabha is scheduled/i);
    });

    it('is closed before requests open', () => {
        expect(windowAt(MON, '12:00').rideType).toBeNull();
        expect(windowAt(TUE, '23:00').rideType).toBeNull();
    });

    it('opens requests two days before, and keeps them open', () => {
        expect(windowAt(WED, '00:01').rideType).toBe('home-to-sabha');
        expect(windowAt(WED, '14:00').rideType).toBe('home-to-sabha');
        expect(windowAt(THU, '09:00').rideType).toBe('home-to-sabha');
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

    it('closes after the gathering\'s day is over', () => {
        expect(windowAt(SAT, '00:10').rideType).toBeNull();
        expect(windowAt(SAT, '12:00').rideType).toBeNull();
    });

    it('follows the times set, not hardcoded ones', () => {
        // Sabha moved to 4:30–6:00 PM. 7 PM — the old hardcoded pickup cutoff —
        // is now drop-off.
        expect(windowAt(FRI, '16:00', '16:30', '18:00').rideType).toBe('home-to-sabha');
        expect(windowAt(FRI, '17:00', '16:30', '18:00').rideType).toBeNull();
        expect(windowAt(FRI, '17:45', '16:30', '18:00').rideType).toBe('sabha-to-home');
        expect(windowAt(FRI, '19:00', '16:30', '18:00').rideType).toBe('sabha-to-home');
    });

    it('reads Boston time, not the UTC server clock', () => {
        // Fri 10:30 PM Boston is Sat 02:30 UTC. Read as UTC this is "not Friday"
        // and drop-off closed every week — the Stage 0 bug.
        expect(windowAt(FRI, '22:30').rideType).toBe('sabha-to-home');
    });

    it('works for a gathering on a day that is not Friday', () => {
        const tuesday = buildCurrentEvent('2026-08-11', '18:00', '20:00', ZONE);
        const at = (day: string, hhmm: string) =>
            resolveScheduleWindow(boston(day, hhmm), tuesday, ZONE);

        expect(at('09', '10:00').rideType).toBe('home-to-sabha'); // Sun, 2 days before
        expect(at('11', '17:00').rideType).toBe('home-to-sabha'); // Tue, before start
        expect(at('11', '18:30').rideType).toBeNull();            // during
        expect(at('11', '19:45').rideType).toBe('sabha-to-home'); // 15 min before end
        expect(at('12', '01:00').rideType).toBeNull();            // Wed, closed
    });
});
