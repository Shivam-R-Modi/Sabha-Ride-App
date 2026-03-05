"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const clustering_1 = require("./clustering");
// Helper to build a minimal Student for clustering
function makeStudent(id, lat, lng) {
    return {
        id,
        userId: `user-${id}`,
        name: `Student ${id}`,
        location: { lat, lng },
        status: 'waiting_for_pickup',
        currentRideId: null,
        pickupRequested: true,
        dropoffRequested: false,
    };
}
// Helper to build a minimal Driver for matching
function makeDriver(id, lat, lng) {
    return {
        id,
        userId: `user-${id}`,
        name: `Driver ${id}`,
        currentCarId: `car-${id}`,
        currentLocation: { lat, lng },
        homeLocation: null,
        status: 'ready_for_assignment',
        activeRideId: null,
        ridesCompletedToday: 0,
        totalStudentsToday: 0,
        totalDistanceToday: 0,
    };
}
(0, vitest_1.describe)('kMeansClustering', () => {
    (0, vitest_1.it)('returns empty array for no students', () => {
        (0, vitest_1.expect)((0, clustering_1.kMeansClustering)([], 3)).toEqual([]);
    });
    (0, vitest_1.it)('returns empty array for k = 0', () => {
        const students = [makeStudent('1', 42.36, -71.06)];
        (0, vitest_1.expect)((0, clustering_1.kMeansClustering)(students, 0)).toEqual([]);
    });
    (0, vitest_1.it)('assigns each student to own cluster when students ≤ k', () => {
        const students = [
            makeStudent('1', 42.36, -71.06),
            makeStudent('2', 42.37, -71.07),
        ];
        const clusters = (0, clustering_1.kMeansClustering)(students, 5);
        (0, vitest_1.expect)(clusters).toHaveLength(2);
        (0, vitest_1.expect)(clusters[0].students).toHaveLength(1);
        (0, vitest_1.expect)(clusters[1].students).toHaveLength(1);
    });
    (0, vitest_1.it)('groups nearby students into same cluster', () => {
        // Two groups of students ~300 km apart
        const bostonStudents = [
            makeStudent('b1', 42.36, -71.06),
            makeStudent('b2', 42.37, -71.07),
            makeStudent('b3', 42.35, -71.05),
        ];
        const nycStudents = [
            makeStudent('n1', 40.71, -74.01),
            makeStudent('n2', 40.72, -74.00),
            makeStudent('n3', 40.70, -74.02),
        ];
        const clusters = (0, clustering_1.kMeansClustering)([...bostonStudents, ...nycStudents], 2);
        // Should produce 2 clusters
        (0, vitest_1.expect)(clusters).toHaveLength(2);
        // Each cluster should contain students from the same city
        for (const cluster of clusters) {
            const ids = cluster.students.map(s => s.id);
            const allBoston = ids.every(id => id.startsWith('b'));
            const allNYC = ids.every(id => id.startsWith('n'));
            (0, vitest_1.expect)(allBoston || allNYC).toBe(true);
        }
    });
    (0, vitest_1.it)('all students are assigned to exactly one cluster', () => {
        const students = [
            makeStudent('1', 42.36, -71.06),
            makeStudent('2', 40.71, -74.01),
            makeStudent('3', 41.88, -87.63), // Chicago
            makeStudent('4', 42.33, -71.10),
            makeStudent('5', 40.75, -73.99),
        ];
        const clusters = (0, clustering_1.kMeansClustering)(students, 3);
        const allAssigned = clusters.flatMap(c => c.students.map(s => s.id));
        (0, vitest_1.expect)(allAssigned.sort()).toEqual(['1', '2', '3', '4', '5'].sort());
    });
});
(0, vitest_1.describe)('matchClustersToDrivers', () => {
    (0, vitest_1.it)('assigns each cluster to the nearest driver', () => {
        const clusters = [
            {
                center: { lat: 42.36, lng: -71.06 }, // Boston
                students: [makeStudent('b1', 42.36, -71.06)],
            },
            {
                center: { lat: 40.71, lng: -74.01 }, // NYC
                students: [makeStudent('n1', 40.71, -74.01)],
            },
        ];
        const drivers = [
            makeDriver('d-bos', 42.35, -71.05), // near Boston
            makeDriver('d-nyc', 40.72, -74.00), // near NYC
        ];
        const assignments = (0, clustering_1.matchClustersToDrivers)(clusters, drivers);
        (0, vitest_1.expect)(assignments.size).toBe(2);
        // Boston driver gets Boston students
        const bosStudents = assignments.get('d-bos');
        (0, vitest_1.expect)(bosStudents).toBeDefined();
        (0, vitest_1.expect)(bosStudents[0].id).toBe('b1');
        // NYC driver gets NYC students
        const nycStudents = assignments.get('d-nyc');
        (0, vitest_1.expect)(nycStudents).toBeDefined();
        (0, vitest_1.expect)(nycStudents[0].id).toBe('n1');
    });
    (0, vitest_1.it)('limits assignment to vehicle capacity (4)', () => {
        const sixStudents = Array.from({ length: 6 }, (_, i) => makeStudent(`s${i}`, 42.36 + i * 0.001, -71.06));
        const clusters = [
            {
                center: { lat: 42.36, lng: -71.06 },
                students: sixStudents,
            },
        ];
        const drivers = [makeDriver('d1', 42.36, -71.06)];
        const assignments = (0, clustering_1.matchClustersToDrivers)(clusters, drivers);
        // Should cap at 4 (default capacity)
        (0, vitest_1.expect)(assignments.get('d1').length).toBeLessThanOrEqual(4);
    });
    (0, vitest_1.it)('handles more clusters than drivers', () => {
        const clusters = [
            { center: { lat: 42.36, lng: -71.06 }, students: [makeStudent('1', 42.36, -71.06)] },
            { center: { lat: 40.71, lng: -74.01 }, students: [makeStudent('2', 40.71, -74.01)] },
            { center: { lat: 41.88, lng: -87.63 }, students: [makeStudent('3', 41.88, -87.63)] },
        ];
        const drivers = [makeDriver('d1', 42.36, -71.06)];
        const assignments = (0, clustering_1.matchClustersToDrivers)(clusters, drivers);
        // Only 1 driver, so only 1 assignment
        (0, vitest_1.expect)(assignments.size).toBe(1);
    });
});
//# sourceMappingURL=clustering.test.js.map