
import { useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc, getDocs } from 'firebase/firestore';
import { Driver } from '../types';

// --- Dynamic Spatial Auto Dispatch System ---

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    if (!lat1 || !lng1 || !lat2 || !lng2) return 9999;
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export const useAutoDispatch = () => {
    // This hook will run in the Manager Dashboard and acts as the "Server" logic

    useEffect(() => {
        // Processing lock to prevent concurrent execution
        let isProcessing = false;
        let debounceTimer: NodeJS.Timeout | null = null;

        // 1. Monitor Pending Requests
        const qRequests = query(collection(db, 'rides'), where('status', '==', 'requested'));

        const unsubscribeRequests = onSnapshot(qRequests, async (snapshot) => {
            if (snapshot.empty) return;

            // Debounce: Wait for snapshot to settle (500ms)
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(async () => {
                // Lock check: If already processing, skip
                if (isProcessing) {
                    console.log('[useAutoDispatch] Already processing, skipping...');
                    return;
                }

                isProcessing = true;
                console.log('[useAutoDispatch] Starting dispatch processing...');

                try {
                    await processAssignments();
                } catch (error) {
                    console.error('[useAutoDispatch] Error processing:', error);
                } finally {
                    isProcessing = false;
                    console.log('[useAutoDispatch] Processing complete');
                }
            }, 500);
        });

        // Extracted assignment logic
        async function processAssignments() {
            // Re-fetch fresh data (snapshot may be stale after debounce)
            const freshRequestsSnap = await getDocs(query(collection(db, 'rides'), where('status', '==', 'requested')));

            if (freshRequestsSnap.empty) return;

            // Fetch available drivers
            const qDrivers = query(
                collection(db, 'users'),
                where('role', '==', 'driver'),
                where('status', '==', 'available')
            );
            const driverSnap = await getDocs(qDrivers);
            const availableDrivers = driverSnap.docs
                .map(d => ({ id: d.id, ...d.data() } as Driver))
                .filter(d => d.currentVehicleId); // Must have a car

            if (availableDrivers.length === 0) return;

            // Fetch current active assignments to determine driver load
            const qActiveRides = query(collection(db, 'rides'), where('status', 'in', ['assigned', 'in_progress']));
            const activeRidesSnap = await getDocs(qActiveRides);

            // Map: DriverID -> Load count
            const driverLoad = new Map<string, number>();

            activeRidesSnap.forEach(doc => {
                const ride = doc.data();
                if (ride.driver?.id || ride.driverId) {
                    const dId = ride.driver?.id || ride.driverId;
                    driverLoad.set(dId, (driverLoad.get(dId) || 0) + 1);
                }
            });

            // Process each pending request using pure spatial distance matching
            for (const rideDoc of freshRequestsSnap.docs) {
                const ride = rideDoc.data();
                const studentLat = ride.pickupLat || (ride.location?.lat ?? ride.location?.latitude ?? 0);
                const studentLng = ride.pickupLng || (ride.location?.lng ?? ride.location?.longitude ?? 0);

                let assignedDriver: Driver | null = null;
                let shortestDistance = Infinity;

                // Find the nearest available driver with remaining seating capacity
                for (const driver of availableDrivers) {
                    const currentLoad = driverLoad.get(driver.id) || 0;
                    const maxCapacity = Math.max(1, (driver.capacity || 4) - 1); // 1 seat reserved for driver

                    if (currentLoad < maxCapacity) {
                        const rawLoc = (driver as any).currentLocation || driver.homeLocation || (driver as any).location;
                        const driverLat = rawLoc?.lat ?? rawLoc?.latitude ?? 0;
                        const driverLng = rawLoc?.lng ?? rawLoc?.longitude ?? 0;

                        const dist = haversineMiles(driverLat, driverLng, studentLat, studentLng);
                        if (dist < shortestDistance) {
                            shortestDistance = dist;
                            assignedDriver = driver;
                        }
                    }
                }

                if (assignedDriver) {
                    // Update Maps for next iteration in this loop
                    driverZones.set(assignedDriver.id, studentZone);
                    driverLoad.set(assignedDriver.id, (driverLoad.get(assignedDriver.id) || 0) + 1);

                    // Execute Assignment
                    await updateDoc(doc(db, 'rides', rideDoc.id), {
                        status: 'assigned',
                        driver: assignedDriver
                    });
                    console.log(`Auto-assigned ride ${rideDoc.id} (${studentZone}) to ${assignedDriver.name}`);
                }
            }
        }

        // 2. Monitor Ready-To-Leave Requests (Dropoff)
        // Similar clustering logic could be applied here based on destination
        const qActive = query(collection(db, 'rides'), where('isReadyToLeave', '==', true));

        const unsubscribeDropoff = onSnapshot(qActive, async (snapshot) => {
            const ridesNeedingDriver = snapshot.docs.filter(d => {
                const data = d.data();
                return !data.returnDriver; // Not yet assigned a return driver
            });

            if (ridesNeedingDriver.length === 0) return;

            const qDrivers = query(collection(db, 'users'), where('role', '==', 'driver'), where('status', '==', 'available'));
            const driverSnap = await getDocs(qDrivers);
            const availableDrivers = driverSnap.docs.map(d => ({ id: d.id, ...d.data() } as Driver)).filter(d => d.currentVehicleId);
            if (availableDrivers.length === 0) return;

            ridesNeedingDriver.forEach(async (rideDoc) => {
                const driver = availableDrivers[Math.floor(Math.random() * availableDrivers.length)];
                await updateDoc(doc(db, 'rides', rideDoc.id), {
                    returnDriver: driver
                });
                console.log(`Auto-assigned return ride ${rideDoc.id} to driver ${driver.name}`);
            });
        });

        return () => {
            unsubscribeRequests();
            unsubscribeDropoff();
        };
    }, []);
};
