import { describe, it, expect } from 'vitest';
import {
    haversineDistance,
    calculateRouteDistance,
    estimateTime,
    findNearestPoint,
} from './distance';
import { GeoLocation } from '../types';

describe('haversineDistance', () => {
    it('returns 0 for the same point', () => {
        const p: GeoLocation = { lat: 42.3601, lng: -71.0589 };
        expect(haversineDistance(p, p)).toBe(0);
    });

    it('calculates known distance between Boston and New York (~306 km)', () => {
        const boston: GeoLocation = { lat: 42.3601, lng: -71.0589 };
        const nyc: GeoLocation = { lat: 40.7128, lng: -74.006 };
        const distance = haversineDistance(boston, nyc);
        // Real distance ~306 km, allow 10% tolerance
        expect(distance).toBeGreaterThan(275);
        expect(distance).toBeLessThan(340);
    });

    it('calculates known distance between London and Paris (~344 km)', () => {
        const london: GeoLocation = { lat: 51.5074, lng: -0.1278 };
        const paris: GeoLocation = { lat: 48.8566, lng: 2.3522 };
        const distance = haversineDistance(london, paris);
        expect(distance).toBeGreaterThan(310);
        expect(distance).toBeLessThan(380);
    });

    it('is symmetric (A→B same as B→A)', () => {
        const a: GeoLocation = { lat: 42.3601, lng: -71.0589 };
        const b: GeoLocation = { lat: 40.7128, lng: -74.006 };
        expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 10);
    });

    it('returns ~20000 km for antipodal points (max ~half circumference)', () => {
        const p1: GeoLocation = { lat: 0, lng: 0 };
        const p2: GeoLocation = { lat: 0, lng: 180 };
        const distance = haversineDistance(p1, p2);
        // Half the Earth's circumference ≈ 20015 km
        expect(distance).toBeGreaterThan(19500);
        expect(distance).toBeLessThan(20100);
    });
});

describe('calculateRouteDistance', () => {
    it('returns 0 for a single waypoint', () => {
        const route: GeoLocation[] = [{ lat: 42.3601, lng: -71.0589 }];
        expect(calculateRouteDistance(route)).toBe(0);
    });

    it('returns 0 for empty waypoints', () => {
        expect(calculateRouteDistance([])).toBe(0);
    });

    it('sums distances for multiple waypoints', () => {
        const a: GeoLocation = { lat: 42.3601, lng: -71.0589 }; // Boston
        const b: GeoLocation = { lat: 41.7658, lng: -72.6734 }; // Hartford
        const c: GeoLocation = { lat: 40.7128, lng: -74.006 };  // NYC

        const totalRoute = calculateRouteDistance([a, b, c]);
        const ab = haversineDistance(a, b);
        const bc = haversineDistance(b, c);
        expect(totalRoute).toBeCloseTo(ab + bc, 10);
    });
});

describe('estimateTime', () => {
    it('returns 60 minutes for 30 km (30 km/h average)', () => {
        expect(estimateTime(30)).toBe(60);
    });

    it('returns 0 for 0 distance', () => {
        expect(estimateTime(0)).toBe(0);
    });

    it('returns 30 minutes for 15 km', () => {
        expect(estimateTime(15)).toBe(30);
    });

    it('rounds to nearest minute', () => {
        // 10 km at 30 km/h = 20 min exactly
        expect(estimateTime(10)).toBe(20);
        // 7 km at 30 km/h = 14 min
        expect(estimateTime(7)).toBe(14);
    });
});

describe('findNearestPoint', () => {
    it('returns null for empty array', () => {
        const ref: GeoLocation = { lat: 42.36, lng: -71.06 };
        expect(findNearestPoint(ref, [])).toBeNull();
    });

    it('returns the only point when array has one element', () => {
        const ref: GeoLocation = { lat: 42.36, lng: -71.06 };
        const only: GeoLocation = { lat: 42.37, lng: -71.07 };
        const result = findNearestPoint(ref, [only]);
        expect(result).not.toBeNull();
        expect(result!.index).toBe(0);
        expect(result!.point).toEqual(only);
    });

    it('finds the nearest point when given multiple options', () => {
        const ref: GeoLocation = { lat: 42.36, lng: -71.06 };     // Boston-ish
        const far: GeoLocation = { lat: 40.71, lng: -74.01 };     // NYC
        const near: GeoLocation = { lat: 42.37, lng: -71.07 };    // 1 km away
        const medium: GeoLocation = { lat: 42.00, lng: -71.80 };  // ~50 km

        const result = findNearestPoint(ref, [far, near, medium]);
        expect(result).not.toBeNull();
        expect(result!.index).toBe(1);
        expect(result!.point).toEqual(near);
    });
});
