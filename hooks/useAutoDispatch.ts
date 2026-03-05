
import { useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc, getDocs } from 'firebase/firestore';
import { Driver } from '../types';

// --- Auto Dispatch System (The Brain) ---

const getZone = (address: string): string => {
    const lower = address.toLowerCase();
    if (lower.includes('back bay') || lower.includes('newbury') || lower.includes('boylston')) return 'back_bay';
    if (lower.includes('north end') || lower.includes('hanover') || lower.includes('charlestown') || lower.includes('east boston') || lower.includes('washington')) return 'north';
    if (lower.includes('allston') || lower.includes('brighton') || lower.includes('faneuil') || lower.includes('penniman') || lower.includes('academy')) return 'west';
    if (lower.includes('dorchester') || lower.includes('roxbury') || lower.includes('south boston') || lower.includes('broadway')) return 'south';
    return 'downtown'; // default
};

export const useAutoDispatch = () => {
    // This hook will run in the Manager Dashboard and acts as the "Server" logic

    useEffect(() => {
        // 1. Monitor Pending Requests
        const qRequests = query(collection(db, 'rides'), where('status', '==', 'requested'));

        const unsubscribeRequests = onSnapshot(qRequests, async (snapshot) => {
            if (snapshot.empty) return;

            // Fetch available drivers (MUST be done inside snapshot to be fresh)
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

            // Fetch current active assignments to determine driver zones/load
            // We use 'assigned' status rides to see who is going where
            const qActiveRides = query(collection(db, 'rides'), where('status', '==', 'assigned'));
            const activeRidesSnap = await getDocs(qActiveRides);

            // Map: DriverID -> Zone being covered
            const driverZones = new Map<string, string>();
            // Map: DriverID -> Load count
            const driverLoad = new Map<string, number>();

            activeRidesSnap.forEach(doc => {
                const ride = doc.data();
                if (ride.driver?.id) {
                    const dId = ride.driver.id;
                    const z = getZone(ride.pickupAddress);
                    driverZones.set(dId, z);
                    driverLoad.set(dId, (driverLoad.get(dId) || 0) + 1);
                }
            });

            // Process each pending request
            for (const rideDoc of snapshot.docs) {
                const ride = rideDoc.data();
                const studentZone = getZone(ride.pickupAddress);
                let assignedDriver: Driver | null = null;

                // STRATEGY 1: Find a driver already in this zone with capacity
                for (const driver of availableDrivers) {
                    const currentLoad = driverLoad.get(driver.id) || 0;
                    const maxCapacity = driver.capacity || 4;

                    // If driver is already working this zone and has space
                    if (driverZones.get(driver.id) === studentZone && currentLoad < maxCapacity) {
                        assignedDriver = driver;
                        break;
                    }
                }

                // STRATEGY 2: If no zone match, find a free driver (load 0)
                if (!assignedDriver) {
                    const freeDriver = availableDrivers.find(d => (driverLoad.get(d.id) || 0) === 0);
                    if (freeDriver) {
                        assignedDriver = freeDriver;
                    }
                }

                // STRATEGY 3: Round Robin / Random fallback (fill up anyone with space)
                if (!assignedDriver) {
                    const anyDriver = availableDrivers.find(d => (driverLoad.get(d.id) || 0) < (d.capacity || 4));
                    if (anyDriver) assignedDriver = anyDriver;
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
        });

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
