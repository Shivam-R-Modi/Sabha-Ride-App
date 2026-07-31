"use strict";
// ============================================
// ROUTE OPTIMIZATION (TRAVELING SALESMAN - NEAREST NEIGHBOR)
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.optimizeRoute = optimizeRoute;
exports.calculateRouteStats = calculateRouteStats;
exports.buildGoogleMapsUrl = buildGoogleMapsUrl;
exports.isNearWaypoint = isNearWaypoint;
exports.updateWaypointVisits = updateWaypointVisits;
const distance_1 = require("./distance");
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
 * Helper to generate all permutations of an array
 */
function getPermutations(arr) {
    if (arr.length <= 1)
        return [arr];
    const result = [];
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
function optimizeRoute(startPoint, students, endPoint, rideType) {
    if (students.length === 0) {
        return [
            Object.assign(Object.assign({}, startPoint), { name: 'Start', type: 'start', visited: false }),
            Object.assign(Object.assign({}, endPoint), { name: 'End', type: 'end', visited: false })
        ];
    }
    // Generate all permutations of student visits
    const permutations = getPermutations(students);
    let bestOrder = students;
    let minTotalDistance = Infinity;
    // Find permutation that yields min total distance from Start -> ...students... -> End
    for (const perm of permutations) {
        let currentDist = (0, distance_1.haversineDistance)(startPoint, perm[0].location);
        for (let i = 0; i < perm.length - 1; i++) {
            currentDist += (0, distance_1.haversineDistance)(perm[i].location, perm[i + 1].location);
        }
        currentDist += (0, distance_1.haversineDistance)(perm[perm.length - 1].location, endPoint);
        if (currentDist < minTotalDistance) {
            minTotalDistance = currentDist;
            bestOrder = perm;
        }
    }
    const waypoints = [];
    // Add start point
    waypoints.push(Object.assign(Object.assign({}, startPoint), { name: 'Start', type: 'start', visited: false }));
    // Add student waypoints in exact minimum distance order
    for (const student of bestOrder) {
        waypoints.push(Object.assign(Object.assign({}, student.location), { name: student.name, type: rideType === 'home-to-sabha' ? 'pickup' : 'dropoff', studentId: student.id, visited: false }));
    }
    // Add end point
    waypoints.push(Object.assign(Object.assign({}, endPoint), { name: 'End', type: 'end', visited: false }));
    return waypoints;
}
/**
 * Calculate route statistics
 */
function calculateRouteStats(waypoints) {
    const locations = waypoints.map(wp => ({
        lat: wp.lat,
        lng: wp.lng
    }));
    const distance = (0, distance_1.calculateRouteDistance)(locations);
    const time = (0, distance_1.estimateTime)(distance);
    return { distance, time };
}
/**
 * Build Google Maps URL for navigation
 * Opens external Google Maps with waypoints pre-loaded
 */
function buildGoogleMapsUrl(waypoints) {
    if (waypoints.length < 2)
        return '';
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    // Middle waypoints (if any)
    const middleWaypoints = waypoints.slice(1, -1);
    let waypointsParam = '';
    if (middleWaypoints.length > 0) {
        const waypointStr = middleWaypoints
            .map(wp => `${wp.lat},${wp.lng}`)
            .join('|');
        waypointsParam = `&waypoints=${encodeURIComponent(waypointStr)}`;
    }
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;
}
/**
 * Check if driver is within proximity of a waypoint
 * Used for automatic waypoint visit detection
 */
function isNearWaypoint(driverLocation, waypoint, thresholdMeters = 50) {
    const distanceKm = (0, distance_1.haversineDistance)(driverLocation, waypoint);
    const distanceMeters = distanceKm * 1000;
    return distanceMeters <= thresholdMeters;
}
/**
 * Mark waypoints as visited based on driver location
 * Returns updated waypoints and whether all are visited
 */
function updateWaypointVisits(waypoints, driverLocation, thresholdMeters = 50) {
    const updatedWaypoints = waypoints.map(wp => {
        if (wp.visited)
            return wp;
        const isNear = isNearWaypoint(driverLocation, wp, thresholdMeters);
        if (isNear) {
            return Object.assign(Object.assign({}, wp), { visited: true });
        }
        return wp;
    });
    // Check if all waypoints (except start and end) are visited
    const middleWaypoints = updatedWaypoints.slice(1, -1);
    const allVisited = middleWaypoints.length === 0 || middleWaypoints.every(wp => wp.visited);
    return { waypoints: updatedWaypoints, allVisited };
}
//# sourceMappingURL=routing.js.map