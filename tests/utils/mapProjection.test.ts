import { describe, it, expect } from 'vitest';
import {
    projectToMapPercent, resolveUserCoords, MAP_RADIUS_MILES,
} from '../../src/utils/mapProjection';

const VENUE = { lat: 42.339925, lng: -71.088182 };

describe('projectToMapPercent', () => {
    it('puts the venue itself dead centre', () => {
        expect(projectToMapPercent(VENUE, VENUE)).toEqual({ x: 50, y: 50 });
    });

    it('puts a point north of the venue above centre, not below', () => {
        // CSS `top` grows downward while latitude grows northward, so the y axis
        // has to be inverted. Getting this backwards mirrors the whole map.
        const north = projectToMapPercent({ lat: VENUE.lat + 0.05, lng: VENUE.lng }, VENUE)!;

        expect(north.y).toBeLessThan(50);
        expect(north.x).toBeCloseTo(50, 5);
    });

    it('puts a point east of the venue right of centre', () => {
        const east = projectToMapPercent({ lat: VENUE.lat, lng: VENUE.lng + 0.05 }, VENUE)!;

        expect(east.x).toBeGreaterThan(50);
        expect(east.y).toBeCloseTo(50, 5);
    });

    it('gives two different addresses two different positions', () => {
        // The actual bug: every marker read a `coordinates` field nothing writes
        // and defaulted to { x: 50, y: 50 }, so the whole cohort stacked on the
        // venue pin and the map plotted nothing real.
        const a = projectToMapPercent({ lat: 42.36, lng: -71.06 }, VENUE)!;
        const b = projectToMapPercent({ lat: 42.31, lng: -71.12 }, VENUE)!;

        expect(a).not.toEqual(b);
        expect(a).not.toEqual({ x: 50, y: 50 });
        expect(b).not.toEqual({ x: 50, y: 50 });
    });

    it('keeps a far-away point inside the box', () => {
        const farAway = projectToMapPercent({ lat: 33.75, lng: -84.39 }, VENUE)!;

        expect(farAway.x).toBeGreaterThanOrEqual(0);
        expect(farAway.x).toBeLessThanOrEqual(100);
        expect(farAway.y).toBeGreaterThanOrEqual(0);
        expect(farAway.y).toBeLessThanOrEqual(100);
    });

    it('places a point one radius east at the right-hand edge', () => {
        const milesPerDegreeLng = 69 * Math.cos(VENUE.lat * Math.PI / 180);
        const oneRadiusEast = {
            lat: VENUE.lat,
            lng: VENUE.lng + MAP_RADIUS_MILES / milesPerDegreeLng,
        };

        expect(projectToMapPercent(oneRadiusEast, VENUE)!.x).toBeGreaterThan(90);
    });

    it('returns null rather than defaulting to the centre', () => {
        // Returning { x: 50, y: 50 } for an unknown position is what made an
        // empty map look full. Callers drop the marker and say how many.
        expect(projectToMapPercent(null, VENUE)).toBeNull();
        expect(projectToMapPercent(undefined, VENUE)).toBeNull();
        expect(projectToMapPercent({ lat: NaN, lng: NaN }, VENUE)).toBeNull();
        expect(projectToMapPercent(VENUE, null)).toBeNull();
    });

    it('treats 0,0 as "never geocoded", not as a place', () => {
        expect(projectToMapPercent({ lat: 0, lng: 0 }, VENUE)).toBeNull();
    });
});

describe('resolveUserCoords', () => {
    it('reads the {latitude, longitude} shape ProfileSetup writes', () => {
        expect(resolveUserCoords({ location: { latitude: 42.36, longitude: -71.06 } }))
            .toEqual({ lat: 42.36, lng: -71.06 });
    });

    it('reads the {lat, lng} shape the assignment functions use', () => {
        expect(resolveUserCoords({ location: { lat: 42.36, lng: -71.06 } }))
            .toEqual({ lat: 42.36, lng: -71.06 });
    });

    it('falls back to homeLocation for drivers', () => {
        expect(resolveUserCoords({ homeLocation: { lat: 42.36, lng: -71.06 } }))
            .toEqual({ lat: 42.36, lng: -71.06 });
    });

    it('returns null for a user with no usable address', () => {
        expect(resolveUserCoords({})).toBeNull();
        expect(resolveUserCoords({ location: { latitude: 0, longitude: 0 } })).toBeNull();
    });
});
