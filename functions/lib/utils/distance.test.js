"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const distance_1 = require("./distance");
(0, vitest_1.describe)('haversineDistance', () => {
    (0, vitest_1.it)('returns 0 for the same point', () => {
        const p = { lat: 42.3601, lng: -71.0589 };
        (0, vitest_1.expect)((0, distance_1.haversineDistance)(p, p)).toBe(0);
    });
    (0, vitest_1.it)('calculates known distance between Boston and New York (~306 km)', () => {
        const boston = { lat: 42.3601, lng: -71.0589 };
        const nyc = { lat: 40.7128, lng: -74.006 };
        const distance = (0, distance_1.haversineDistance)(boston, nyc);
        // Real distance ~306 km, allow 10% tolerance
        (0, vitest_1.expect)(distance).toBeGreaterThan(275);
        (0, vitest_1.expect)(distance).toBeLessThan(340);
    });
    (0, vitest_1.it)('calculates known distance between London and Paris (~344 km)', () => {
        const london = { lat: 51.5074, lng: -0.1278 };
        const paris = { lat: 48.8566, lng: 2.3522 };
        const distance = (0, distance_1.haversineDistance)(london, paris);
        (0, vitest_1.expect)(distance).toBeGreaterThan(310);
        (0, vitest_1.expect)(distance).toBeLessThan(380);
    });
    (0, vitest_1.it)('is symmetric (A→B same as B→A)', () => {
        const a = { lat: 42.3601, lng: -71.0589 };
        const b = { lat: 40.7128, lng: -74.006 };
        (0, vitest_1.expect)((0, distance_1.haversineDistance)(a, b)).toBeCloseTo((0, distance_1.haversineDistance)(b, a), 10);
    });
    (0, vitest_1.it)('returns ~20000 km for antipodal points (max ~half circumference)', () => {
        const p1 = { lat: 0, lng: 0 };
        const p2 = { lat: 0, lng: 180 };
        const distance = (0, distance_1.haversineDistance)(p1, p2);
        // Half the Earth's circumference ≈ 20015 km
        (0, vitest_1.expect)(distance).toBeGreaterThan(19500);
        (0, vitest_1.expect)(distance).toBeLessThan(20100);
    });
});
(0, vitest_1.describe)('calculateRouteDistance', () => {
    (0, vitest_1.it)('returns 0 for a single waypoint', () => {
        const route = [{ lat: 42.3601, lng: -71.0589 }];
        (0, vitest_1.expect)((0, distance_1.calculateRouteDistance)(route)).toBe(0);
    });
    (0, vitest_1.it)('returns 0 for empty waypoints', () => {
        (0, vitest_1.expect)((0, distance_1.calculateRouteDistance)([])).toBe(0);
    });
    (0, vitest_1.it)('sums distances for multiple waypoints', () => {
        const a = { lat: 42.3601, lng: -71.0589 }; // Boston
        const b = { lat: 41.7658, lng: -72.6734 }; // Hartford
        const c = { lat: 40.7128, lng: -74.006 }; // NYC
        const totalRoute = (0, distance_1.calculateRouteDistance)([a, b, c]);
        const ab = (0, distance_1.haversineDistance)(a, b);
        const bc = (0, distance_1.haversineDistance)(b, c);
        (0, vitest_1.expect)(totalRoute).toBeCloseTo(ab + bc, 10);
    });
});
(0, vitest_1.describe)('estimateTime', () => {
    (0, vitest_1.it)('returns 60 minutes for 30 km (30 km/h average)', () => {
        (0, vitest_1.expect)((0, distance_1.estimateTime)(30)).toBe(60);
    });
    (0, vitest_1.it)('returns 0 for 0 distance', () => {
        (0, vitest_1.expect)((0, distance_1.estimateTime)(0)).toBe(0);
    });
    (0, vitest_1.it)('returns 30 minutes for 15 km', () => {
        (0, vitest_1.expect)((0, distance_1.estimateTime)(15)).toBe(30);
    });
    (0, vitest_1.it)('rounds to nearest minute', () => {
        // 10 km at 30 km/h = 20 min exactly
        (0, vitest_1.expect)((0, distance_1.estimateTime)(10)).toBe(20);
        // 7 km at 30 km/h = 14 min
        (0, vitest_1.expect)((0, distance_1.estimateTime)(7)).toBe(14);
    });
});
(0, vitest_1.describe)('findNearestPoint', () => {
    (0, vitest_1.it)('returns null for empty array', () => {
        const ref = { lat: 42.36, lng: -71.06 };
        (0, vitest_1.expect)((0, distance_1.findNearestPoint)(ref, [])).toBeNull();
    });
    (0, vitest_1.it)('returns the only point when array has one element', () => {
        const ref = { lat: 42.36, lng: -71.06 };
        const only = { lat: 42.37, lng: -71.07 };
        const result = (0, distance_1.findNearestPoint)(ref, [only]);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.index).toBe(0);
        (0, vitest_1.expect)(result.point).toEqual(only);
    });
    (0, vitest_1.it)('finds the nearest point when given multiple options', () => {
        const ref = { lat: 42.36, lng: -71.06 }; // Boston-ish
        const far = { lat: 40.71, lng: -74.01 }; // NYC
        const near = { lat: 42.37, lng: -71.07 }; // 1 km away
        const medium = { lat: 42.00, lng: -71.80 }; // ~50 km
        const result = (0, distance_1.findNearestPoint)(ref, [far, near, medium]);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.index).toBe(1);
        (0, vitest_1.expect)(result.point).toEqual(near);
    });
});
//# sourceMappingURL=distance.test.js.map