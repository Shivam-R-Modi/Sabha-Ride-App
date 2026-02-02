// ============================================
// CUSTOM VRP SOLVER (Capacitated Vehicle Routing Problem)
// ============================================
// Pure TypeScript implementation - no native dependencies
// Uses Clarke-Wright Savings + Local Search for optimization
// Replaces K-Means clustering with proper VRP solution

import { Student, Driver, GeoLocation, RideStudent } from '../types';
import { haversineDistance } from '../utils/distance';

// Sabha location (depot)
const SABHA_LOCATION: GeoLocation = {
    lat: 42.3396,
    lng: -71.0942
};

export interface VRPAssignment {
    driverId: string;
    driverName: string;
    students: RideStudent[];
    routeDistance: number;
    estimatedTime: number;
    googleMapsUrl: string;
}

export interface VRPOptimizationResult {
    assignments: VRPAssignment[];
    unassignedStudents: Array<{ id: string; reason: string }>;
    optimizationMetrics: {
        totalDistance: number;
        solverTimeMs: number;
        algorithm: string;
    };
}

interface VRPRoute {
    driverId: string;
    driverName: string;
    capacity: number;
    studentIds: string[];
    totalDemand: number;
}

interface SavingsEntry {
    i: number;
    j: number;
    savings: number;
}

/**
 * Solve CVRP using Clarke-Wright Savings Algorithm + Local Search
 * This is a well-known heuristic that provides good solutions quickly
 */
export function solveCVRP(
    students: Student[],
    drivers: Driver[],
    rideType: 'home-to-sabha' | 'sabha-to-home'
): VRPOptimizationResult {
    const startTime = Date.now();

    // Handle edge cases
    if (students.length === 0) {
        return {
            assignments: [],
            unassignedStudents: [],
            optimizationMetrics: {
                totalDistance: 0,
                solverTimeMs: 0,
                algorithm: 'clarke-wright-savings'
            }
        };
    }

    if (drivers.length === 0) {
        return {
            assignments: [],
            unassignedStudents: students.map(s => ({ id: s.id, reason: 'no_drivers_available' })),
            optimizationMetrics: {
                totalDistance: 0,
                solverTimeMs: Date.now() - startTime,
                algorithm: 'clarke-wright-savings'
            }
        };
    }

    // Build location array: index 0 = depot, 1..N = students
    const locations: GeoLocation[] = [SABHA_LOCATION, ...students.map(s => s.location)];
    const studentIds = ['', ...students.map(s => s.id)]; // index 0 is empty (depot)

    // Build distance matrix
    const distanceMatrix = buildDistanceMatrix(locations);

    // Get vehicle capacities (default to 4 if not specified)
    const vehicleCapacities = drivers.map(() => 4);

    // Step 1: Clarke-Wright Savings Algorithm
    let routes = clarkeWrightSavings(
        students.length,
        distanceMatrix,
        vehicleCapacities,
        drivers
    );

    // Step 2: Local Search Improvement (2-opt and relocate)
    routes = improveRoutesWithLocalSearch(routes, distanceMatrix, students);

    // Step 3: Build assignments from routes
    const assignments: VRPAssignment[] = [];
    const assignedStudentIds = new Set<string>();
    let totalDistance = 0;

    for (let v = 0; v < routes.length; v++) {
        const route = routes[v];
        if (route.studentIds.length === 0) continue;

        const driver = drivers[v];
        const routeStudents: RideStudent[] = [];
        let routeDistance = 0;

        // Calculate route distance
        let prevIndex = 0; // Start at depot
        for (const studentId of route.studentIds) {
            const studentIndex = studentIds.indexOf(studentId);
            routeDistance += distanceMatrix[prevIndex][studentIndex];
            prevIndex = studentIndex;

            const student = students.find(s => s.id === studentId);
            if (student) {
                routeStudents.push({
                    id: student.id,
                    name: student.name,
                    location: student.location,
                    picked: false
                });
                assignedStudentIds.add(student.id);
            }
        }
        // Return to depot
        routeDistance += distanceMatrix[prevIndex][0];

        const estimatedTime = Math.ceil(routeDistance / 0.5); // Assume 30 km/h average

        assignments.push({
            driverId: driver.id,
            driverName: driver.name,
            students: routeStudents,
            routeDistance: Math.round(routeDistance * 10) / 10,
            estimatedTime,
            googleMapsUrl: buildGoogleMapsUrl(routeStudents, rideType)
        });

        totalDistance += routeDistance;
    }

    // Find unassigned students
    const unassignedStudents = students
        .filter(s => !assignedStudentIds.has(s.id))
        .map(s => ({ id: s.id, reason: 'capacity_exceeded' }));

    const solverTimeMs = Date.now() - startTime;

    return {
        assignments,
        unassignedStudents,
        optimizationMetrics: {
            totalDistance: Math.round(totalDistance * 10) / 10,
            solverTimeMs,
            algorithm: 'clarke-wright-savings'
        }
    };
}

/**
 * Build distance matrix for all locations
 */
function buildDistanceMatrix(locations: GeoLocation[]): number[][] {
    const n = locations.length;
    const matrix: number[][] = [];

    for (let i = 0; i < n; i++) {
        matrix[i] = [];
        for (let j = 0; j < n; j++) {
            if (i === j) {
                matrix[i][j] = 0;
            } else {
                matrix[i][j] = haversineDistance(locations[i], locations[j]);
            }
        }
    }

    return matrix;
}

/**
 * Clarke-Wright Savings Algorithm
 * Creates initial feasible solution by merging routes based on savings
 */
function clarkeWrightSavings(
    numStudents: number,
    distanceMatrix: number[][],
    vehicleCapacities: number[],
    drivers: Driver[]
): VRPRoute[] {
    const numVehicles = vehicleCapacities.length;

    // Initialize routes: each student in their own route (assigned to nearest vehicle)
    const routes: VRPRoute[] = [];
    for (let v = 0; v < numVehicles; v++) {
        routes.push({
            driverId: drivers[v]?.id || `vehicle_${v}`,
            driverName: drivers[v]?.name || `Vehicle ${v}`,
            capacity: vehicleCapacities[v],
            studentIds: [],
            totalDemand: 0
        });
    }

    // Calculate savings for all pairs
    const savings: SavingsEntry[] = [];
    for (let i = 1; i <= numStudents; i++) {
        for (let j = i + 1; j <= numStudents; j++) {
            // Savings = d(0,i) + d(0,j) - d(i,j)
            const saving = distanceMatrix[0][i] + distanceMatrix[0][j] - distanceMatrix[i][j];
            savings.push({ i, j, savings: saving });
        }
    }

    // Sort by savings (descending)
    savings.sort((a, b) => b.savings - a.savings);

    // Track which route each student is in
    const studentRoute = new Map<number, number>(); // student index -> route index

    // Assign students to routes greedily based on savings
    for (const entry of savings) {
        const studentI = entry.i;
        const studentJ = entry.j;

        const routeI = studentRoute.get(studentI);
        const routeJ = studentRoute.get(studentJ);

        // Both unassigned - try to create new route or add to existing
        if (routeI === undefined && routeJ === undefined) {
            // Find best route to add both
            for (let v = 0; v < numVehicles; v++) {
                if (routes[v].totalDemand + 2 <= routes[v].capacity) {
                    routes[v].studentIds.push(studentIds[studentI], studentIds[studentJ]);
                    routes[v].totalDemand += 2;
                    studentRoute.set(studentI, v);
                    studentRoute.set(studentJ, v);
                    break;
                }
            }
        }
        // I assigned, J unassigned - try to add J to I's route
        else if (routeI !== undefined && routeJ === undefined) {
            if (routes[routeI].totalDemand + 1 <= routes[routeI].capacity) {
                routes[routeI].studentIds.push(studentIds[studentJ]);
                routes[routeI].totalDemand += 1;
                studentRoute.set(studentJ, routeI);
            }
        }
        // J assigned, I unassigned - try to add I to J's route
        else if (routeI === undefined && routeJ !== undefined) {
            if (routes[routeJ].totalDemand + 1 <= routes[routeJ].capacity) {
                routes[routeJ].studentIds.push(studentIds[studentI]);
                routes[routeJ].totalDemand += 1;
                studentRoute.set(studentI, routeJ);
            }
        }
        // Both assigned to different routes - try to merge
        else if (routeI !== undefined && routeJ !== undefined && routeI !== routeJ) {
            const combinedDemand = routes[routeI].totalDemand + routes[routeJ].totalDemand;
            if (combinedDemand <= routes[routeI].capacity) {
                // Merge routeJ into routeI
                routes[routeI].studentIds.push(...routes[routeJ].studentIds);
                routes[routeI].totalDemand = combinedDemand;

                // Update student assignments
                for (const sid of routes[routeJ].studentIds) {
                    const idx = studentIds.indexOf(sid);
                    if (idx > 0) studentRoute.set(idx, routeI);
                }

                // Clear routeJ
                routes[routeJ].studentIds = [];
                routes[routeJ].totalDemand = 0;
            }
        }
    }

    // Assign any remaining unassigned students
    for (let i = 1; i <= numStudents; i++) {
        if (!studentRoute.has(i)) {
            for (let v = 0; v < numVehicles; v++) {
                if (routes[v].totalDemand + 1 <= routes[v].capacity) {
                    routes[v].studentIds.push(studentIds[i]);
                    routes[v].totalDemand += 1;
                    studentRoute.set(i, v);
                    break;
                }
            }
        }
    }

    // Optimize each route with TSP (nearest neighbor)
    for (const route of routes) {
        if (route.studentIds.length > 1) {
            route.studentIds = optimizeRouteOrder(route.studentIds, distanceMatrix);
        }
    }

    return routes;
}

// Global student ID mapping for the algorithm
let studentIds: string[] = [''];

/**
 * Optimize route order using nearest neighbor TSP
 */
function optimizeRouteOrder(studentIdsInRoute: string[], distanceMatrix: number[][]): string[] {
    if (studentIdsInRoute.length <= 1) return studentIdsInRoute;

    const unvisited = [...studentIdsInRoute];
    const ordered: string[] = [];

    // Start with first student
    let current = unvisited.shift()!;
    ordered.push(current);

    while (unvisited.length > 0) {
        const currentIndex = studentIds.indexOf(current);
        let nearestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            const candidateIndex = studentIds.indexOf(unvisited[i]);
            const dist = distanceMatrix[currentIndex][candidateIndex];
            if (dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        }

        current = unvisited.splice(nearestIndex, 1)[0];
        ordered.push(current);
    }

    return ordered;
}

/**
 * Improve routes using local search (2-opt and relocate)
 */
function improveRoutesWithLocalSearch(
    routes: VRPRoute[],
    distanceMatrix: number[][],
    students: Student[]
): VRPRoute[] {
    let improved = true;
    let iterations = 0;
    const maxIterations = 100;

    while (improved && iterations < maxIterations) {
        improved = false;
        iterations++;

        // Try 2-opt on each route
        for (const route of routes) {
            if (route.studentIds.length < 3) continue;

            const newOrder = twoOpt(route.studentIds, distanceMatrix);
            if (newOrder !== route.studentIds) {
                route.studentIds = newOrder;
                improved = true;
            }
        }

        // Try relocate between routes
        for (let i = 0; i < routes.length; i++) {
            for (let j = 0; j < routes.length; j++) {
                if (i === j) continue;

                const result = tryRelocate(routes[i], routes[j], distanceMatrix);
                if (result.improved) {
                    routes[i] = result.fromRoute;
                    routes[j] = result.toRoute;
                    improved = true;
                }
            }
        }
    }

    return routes;
}

/**
 * 2-opt improvement for a single route
 */
function twoOpt(studentIdsInRoute: string[], distanceMatrix: number[][]): string[] {
    if (studentIdsInRoute.length < 3) return studentIdsInRoute;

    let best = [...studentIdsInRoute];
    let bestDistance = calculateRouteDistance(best, distanceMatrix);
    let improved = true;

    while (improved) {
        improved = false;

        for (let i = 0; i < best.length - 1; i++) {
            for (let j = i + 2; j < best.length; j++) {
                // Create new route by reversing segment [i+1, j]
                const newRoute = [...best];
                const segment = newRoute.splice(i + 1, j - i);
                newRoute.splice(i + 1, 0, ...segment.reverse());

                const newDistance = calculateRouteDistance(newRoute, distanceMatrix);
                if (newDistance < bestDistance) {
                    best = newRoute;
                    bestDistance = newDistance;
                    improved = true;
                }
            }
        }
    }

    return best;
}

/**
 * Calculate total route distance (including depot)
 */
function calculateRouteDistance(studentIdsInRoute: string[], distanceMatrix: number[][]): number {
    if (studentIdsInRoute.length === 0) return 0;

    let distance = 0;
    let prevIndex = 0; // Depot

    for (const sid of studentIdsInRoute) {
        const idx = studentIds.indexOf(sid);
        distance += distanceMatrix[prevIndex][idx];
        prevIndex = idx;
    }

    // Return to depot
    distance += distanceMatrix[prevIndex][0];

    return distance;
}

/**
 * Try to relocate a student from one route to another
 */
function tryRelocate(
    fromRoute: VRPRoute,
    toRoute: VRPRoute,
    distanceMatrix: number[][]
): { improved: boolean; fromRoute: VRPRoute; toRoute: VRPRoute } {
    if (fromRoute.studentIds.length === 0) return { improved: false, fromRoute, toRoute };
    if (toRoute.totalDemand >= toRoute.capacity) return { improved: false, fromRoute, toRoute };

    const originalFromDist = calculateRouteDistance(fromRoute.studentIds, distanceMatrix);
    const originalToDist = calculateRouteDistance(toRoute.studentIds, distanceMatrix);
    const originalTotal = originalFromDist + originalToDist;

    let bestStudentIndex = -1;
    let bestInsertPosition = -1;
    let bestImprovement = 0;

    for (let i = 0; i < fromRoute.studentIds.length; i++) {
        const studentId = fromRoute.studentIds[i];

        // Try inserting at each position in toRoute
        for (let pos = 0; pos <= toRoute.studentIds.length; pos++) {
            const newFromRoute = [...fromRoute.studentIds];
            newFromRoute.splice(i, 1);

            const newToRoute = [...toRoute.studentIds];
            newToRoute.splice(pos, 0, studentId);

            const newFromDist = calculateRouteDistance(newFromRoute, distanceMatrix);
            const newToDist = calculateRouteDistance(newToRoute, distanceMatrix);
            const newTotal = newFromDist + newToDist;

            const improvement = originalTotal - newTotal;
            if (improvement > bestImprovement) {
                bestImprovement = improvement;
                bestStudentIndex = i;
                bestInsertPosition = pos;
            }
        }
    }

    if (bestImprovement > 0) {
        const studentId = fromRoute.studentIds[bestStudentIndex];
        const newFromRoute = { ...fromRoute };
        newFromRoute.studentIds = [...fromRoute.studentIds];
        newFromRoute.studentIds.splice(bestStudentIndex, 1);
        newFromRoute.totalDemand -= 1;

        const newToRoute = { ...toRoute };
        newToRoute.studentIds = [...toRoute.studentIds];
        newToRoute.studentIds.splice(bestInsertPosition, 0, studentId);
        newToRoute.totalDemand += 1;

        return { improved: true, fromRoute: newFromRoute, toRoute: newToRoute };
    }

    return { improved: false, fromRoute, toRoute };
}

/**
 * Build Google Maps URL for navigation
 */
function buildGoogleMapsUrl(
    students: RideStudent[],
    rideType: 'home-to-sabha' | 'sabha-to-home'
): string {
    if (students.length === 0) return '';

    if (rideType === 'home-to-sabha') {
        // Pickup: First student -> Sabha, with waypoints
        const origin = `${students[0].location.lat},${students[0].location.lng}`;
        const destination = `${SABHA_LOCATION.lat},${SABHA_LOCATION.lng}`;

        if (students.length === 1) {
            return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
        }

        const waypoints = students
            .slice(1)
            .map(s => `${s.location.lat},${s.location.lng}`)
            .join('|');

        return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    } else {
        // Drop-off: Sabha -> Last student, with waypoints
        const origin = `${SABHA_LOCATION.lat},${SABHA_LOCATION.lng}`;
        const destination = `${students[students.length - 1].location.lat},${students[students.length - 1].location.lng}`;

        if (students.length === 1) {
            return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
        }

        const waypoints = students
            .slice(0, -1)
            .map(s => `${s.location.lat},${s.location.lng}`)
            .join('|');

        return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    }
}
