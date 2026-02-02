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

    const waypoints: Waypoint[] = [];
    const unvisitedStudents = [...students];
    let currentLocation = startPoint;

    // Add start point
    waypoints.push({
        ...startPoint,
        name: 'Start',
        type: 'start',
        visited: false
    });

    // Visit nearest neighbor until all students are visited
    while (unvisitedStudents.length > 0) {
        let nearestIndex = 0;
        let minDistance = haversineDistance(currentLocation, unvisitedStudents[0].location);

        // Find nearest unvisited student
        for (let i = 1; i < unvisitedStudents.length; i++) {
            const distance = haversineDistance(currentLocation, unvisitedStudents[i].location);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = i;
            }
        }

        const nearestStudent = unvisitedStudents[nearestIndex];

        // Add waypoint for this student
        waypoints.push({
            ...nearestStudent.location,
            name: nearestStudent.name,
            type: rideType === 'home-to-sabha' ? 'pickup' : 'dropoff',
            studentId: nearestStudent.id,
            visited: false
        });

        // Move to this location and remove from unvisited
        currentLocation = nearestStudent.location;
        unvisitedStudents.splice(nearestIndex, 1);
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
 * Build Google Maps URL for navigation
 * Opens external Google Maps with waypoints pre-loaded
 */
export function buildGoogleMapsUrl(waypoints: Waypoint[]): string {
    if (waypoints.length < 2) return '';

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
export function isNearWaypoint(
    driverLocation: GeoLocation,
    waypoint: GeoLocation,
    thresholdMeters: number = 50
): boolean {
    const distanceKm = haversineDistance(driverLocation, waypoint);
    const distanceMeters = distanceKm * 1000;
    return distanceMeters <= thresholdMeters;
}

/**
 * Mark waypoints as visited based on driver location
 * Returns updated waypoints and whether all are visited
 */
export function updateWaypointVisits(
    waypoints: Waypoint[],
    driverLocation: GeoLocation,
    thresholdMeters: number = 50
): { waypoints: Waypoint[]; allVisited: boolean } {
    const updatedWaypoints = waypoints.map(wp => {
        if (wp.visited) return wp;

        const isNear = isNearWaypoint(driverLocation, wp, thresholdMeters);
        if (isNear) {
            return { ...wp, visited: true };
        }
        return wp;
    });

    // Check if all waypoints (except start and end) are visited
    const middleWaypoints = updatedWaypoints.slice(1, -1);
    const allVisited = middleWaypoints.length === 0 || middleWaypoints.every(wp => wp.visited);

    return { waypoints: updatedWaypoints, allVisited };
}
