// ============================================
// ROUTE OPTIMIZATION (TRAVELING SALESMAN - NEAREST NEIGHBOR)
// ============================================

import { GeoLocation, Waypoint, RideStudent } from '../types';
import { haversineDistance, calculateRouteDistance, estimateTime } from './distance';

/**
 * Route Optimization using Nearest Neighbor algorithm
 * Finds efficient order to visit all waypoints
 * 
 * @param startPoint - Starting location (driver's location for pickup, Sabha for drop-off)
 * @param students - List of students to visit
 * @param endPoint - Ending location (Sabha for pickup, driver's home for drop-off)
 * @param rideType - Type of ride (home-to-sabha or sabha-to-home)
 * @returns Optimized route with waypoints in order
 */
/**
 * Above this many stops the exact permutation search is abandoned for a
 * heuristic. 8 stops is 40,320 orderings — fine. The old code had this number
 * only in a doc comment and never enforced it, while vehicle capacity is a
 * manager-entered value up to 15 (VehicleForm.tsx). A 12-seat van meant 11
 * students, 39.9M permutations materialised into a single array, and the
 * function OOMed. On an OOM kill the caller's `finally` never runs, so
 * system/assignmentLock was left held and every driver on the platform was
 * blocked from being assigned until someone deleted the document by hand.
 */
const EXACT_TSP_MAX_STOPS = 8;

/** Total Start -> ...stops... -> End distance for a given visiting order. */
function routeLength(startPoint: GeoLocation, order: RideStudent[], endPoint: GeoLocation): number {
    if (order.length === 0) return haversineDistance(startPoint, endPoint);
    let total = haversineDistance(startPoint, order[0].location);
    for (let i = 0; i < order.length - 1; i++) {
        total += haversineDistance(order[i].location, order[i + 1].location);
    }
    return total + haversineDistance(order[order.length - 1].location, endPoint);
}

/**
 * Helper to generate all permutations of an array.
 * Only ever called with <= EXACT_TSP_MAX_STOPS elements.
 */
function getPermutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
        const remainingPerms = getPermutations(remaining);
        for (const perm of remainingPerms) {
            result.push([current, ...perm]);
        }
    }
    return result;
}

/** Exhaustive search. Exact, and safe at <= 8 stops. */
function exactShortestOrder(
    startPoint: GeoLocation, students: RideStudent[], endPoint: GeoLocation
): RideStudent[] {
    let bestOrder = students;
    let minTotalDistance = Infinity;
    for (const perm of getPermutations(students)) {
        const d = routeLength(startPoint, perm, endPoint);
        if (d < minTotalDistance) {
            minTotalDistance = d;
            bestOrder = perm;
        }
    }
    return bestOrder;
}

/**
 * Nearest-neighbour seed followed by 2-opt improvement. O(n^2) to build and
 * O(n^2) per improvement pass instead of O(n!), and in practice lands within a
 * few percent of optimal at these sizes.
 */
function nearestNeighbourThenTwoOpt(
    startPoint: GeoLocation, students: RideStudent[], endPoint: GeoLocation
): RideStudent[] {
    const remaining = [...students];
    const order: RideStudent[] = [];
    let cursor: GeoLocation = startPoint;

    while (remaining.length > 0) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const d = haversineDistance(cursor, remaining[i].location);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        const [next] = remaining.splice(bestIdx, 1);
        order.push(next);
        cursor = next.location;
    }

    // 2-opt: repeatedly reverse a segment when doing so shortens the whole route.
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
        improved = false;
        let best = routeLength(startPoint, order, endPoint);
        for (let i = 0; i < order.length - 1; i++) {
            for (let k = i + 1; k < order.length; k++) {
                const candidate = [
                    ...order.slice(0, i),
                    ...order.slice(i, k + 1).reverse(),
                    ...order.slice(k + 1),
                ];
                const d = routeLength(startPoint, candidate, endPoint);
                if (d < best - 1e-9) {
                    order.splice(0, order.length, ...candidate);
                    best = d;
                    improved = true;
                }
            }
        }
    }

    return order;
}

/**
 * Route Optimization using Exact TSP Permutations (for N <= 8 students)
 * Evaluates the TOTAL cumulative distance of every possible visiting order
 * from Start -> Students -> End (Sabha), guaranteeing the ABSOLUTE SHORTEST total route.
 * 
 * @param startPoint - Starting location (driver's location for pickup, Sabha for drop-off)
 * @param students - List of students to visit
 * @param endPoint - Ending location (Sabha for pickup, driver's home for drop-off)
 * @param rideType - Type of ride (home-to-sabha or sabha-to-home)
 * @returns Optimized route with waypoints in order of absolute minimum distance
 */
export function optimizeRoute(
    startPoint: GeoLocation,
    students: RideStudent[],
    endPoint: GeoLocation,
    rideType: 'home-to-sabha' | 'sabha-to-home'
): Waypoint[] {
    if (students.length === 0) {
        return [
            { ...startPoint, name: 'Start', type: 'start', visited: false },
            { ...endPoint, name: 'End', type: 'end', visited: false }
        ];
    }

    const bestOrder = students.length <= EXACT_TSP_MAX_STOPS
        ? exactShortestOrder(startPoint, students, endPoint)
        : nearestNeighbourThenTwoOpt(startPoint, students, endPoint);

    const waypoints: Waypoint[] = [];

    // Add start point
    waypoints.push({
        ...startPoint,
        name: 'Start',
        type: 'start',
        visited: false
    });

    // Add student waypoints in exact minimum distance order
    for (const student of bestOrder) {
        waypoints.push({
            ...student.location,
            name: student.name,
            type: rideType === 'home-to-sabha' ? 'pickup' : 'dropoff',
            studentId: student.id,
            visited: false
        });
    }

    // Add end point
    waypoints.push({
        ...endPoint,
        name: 'End',
        type: 'end',
        visited: false
    });

    return waypoints;
}

/**
 * Calculate route statistics
 */
export function calculateRouteStats(waypoints: Waypoint[]): {
    distance: number;
    time: number;
} {
    const locations = waypoints.map(wp => ({
        lat: wp.lat,
        lng: wp.lng
    }));

    const distance = calculateRouteDistance(locations);
    const time = estimateTime(distance);

    return { distance, time };
}

/**
 * Build the driver's navigation URL from a persisted `route`.
 *
 * Deliberately omits `origin`. The Maps URL API routes from the device's live
 * location when origin is absent, which is what a driver about to set off
 * actually wants — and it is strictly better than the single GPS fix the client
 * used to take before opening the URL. That fix cost a permission prompt and an
 * async hop, and the async hop spent the user activation, so iOS Safari and
 * Chrome Android blocked the resulting window.open outright.
 *
 * Destination is the route's `end` waypoint, so a drop-off run ends at the
 * driver's home rather than the venue they are already standing in.
 *
 * Returns '' when the route cannot produce a usable URL. Callers must surface
 * that rather than no-op: an empty string here used to mean a dead button with
 * nothing logged anywhere.
 */
export function buildGoogleMapsNavigationUrl(route: Waypoint[]): string {
    if (route.length < 2) return '';

    const usable = (wp: { lat: number; lng: number }) =>
        Number.isFinite(wp.lat) && Number.isFinite(wp.lng);

    const end = route[route.length - 1];
    if (!usable(end)) return '';

    // Only the student stops become waypoints. `start` is where the driver is
    // (that's the omitted origin) and `end` is the destination.
    // Note: the Maps URL API accepts at most 9 waypoints. Vehicle capacity is
    // manager-entered and can reach 15, so a very large van could exceed it.
    const stops = route
        .filter(wp => wp.type === 'pickup' || wp.type === 'dropoff')
        .filter(usable);

    const waypointsParam = stops.length > 0
        ? `&waypoints=${encodeURIComponent(stops.map(wp => `${wp.lat},${wp.lng}`).join('|'))}`
        : '';

    return `https://www.google.com/maps/dir/?api=1` +
        `&destination=${end.lat},${end.lng}` +
        `${waypointsParam}` +
        `&travelmode=driving`;
}
