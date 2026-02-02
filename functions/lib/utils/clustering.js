"use strict";
// ============================================
// K-MEANS CLUSTERING ALGORITHM
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.kMeansClustering = kMeansClustering;
exports.matchClustersToDrivers = matchClustersToDrivers;
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
//# sourceMappingURL=clustering.js.map