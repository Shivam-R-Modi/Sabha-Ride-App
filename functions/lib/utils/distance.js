"use strict";
// ============================================
// DISTANCE CALCULATION UTILITIES
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.haversineDistance = haversineDistance;
exports.calculateRouteDistance = calculateRouteDistance;
exports.estimateTime = estimateTime;
exports.findNearestPoint = findNearestPoint;
/**
 * Calculate distance between two points using Haversine formula
 * Accounts for Earth's curvature
 * @returns Distance in kilometers
 */
function haversineDistance(point1, point2) {
    const R = 6371; // Earth's radius in kilometers
    const lat1Rad = toRadians(point1.lat);
    const lat2Rad = toRadians(point2.lat);
    const deltaLat = toRadians(point2.lat - point1.lat);
    const deltaLng = toRadians(point2.lng - point1.lng);
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}
/**
 * Calculate total distance for a route (array of waypoints)
 */
function calculateRouteDistance(waypoints) {
    let totalDistance = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        totalDistance += haversineDistance(waypoints[i], waypoints[i + 1]);
    }
    return totalDistance;
}
/**
 * Estimate time based on distance
 * Assumes average city speed of 30 km/h
 * @param distanceKm Distance in kilometers
 * @returns Time in minutes
 */
function estimateTime(distanceKm) {
    const averageSpeedKmh = 30; // km/h in city traffic
    const timeHours = distanceKm / averageSpeedKmh;
    return Math.round(timeHours * 60); // Convert to minutes
}
/**
 * Find the nearest point from a reference point
 */
function findNearestPoint(reference, points) {
    if (points.length === 0)
        return null;
    let nearest = { point: points[0], index: 0, distance: haversineDistance(reference, points[0]) };
    for (let i = 1; i < points.length; i++) {
        const distance = haversineDistance(reference, points[i]);
        if (distance < nearest.distance) {
            nearest = { point: points[i], index: i, distance };
        }
    }
    return nearest;
}
//# sourceMappingURL=distance.js.map