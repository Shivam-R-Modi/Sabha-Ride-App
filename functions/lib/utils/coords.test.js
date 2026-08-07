"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const coords_1 = require("./coords");
(0, vitest_1.describe)('resolveHomeCoords', () => {
    (0, vitest_1.it)('reads the shape ProfileSetup actually writes', () => {
        // components/auth/ProfileSetup.tsx:65-67 writes location.latitude/longitude,
        // and createRideRequest reads it back the same way. This is the shape that
        // real production profiles have.
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { latitude: 42.3399, longitude: -71.0881 } }))
            .toEqual({ lat: 42.3399, lng: -71.0881 });
    });
    (0, vitest_1.it)('reads the lat/lng shape the assignment functions use', () => {
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { lat: 42.3399, lng: -71.0881 } }))
            .toEqual({ lat: 42.3399, lng: -71.0881 });
    });
    (0, vitest_1.it)('falls back to homeLocation, in both spellings', () => {
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ homeLocation: { lat: 1, lng: 2 } })).toEqual({ lat: 1, lng: 2 });
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ homeLocation: { latitude: 3, longitude: 4 } })).toEqual({ lat: 3, lng: 4 });
    });
    (0, vitest_1.it)('prefers location over homeLocation when both are present', () => {
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({
            location: { latitude: 42, longitude: -71 },
            homeLocation: { lat: 1, lng: 2 },
        })).toEqual({ lat: 42, lng: -71 });
    });
    (0, vitest_1.it)('rejects 0,0 — that means the address was never geocoded', () => {
        // isValidPendingRide in globalAssignDriver rejects 0,0 for the same
        // reason. Letting it through would put a rider in the Atlantic and
        // silently skew every cluster centroid.
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { latitude: 0, longitude: 0 } })).toBeNull();
    });
    (0, vitest_1.it)('keeps a genuine zero on one axis', () => {
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { latitude: 51.5, longitude: 0 } }))
            .toEqual({ lat: 51.5, lng: 0 });
    });
    (0, vitest_1.it)('returns null for missing, partial or non-numeric data', () => {
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)(undefined)).toBeNull();
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({})).toBeNull();
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: {} })).toBeNull();
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { latitude: 42 } })).toBeNull();
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { latitude: '42', longitude: '-71' } })).toBeNull();
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({ location: { latitude: NaN, longitude: 1 } })).toBeNull();
    });
    (0, vitest_1.it)('skips an unusable candidate and takes the next usable one', () => {
        (0, vitest_1.expect)((0, coords_1.resolveHomeCoords)({
            location: { latitude: 0, longitude: 0 },
            homeLocation: { lat: 42.1, lng: -71.1 },
        })).toEqual({ lat: 42.1, lng: -71.1 });
    });
});
(0, vitest_1.describe)('zonedDateKey', () => {
    (0, vitest_1.it)('uses the Sabha local date, not the UTC date', () => {
        // Fri 10:30 PM Boston is already Sat 02:30 UTC. Keying the ride off the
        // UTC date would file every drop-off under the following day.
        (0, vitest_1.expect)((0, coords_1.zonedDateKey)(new Date('2026-08-08T02:30:00Z'), 'America/New_York')).toBe('2026-08-07');
    });
    (0, vitest_1.it)('agrees with UTC when the two are on the same day', () => {
        (0, vitest_1.expect)((0, coords_1.zonedDateKey)(new Date('2026-08-07T18:00:00Z'), 'America/New_York')).toBe('2026-08-07');
    });
    (0, vitest_1.it)('formats as YYYY-MM-DD with padding', () => {
        (0, vitest_1.expect)((0, coords_1.zonedDateKey)(new Date('2026-01-09T17:00:00Z'), 'America/New_York')).toBe('2026-01-09');
    });
});
//# sourceMappingURL=coords.test.js.map