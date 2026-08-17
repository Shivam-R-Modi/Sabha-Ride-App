
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, addDoc, updateDoc, setDoc, doc, deleteDoc } from 'firebase/firestore';
import { Vehicle } from '../types';
import { maxPassengerSeats } from '../src/constants/seats';

/**
 * One Firestore document to one Vehicle.
 *
 * Extracted because it was duplicated in both subscriptions below and one copy
 * was wrong: `currentDriverName` was read from a document field of that name,
 * which NOTHING writes. Every writer — assignVehicleToDriver here, and
 * writeVehicleState on the server — sets `assignedDriverName`. So the holder was
 * always undefined and the fleet list showed a car as In Use while naming
 * nobody, which is what made an ordinary soft release look like corruption.
 *
 * The line above it already worked around exactly this mismatch for the ID
 * (`currentDriverId` from `assignedDriverId`), so half the pair was mapped and
 * half was not.
 *
 * Pure and exported so the mapping has a test of its own; a fix living only
 * inside an onSnapshot callback is a fix nothing can guard.
 */
export function toVehicle(id: string, data: any): Vehicle {
    return {
        id,
        name: data.name || '',
        color: data.color || '',
        licensePlate: data.licensePlate || '',
        capacity: data.capacity || 4,
        status: data.status || 'available',
        currentDriverId: data.assignedDriverId || data.currentDriverId || undefined,
        currentDriverName: data.assignedDriverName || data.currentDriverName || undefined,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
    };
}

// --- Vehicle Management ---

export const updateVehicle = async (id: string, data: Partial<Vehicle>) => {
    try {
        const updates: any = {
            updatedAt: new Date().toISOString()
        };
        if (data.name !== undefined) updates.name = data.name;
        if (data.color !== undefined) updates.color = data.color;
        if (data.licensePlate !== undefined) updates.licensePlate = data.licensePlate;
        if (data.capacity !== undefined) updates.capacity = data.capacity;
        if (data.status !== undefined) updates.status = data.status;
        if (data.currentDriverId !== undefined) updates.assignedDriverId = data.currentDriverId;

        await Promise.all([
            setDoc(doc(db, 'vehicles', id), updates, { merge: true }),
            setDoc(doc(db, 'cars', id), updates, { merge: true })
        ]);
    } catch (error) {
        console.error("Error updating vehicle:", error);
        throw error;
    }
};

export const deleteVehicle = async (id: string) => {
    try {
        await Promise.all([
            deleteDoc(doc(db, 'vehicles', id)).catch(() => {}),
            deleteDoc(doc(db, 'cars', id)).catch(() => {})
        ]);
    } catch (error) {
        console.error("Error deleting vehicle:", error);
        throw error;
    }
};

export const createVehicle = async (data: Omit<Vehicle, 'id'>): Promise<string> => {
    try {
        const vehicleData = {
            name: data.name,
            color: data.color,
            licensePlate: data.licensePlate,
            capacity: data.capacity,
            status: data.status || 'available',
            assignedDriverId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const docRef = await addDoc(collection(db, 'vehicles'), vehicleData);
        // Also sync to cars collection
        await setDoc(doc(db, 'cars', docRef.id), vehicleData, { merge: true });
        return docRef.id;
    } catch (error) {
        console.error("Error creating vehicle:", error);
        throw error;
    }
};

export const useVehicles = () => {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const q = query(collection(db, 'vehicles'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const vehicleList: Vehicle[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                vehicleList.push(toVehicle(doc.id, data));
            });
            // Sort by name
            vehicleList.sort((a, b) => a.name.localeCompare(b.name));
            setVehicles(vehicleList);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching vehicles:", err);
            setError("Failed to load vehicles");
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    return { vehicles, loading, error };
};

/**
 * Passenger seats in the largest vehicle the fleet has — the threshold above
 * which a party cannot travel in one car and has to be split across several.
 *
 * Every vehicle counts, not just the free ones: whether a family COULD ride
 * together is a property of the fleet, and making it depend on what happens to be
 * available would split them tonight and not next week, for no reason anyone
 * could explain. `maxPassengerSeats` is shared with the server's copy, which is
 * what dispatch actually decides on.
 */
export const useMaxFleetSeats = (): number => {
    const { vehicles } = useVehicles();
    return maxPassengerSeats(vehicles.map(v => v.capacity));
};

export const useAvailableVehicles = () => {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'vehicles'),
            where('status', '==', 'available')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const vehicleList: Vehicle[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                vehicleList.push(toVehicle(doc.id, data));
            });
            vehicleList.sort((a, b) => a.name.localeCompare(b.name));
            setVehicles(vehicleList);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching available vehicles:", err);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    return { vehicles, loading };
};

export const assignVehicleToDriver = async (vehicle: Vehicle, driverId: string, driverName: string) => {
    try {
        const vehicleUpdates = {
            status: 'in_use',
            assignedDriverId: driverId,
            assignedDriverName: driverName,
            updatedAt: new Date().toISOString()
        };
        await Promise.all([
            setDoc(doc(db, 'vehicles', vehicle.id), vehicleUpdates, { merge: true }),
            setDoc(doc(db, 'cars', vehicle.id), vehicleUpdates, { merge: true })
        ]);

        // 2. Update driver profile with current vehicle ID
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, {
            currentVehicleId: vehicle.id,
            // The server's older name for the same thing. Nulled alongside so
            // the two can never describe different cars — see
            // functions/src/utils/fleet.ts.
            currentCarId: null,
            currentVehicleName: vehicle.name,
            currentVehiclePlate: vehicle.licensePlate,
            carModel: vehicle.name,
            carColor: vehicle.color,
            plateNumber: vehicle.licensePlate,
            capacity: vehicle.capacity,
            status: 'available' // Mark driver as available immediately upon getting car
        });
    } catch (error) {
        console.error("Error assigning vehicle:", error);
        throw error;
    }
};

/**
 * Hand a vehicle back to the fleet. Touches the VEHICLE only.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `releaseVehicle(vehicleId, driverId)` used to serve two callers that wanted
 * different things, and it did the second one harm:
 *
 *  - **A manager hard-releasing a driver.** That writes another user's document,
 *    so it needs a manager check, an audit row, and a refusal while that driver
 *    still has riders in the car. None of which a client write can do. It now goes
 *    through the `managerReleaseVehicle` callable, which does all three.
 *
 *  - **A driver swapping cars.** This one was actively broken. The shared function
 *    set `status: 'offline'` and reset `ridesCompletedToday`, `totalStudentsToday`
 *    and `totalDistanceToday` to zero — and nothing restored them. So a volunteer
 *    who changed cars halfway through an evening silently lost their whole day's
 *    tally, and the manager's board lost it too.
 *
 * A swap does not need the user document touched at all: `assignVehicleToDriver`
 * runs immediately afterwards and overwrites `currentVehicleId`, the name, the
 * plate and the status. All that is left over is the OLD vehicle, still marked as
 * held. So that is the only thing this writes.
 *
 * Both halves of the mirror, because the fleet lives in `vehicles` AND `cars`.
 */
export const handBackVehicle = async (vehicleId: string) => {
    try {
        const released = {
            status: 'available',
            assignedDriverId: null,
            assignedDriverName: null,
            updatedAt: new Date().toISOString(),
        };
        await Promise.all([
            setDoc(doc(db, 'vehicles', vehicleId), released, { merge: true }),
            setDoc(doc(db, 'cars', vehicleId), released, { merge: true }),
        ]);
    } catch (error) {
        console.error('Error handing back vehicle:', error);
        throw error;
    }
};
