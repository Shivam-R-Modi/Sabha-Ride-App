import { describe, it, expect } from 'vitest';
import { optimizeRoute, buildGoogleMapsNavigationUrl } from './routing';
import type { RideStudent, GeoLocation, Waypoint } from '../types';

const at = (lat: number, lng: number, id: string): RideStudent => ({
    id, name: id, phone: '', picked: false,
    location: { lat, lng, address: id } as GeoLocation,
});

const SABHA: GeoLocation = { lat: 42.3399, lng: -71.0881, address: 'Sabha' } as GeoLocation;
const DRIVER: GeoLocation = { lat: 42.3600, lng: -71.0600, address: 'Driver' } as GeoLocation;

const totalDistance = (wps: { lat: number; lng: number }[]) => {
    let d = 0;
    for (let i = 0; i < wps.length - 1; i++) {
        d += Math.hypot(wps[i].lat - wps[i + 1].lat, wps[i].lng - wps[i + 1].lng);
    }
    return d;
};

describe('optimizeRoute', () => {
    it('returns just start and end for no students', () => {
        const r = optimizeRoute(DRIVER, [], SABHA, 'home-to-sabha');
        expect(r.map(w => w.type)).toEqual(['start', 'end']);
    });

    it('visits every student exactly once', () => {
        const students = [at(42.35, -71.07, 'a'), at(42.37, -71.05, 'b'), at(42.33, -71.10, 'c')];
        const stops = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha')
            .filter(w => w.type !== 'start' && w.type !== 'end');
        expect(stops).toHaveLength(3);
        expect(new Set(stops.map(s => s.name)).size).toBe(3);
    });

    it('finds the exact shortest order for a small collinear case', () => {
        // Driver north-east, Sabha south-west, three stops strictly in between.
        // The optimal visiting order is nearest-to-driver first.
        const students = [at(42.335, -71.085, 'far'), at(42.355, -71.065, 'near'), at(42.345, -71.075, 'mid')];
        const stops = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha')
            .filter(w => w.type !== 'start' && w.type !== 'end');
        expect(stops.map(s => s.name)).toEqual(['near', 'mid', 'far']);
    });

    it('does NOT hang or OOM at 14 stops', () => {
        // This is the regression. 14 stops is 14! ~= 87 billion orderings; the
        // old code materialised every one of them into a single array and the
        // function died. On an OOM kill the caller's finally never ran, leaving
        // system/assignmentLock held and blocking assignment platform-wide.
        const students = Array.from({ length: 14 }, (_, i) =>
            at(42.30 + i * 0.005, -71.12 + i * 0.004, `s${i}`));

        const started = Date.now();
        const route = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha');
        const elapsed = Date.now() - started;

        const stops = route.filter(w => w.type !== 'start' && w.type !== 'end');
        expect(stops).toHaveLength(14);
        expect(new Set(stops.map(s => s.name)).size).toBe(14);
        expect(elapsed).toBeLessThan(2000);
    });

    it('produces a sane route at 14 stops, not just any route', () => {
        // Stops laid out along a line. A good heuristic should not zig-zag, so
        // the result should be far shorter than the deliberately-bad reversal.
        const students = Array.from({ length: 14 }, (_, i) =>
            at(42.30 + i * 0.005, -71.12 + i * 0.004, `s${i}`));

        const optimised = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha')
            .filter(w => w.type !== 'start' && w.type !== 'end');

        // Compare against a pathological alternating order.
        const zigzag: typeof students = [];
        for (let i = 0; i < 7; i++) { zigzag.push(students[i], students[13 - i]); }

        expect(totalDistance(optimised)).toBeLessThan(totalDistance(zigzag.map(s => s.location)));
    });

    it('starts at Sabha for a drop-off ride', () => {
        const students = [at(42.35, -71.07, 'a'), at(42.37, -71.05, 'b')];
        const route = optimizeRoute(SABHA, students, DRIVER, 'sabha-to-home');
        expect(route[0].type).toBe('start');
        expect(route[route.length - 1].type).toBe('end');
    });
});

describe('buildGoogleMapsNavigationUrl', () => {
    const students = [at(42.35, -71.07, 'a'), at(42.37, -71.05, 'b')];

    it('sends a drop-off run to the driver\'s home, not back to the venue', () => {
        // The reported bug: rideType appeared nowhere in the URL block and the
        // destination was hardcoded to the venue, so a sabha-to-home run
        // navigated the driver to the hall they were already standing in.
        const route = optimizeRoute(SABHA, students, DRIVER, 'sabha-to-home');
        const url = new URL(buildGoogleMapsNavigationUrl(route));

        expect(url.searchParams.get('destination')).toBe(`${DRIVER.lat},${DRIVER.lng}`);
        expect(url.searchParams.get('destination')).not.toBe(`${SABHA.lat},${SABHA.lng}`);
    });

    it('sends a pickup run to the venue', () => {
        const route = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha');
        const url = new URL(buildGoogleMapsNavigationUrl(route));

        expect(url.searchParams.get('destination')).toBe(`${SABHA.lat},${SABHA.lng}`);
    });

    it('omits origin so Maps routes from the device\'s live location', () => {
        const route = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha');
        const url = new URL(buildGoogleMapsNavigationUrl(route));

        expect(url.searchParams.has('origin')).toBe(false);
    });

    it('carries every student stop, in route order', () => {
        const route = optimizeRoute(DRIVER, students, SABHA, 'home-to-sabha');
        const url = new URL(buildGoogleMapsNavigationUrl(route));

        const expected = route
            .filter(w => w.type === 'pickup' || w.type === 'dropoff')
            .map(w => `${w.lat},${w.lng}`)
            .join('|');

        expect(url.searchParams.get('waypoints')).toBe(expected);
    });

    it('rebuilds a usable URL from a route with no students', () => {
        const route = optimizeRoute(DRIVER, [], SABHA, 'home-to-sabha');
        const url = new URL(buildGoogleMapsNavigationUrl(route));

        expect(url.searchParams.get('destination')).toBe(`${SABHA.lat},${SABHA.lng}`);
        expect(url.searchParams.has('waypoints')).toBe(false);
    });

    it('returns empty rather than a NaN destination when the end point is unusable', () => {
        // homeLocation read raw used to yield `.lat === undefined`, which
        // stringified into `destination=undefined,undefined` and opened Maps on
        // a nonsense query. Refusing is better; the caller disables the button.
        const route = [
            { lat: 42.35, lng: -71.07, name: 'Start', type: 'start', visited: false },
            { lat: NaN, lng: NaN, name: 'End', type: 'end', visited: false },
        ] as Waypoint[];

        expect(buildGoogleMapsNavigationUrl(route)).toBe('');
    });

    it('returns empty for a degenerate route', () => {
        expect(buildGoogleMapsNavigationUrl([])).toBe('');
        expect(buildGoogleMapsNavigationUrl([
            { lat: 42.35, lng: -71.07, name: 'Start', type: 'start', visited: false },
        ] as Waypoint[])).toBe('');
    });
});
