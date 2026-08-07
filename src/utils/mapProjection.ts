/**
 * Project real coordinates onto the manager dashboard's schematic map.
 *
 * ResponsiveMap is not a tile map. It is a fixed box with the venue pinned at
 * dead centre and markers positioned by CSS percentage. It expected a
 * `coordinates: {x, y}` field on each request — and nothing has ever written
 * one. createRideRequest writes `pickupLat`/`pickupLng`.
 *
 * The read fell back to `{ x: 50, y: 50 }`, which is exactly the venue pin. So
 * every student marker on the "Live Interactive Map" sat stacked on top of the
 * Mandir, and the map looked populated while plotting nothing real.
 *
 * This converts the coordinates that ARE written into the percentages the map
 * wants, using an equirectangular projection — accurate enough over a
 * city-sized area, and this is a schematic, not a navigation aid.
 */

export interface LatLng {
    lat: number;
    lng: number;
}

export interface MapPercent {
    x: number;
    y: number;
}

/**
 * Half-width of the plotted area, in miles. Matches GEO_FENCE_MILES in
 * globalAssignDriver: a student further out than this is not assignable, so
 * there is no reason to plot further than this either.
 */
export const MAP_RADIUS_MILES = 15;

/** Keep markers off the very edge, where their label would be clipped. */
const EDGE_MARGIN_PERCENT = 4;

const MILES_PER_DEGREE_LAT = 69.0;

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const isUsable = (point: LatLng | null | undefined): point is LatLng =>
    !!point
    && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    // 0,0 is the "address never geocoded" placeholder, not the Gulf of Guinea.
    && !(point.lat === 0 && point.lng === 0);

/**
 * Where `point` sits relative to `venue`, as percentages of the map box.
 *
 * Returns null when either coordinate is unusable. Callers must drop the marker
 * rather than substitute a centre default — stacking unknown positions on the
 * venue pin is what made the map lie in the first place.
 */
export function projectToMapPercent(
    point: LatLng | null | undefined,
    venue: LatLng | null | undefined,
    radiusMiles: number = MAP_RADIUS_MILES,
): MapPercent | null {
    if (!isUsable(point) || !isUsable(venue)) return null;

    const milesPerDegreeLng = MILES_PER_DEGREE_LAT * Math.cos(venue.lat * Math.PI / 180);

    const eastMiles = (point.lng - venue.lng) * milesPerDegreeLng;
    const northMiles = (point.lat - venue.lat) * MILES_PER_DEGREE_LAT;

    // Centre is 50%; one radius out is the edge. Y is inverted because CSS top
    // grows downward while latitude grows northward.
    const x = 50 + (eastMiles / radiusMiles) * 50;
    const y = 50 - (northMiles / radiusMiles) * 50;

    return {
        x: clamp(x, EDGE_MARGIN_PERCENT, 100 - EDGE_MARGIN_PERCENT),
        y: clamp(y, EDGE_MARGIN_PERCENT, 100 - EDGE_MARGIN_PERCENT),
    };
}

/**
 * Pull usable coordinates off a user record, tolerating every shape the
 * codebase writes. Client mirror of `resolveHomeCoords` in
 * functions/src/utils/coords.ts — same shapes, same rejection of the 0,0
 * placeholder.
 */
export function resolveUserCoords(user: any): LatLng | null {
    const candidates: LatLng[] = [
        { lat: user?.location?.latitude, lng: user?.location?.longitude },
        { lat: user?.location?.lat, lng: user?.location?.lng },
        { lat: user?.homeLocation?.lat, lng: user?.homeLocation?.lng },
        { lat: user?.homeLocation?.latitude, lng: user?.homeLocation?.longitude },
    ];

    return candidates.find(isUsable) ?? null;
}
