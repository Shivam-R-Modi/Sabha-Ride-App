import { describe, it, expect } from 'vitest';
import { getZonedParts, minutesSinceMidnight, isValidTimeZone, DEFAULT_TIME_ZONE } from './time';

const at = (iso: string) => new Date(iso);

describe('getZonedParts', () => {
    it('reads Boston local time, not the UTC server clock', () => {
        // Fri 6:00 PM Boston is already Fri 22:00 UTC. The UTC reading made the
        // scheduler think Sabha was over and switch to drop-off rides.
        expect(getZonedParts(at('2026-08-07T22:00:00Z'))).toEqual({ dayOfWeek: 5, hour: 18, minute: 0 });
    });

    it('does not roll the day over early in the evening', () => {
        // Fri 10:30 PM Boston is Sat 02:30 UTC. Reading the UTC day made this
        // "not Friday", which closed drop-off rides for the entire night.
        expect(getZonedParts(at('2026-08-08T02:30:00Z'))).toEqual({ dayOfWeek: 5, hour: 22, minute: 30 });
    });

    it('handles the whole Friday evening as one local day', () => {
        const evening = ['2026-08-07T19:00:00Z', '2026-08-07T23:00:00Z', '2026-08-08T03:30:00Z'];
        for (const iso of evening) {
            expect(getZonedParts(at(iso)).dayOfWeek).toBe(5);
        }
    });

    it('applies EDT in summer (UTC-4)', () => {
        expect(getZonedParts(at('2026-07-10T16:00:00Z')).hour).toBe(12);
    });

    it('applies EST in winter (UTC-5)', () => {
        expect(getZonedParts(at('2026-01-09T16:00:00Z')).hour).toBe(11);
    });

    it('follows the spring-forward transition', () => {
        // 2026-03-08 02:00 local: clocks jump 2am -> 3am.
        expect(getZonedParts(at('2026-03-08T06:30:00Z')).hour).toBe(1);  // still EST
        expect(getZonedParts(at('2026-03-08T07:30:00Z')).hour).toBe(3);  // now EDT
    });

    it('follows the fall-back transition', () => {
        // 2026-11-01 02:00 local: clocks repeat 1am.
        expect(getZonedParts(at('2026-11-01T05:30:00Z')).hour).toBe(1);  // first pass, EDT
        expect(getZonedParts(at('2026-11-01T06:30:00Z')).hour).toBe(1);  // second pass, EST
    });

    it('reports midnight as hour 0, never 24', () => {
        expect(getZonedParts(at('2026-08-08T04:00:00Z')).hour).toBe(0);
    });

    it('supports other zones explicitly', () => {
        expect(getZonedParts(at('2026-08-07T22:00:00Z'), 'UTC').hour).toBe(22);
        expect(getZonedParts(at('2026-08-07T22:00:00Z'), 'Asia/Kolkata')).toEqual({
            dayOfWeek: 6, hour: 3, minute: 30,
        });
    });

    it('falls back to the default zone instead of throwing on a bad identifier', () => {
        // A scheduled job that throws here would publish "no rides available"
        // and strand people, so an unusable zone must degrade, not fail.
        expect(getZonedParts(at('2026-08-07T22:00:00Z'), 'Not/AZone')).toEqual(
            getZonedParts(at('2026-08-07T22:00:00Z'), DEFAULT_TIME_ZONE),
        );
    });
});

describe('isValidTimeZone', () => {
    it('accepts IANA identifiers and rejects junk', () => {
        expect(isValidTimeZone('America/New_York')).toBe(true);
        expect(isValidTimeZone('UTC')).toBe(true);
        expect(isValidTimeZone('America/Nowhere')).toBe(false);
        expect(isValidTimeZone('EST5EDT4')).toBe(false);
    });
});

describe('minutesSinceMidnight', () => {
    it('counts from local midnight', () => {
        expect(minutesSinceMidnight(at('2026-08-08T02:30:00Z'))).toBe(22 * 60 + 30);
    });
});
