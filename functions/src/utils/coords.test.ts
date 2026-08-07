import { describe, it, expect } from 'vitest';
import { resolveHomeCoords, zonedDateKey } from './coords';

describe('resolveHomeCoords', () => {
    it('reads the shape ProfileSetup actually writes', () => {
        // components/auth/ProfileSetup.tsx:65-67 writes location.latitude/longitude,
        // and createRideRequest reads it back the same way. This is the shape that
        // real production profiles have.
        expect(resolveHomeCoords({ location: { latitude: 42.3399, longitude: -71.0881 } }))
            .toEqual({ lat: 42.3399, lng: -71.0881 });
    });

    it('reads the lat/lng shape the assignment functions use', () => {
        expect(resolveHomeCoords({ location: { lat: 42.3399, lng: -71.0881 } }))
            .toEqual({ lat: 42.3399, lng: -71.0881 });
    });

    it('falls back to homeLocation, in both spellings', () => {
        expect(resolveHomeCoords({ homeLocation: { lat: 1, lng: 2 } })).toEqual({ lat: 1, lng: 2 });
        expect(resolveHomeCoords({ homeLocation: { latitude: 3, longitude: 4 } })).toEqual({ lat: 3, lng: 4 });
    });

    it('prefers location over homeLocation when both are present', () => {
        expect(resolveHomeCoords({
            location: { latitude: 42, longitude: -71 },
            homeLocation: { lat: 1, lng: 2 },
        })).toEqual({ lat: 42, lng: -71 });
    });

    it('rejects 0,0 — that means the address was never geocoded', () => {
        // isValidPendingRide in globalAssignDriver rejects 0,0 for the same
        // reason. Letting it through would put a rider in the Atlantic and
        // silently skew every cluster centroid.
        expect(resolveHomeCoords({ location: { latitude: 0, longitude: 0 } })).toBeNull();
    });

    it('keeps a genuine zero on one axis', () => {
        expect(resolveHomeCoords({ location: { latitude: 51.5, longitude: 0 } }))
            .toEqual({ lat: 51.5, lng: 0 });
    });

    it('returns null for missing, partial or non-numeric data', () => {
        expect(resolveHomeCoords(undefined)).toBeNull();
        expect(resolveHomeCoords({})).toBeNull();
        expect(resolveHomeCoords({ location: {} })).toBeNull();
        expect(resolveHomeCoords({ location: { latitude: 42 } })).toBeNull();
        expect(resolveHomeCoords({ location: { latitude: '42', longitude: '-71' } })).toBeNull();
        expect(resolveHomeCoords({ location: { latitude: NaN, longitude: 1 } })).toBeNull();
    });

    it('skips an unusable candidate and takes the next usable one', () => {
        expect(resolveHomeCoords({
            location: { latitude: 0, longitude: 0 },
            homeLocation: { lat: 42.1, lng: -71.1 },
        })).toEqual({ lat: 42.1, lng: -71.1 });
    });
});

describe('zonedDateKey', () => {
    it('uses the Sabha local date, not the UTC date', () => {
        // Fri 10:30 PM Boston is already Sat 02:30 UTC. Keying the ride off the
        // UTC date would file every drop-off under the following day.
        expect(zonedDateKey(new Date('2026-08-08T02:30:00Z'), 'America/New_York')).toBe('2026-08-07');
    });

    it('agrees with UTC when the two are on the same day', () => {
        expect(zonedDateKey(new Date('2026-08-07T18:00:00Z'), 'America/New_York')).toBe('2026-08-07');
    });

    it('formats as YYYY-MM-DD with padding', () => {
        expect(zonedDateKey(new Date('2026-01-09T17:00:00Z'), 'America/New_York')).toBe('2026-01-09');
    });
});
