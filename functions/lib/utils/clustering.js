"use strict";
// ============================================
// K-MEANS CLUSTERING ALGORITHM
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.kMeansClustering = kMeansClustering;
exports.matchClustersToDrivers = matchClustersToDrivers;
exports.kMeansWithDriverSeeds = kMeansWithDriverSeeds;
const distance_1 = require("./distance");
/**
 * K-Means Clustering Algorithm
 * Groups students by geographic proximity
 *
 * @param students - List of students waiting for assignment
 * @param k - Number of clusters (typically number of available drivers)
 * @returns Array of clusters with students grouped by proximity
 */
function kMeansClustering(students, k) {
    if (students.length === 0 || k <= 0)
        return [];
    if (students.length <= k) {
        // Each student gets their own cluster
        return students.map(s => ({
            center: s.location,
            students: [s]
        }));
    }
    // Initialize cluster centers randomly by picking k students
    let centers = pickRandomCenters(students, k);
    let clusters = [];
    let iterations = 0;
    const maxIterations = 10;
    let converged = false;
    while (!converged && iterations < maxIterations) {
        // Assign students to nearest center
        clusters = assignToClusters(students, centers);
        // Recalculate centers
        const newCenters = recalculateCenters(clusters);
        // Check for convergence (centers don't change significantly)
        converged = hasConverged(centers, newCenters);
        centers = newCenters;
        iterations++;
    }
    return clusters;
}
/**
 * Pick k random students as initial cluster centers
 */
function pickRandomCenters(students, k) {
    const shuffled = [...students].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, k).map(s => s.location);
}
/**
 * Assign each student to the nearest cluster center
 */
function assignToClusters(students, centers) {
    // Initialize empty clusters
    const clusters = centers.map(center => ({
        center,
        students: []
    }));
    // Assign each student to nearest center
    for (const student of students) {
        let nearestIndex = 0;
        let minDistance = (0, distance_1.haversineDistance)(student.location, centers[0]);
        for (let i = 1; i < centers.length; i++) {
            const distance = (0, distance_1.haversineDistance)(student.location, centers[i]);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = i;
            }
        }
        clusters[nearestIndex].students.push(student);
    }
    return clusters;
}
/**
 * Recalculate cluster centers as the average of all points in the cluster
 */
function recalculateCenters(clusters) {
    return clusters.map(cluster => {
        if (cluster.students.length === 0) {
            return cluster.center; // Keep old center if no students
        }
        const avgLat = cluster.students.reduce((sum, s) => sum + s.location.lat, 0) / cluster.students.length;
        const avgLng = cluster.students.reduce((sum, s) => sum + s.location.lng, 0) / cluster.students.length;
        return { lat: avgLat, lng: avgLng };
    });
}
/**
 * Check if cluster centers have converged (stopped changing significantly)
 */
function hasConverged(oldCenters, newCenters) {
    const threshold = 0.001; // About 100 meters in degrees
    for (let i = 0; i < oldCenters.length; i++) {
        const latDiff = Math.abs(oldCenters[i].lat - newCenters[i].lat);
        const lngDiff = Math.abs(oldCenters[i].lng - newCenters[i].lng);
        if (latDiff > threshold || lngDiff > threshold) {
            return false;
        }
    }
    return true;
}
/**
 * Match clusters to nearest available drivers
 * Returns a map of driverId -> students assigned to them
 */
function matchClustersToDrivers(clusters, availableDrivers) {
    const assignments = new Map();
    // Create a copy of drivers to track which ones are assigned
    const unassignedDrivers = [...availableDrivers];
    const unassignedClusters = [...clusters];
    while (unassignedClusters.length > 0 && unassignedDrivers.length > 0) {
        let bestMatch = null;
        // Find the closest driver-cluster pair
        for (let d = 0; d < unassignedDrivers.length; d++) {
            const driver = unassignedDrivers[d];
            if (!driver.currentLocation)
                continue;
            for (let c = 0; c < unassignedClusters.length; c++) {
                const cluster = unassignedClusters[c];
                const distance = (0, distance_1.haversineDistance)(driver.currentLocation, cluster.center);
                if (!bestMatch || distance < bestMatch.distance) {
                    bestMatch = { driverIndex: d, clusterIndex: c, distance };
                }
            }
        }
        if (!bestMatch)
            break;
        // Assign this cluster to the driver
        const driver = unassignedDrivers[bestMatch.driverIndex];
        const cluster = unassignedClusters[bestMatch.clusterIndex];
        // Check car capacity
        const carCapacity = 4; // Default, should be fetched from car document
        const studentsToAssign = cluster.students.slice(0, carCapacity);
        assignments.set(driver.id, studentsToAssign);
        // Remove assigned driver and cluster
        unassignedDrivers.splice(bestMatch.driverIndex, 1);
        unassignedClusters.splice(bestMatch.clusterIndex, 1);
    }
    return assignments;
}
/**
 * K-Means clustering seeded by driver GPS locations.
 *
 * - Each driver's current location becomes an initial centroid.
 * - Max 20 iterations; converges when every centroid moves < 0.1 miles.
 * - Returns one cluster per driver (some may be empty).
 *
 * @param students  Lightweight student points (id + lat/lng)
 * @param drivers   Lightweight driver points (id + lat/lng)
 * @returns Array of clusters, one per driver, preserving driver order
 */
function kMeansWithDriverSeeds(students, drivers) {
    if (students.length === 0 || drivers.length === 0)
        return [];
    // K = 1: skip clustering, all students → only driver
    if (drivers.length === 1) {
        return [{
                driverId: drivers[0].id,
                centroid: { lat: drivers[0].lat, lng: drivers[0].lng },
                students: [...students]
            }];
    }
    // Initialize centroids from driver locations
    let centroids = drivers.map(d => ({
        lat: d.lat,
        lng: d.lng
    }));
    const maxIterations = 20;
    const convergenceThresholdMiles = 0.1;
    let clusters = [];
    for (let iter = 0; iter < maxIterations; iter++) {
        // Assign each student to the nearest centroid
        clusters = drivers.map((d, idx) => ({
            driverId: d.id,
            centroid: centroids[idx],
            students: []
        }));
        for (const student of students) {
            let nearestIdx = 0;
            let minDist = haversineDistanceMiles(student.lat, student.lng, centroids[0].lat, centroids[0].lng);
            for (let i = 1; i < centroids.length; i++) {
                const d = haversineDistanceMiles(student.lat, student.lng, centroids[i].lat, centroids[i].lng);
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }
            clusters[nearestIdx].students.push(student);
        }
        // Recalculate centroids
        const newCentroids = clusters.map(c => {
            if (c.students.length === 0)
                return c.centroid; // keep old
            const avgLat = c.students.reduce((s, p) => s + p.lat, 0) / c.students.length;
            const avgLng = c.students.reduce((s, p) => s + p.lng, 0) / c.students.length;
            return { lat: avgLat, lng: avgLng };
        });
        // Check convergence (all centroids moved < 0.1 miles)
        let converged = true;
        for (let i = 0; i < centroids.length; i++) {
            const shift = haversineDistanceMiles(centroids[i].lat, centroids[i].lng, newCentroids[i].lat, newCentroids[i].lng);
            if (shift >= convergenceThresholdMiles) {
                converged = false;
                break;
            }
        }
        centroids = newCentroids;
        // Update cluster centroids for the final result
        for (let i = 0; i < clusters.length; i++) {
            clusters[i].centroid = centroids[i];
        }
        if (converged)
            break;
    }
    return clusters;
}
/**
 * Haversine distance in miles (internal helper for the driver-seeded K-means)
 */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
//# sourceMappingURL=clustering.js.map