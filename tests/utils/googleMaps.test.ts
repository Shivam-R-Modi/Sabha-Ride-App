/**
 * The client copy of the navigation-URL builder exists for one reason: a ride
 * assigned before `googleMapsUrl` was persisted has only its `route`, and the
 * driver still needs to navigate. These tests cover that rehydration path and
 * pin the semantics to the server copy in
 * `functions/src/utils/routing.ts` — if the two drift, a driver gets one
 * destination in the preview and a different one after a reload.
 */

import { describe, it, expect } from 'vitest';
import { buildGoogleMapsNavigationUrl } from '../../src/utils/googleMaps';

type Waypoint = Parameters<typeof buildGoogleMapsNavigationUrl>[0][number];

const wp = (
    lat: number,
    lng: number,
    name: string,
    type: Waypoint['type'],
): Waypoint => ({ lat, lng, name, type, visited: false });

const DRIVER_HOME = { lat: 42.36, lng: -71.06 };
const SABHA = { lat: 42.339925, lng: -71.088182 };

const pickupRoute: Waypoint[] = [
    wp(DRIVER_HOME.lat, DRIVER_HOME.lng, 'Start', 'start'),
    wp(42.35, -71.07, 'Asha', 'pickup'),
    wp(42.37, -71.05, 'Bhavna', 'pickup'),
    wp(SABHA.lat, SABHA.lng, 'End', 'end'),
];

const dropoffRoute: Waypoint[] = [
    wp(SABHA.lat, SABHA.lng, 'Start', 'start'),
    wp(42.35, -71.07, 'Asha', 'dropoff'),
    wp(DRIVER_HOME.lat, DRIVER_HOME.lng, 'End', 'end'),
];

describe('buildGoogleMapsNavigationUrl', () => {
    it('rebuilds a usable URL from a persisted pickup route', () => {
        const url = new URL(buildGoogleMapsNavigationUrl(pickupRoute));

        expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
        expect(url.searchParams.get('destination')).toBe(`${SABHA.lat},${SABHA.lng}`);
        expect(url.searchParams.get('waypoints')).toBe('42.35,-71.07|42.37,-71.05');
        expect(url.searchParams.get('travelmode')).toBe('driving');
    });

    it('ends a drop-off route at the driver\'s home', () => {
        const url = new URL(buildGoogleMapsNavigationUrl(dropoffRoute));

        expect(url.searchParams.get('destination')).toBe(`${DRIVER_HOME.lat},${DRIVER_HOME.lng}`);
    });

    it('omits origin so Maps starts from the device\'s live position', () => {
        // Not cosmetic. The old client injected an origin from
        // getCurrentPosition, and that async hop spent the user activation, so
        // mobile browsers blocked the window.open that followed.
        const url = new URL(buildGoogleMapsNavigationUrl(pickupRoute));

        expect(url.searchParams.has('origin')).toBe(false);
    });

    it('never puts the start waypoint in the waypoint list', () => {
        const url = new URL(buildGoogleMapsNavigationUrl(pickupRoute));

        expect(url.searchParams.get('waypoints')).not.toContain(`${DRIVER_HOME.lat}`);
    });

    it('returns empty for a route it cannot navigate, so callers can disable the button', () => {
        expect(buildGoogleMapsNavigationUrl([])).toBe('');
        expect(buildGoogleMapsNavigationUrl([wp(42.35, -71.07, 'Start', 'start')])).toBe('');
        expect(buildGoogleMapsNavigationUrl([
            wp(42.35, -71.07, 'Start', 'start'),
            wp(NaN, NaN, 'End', 'end'),
        ])).toBe('');
    });

    it('drops an unusable stop rather than emitting NaN into the URL', () => {
        const url = buildGoogleMapsNavigationUrl([
            wp(DRIVER_HOME.lat, DRIVER_HOME.lng, 'Start', 'start'),
            wp(NaN, NaN, 'Broken', 'pickup'),
            wp(42.37, -71.05, 'Bhavna', 'pickup'),
            wp(SABHA.lat, SABHA.lng, 'End', 'end'),
        ]);

        expect(url).not.toContain('NaN');
        expect(new URL(url).searchParams.get('waypoints')).toBe('42.37,-71.05');
    });
});
