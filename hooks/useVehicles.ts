
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, addDoc, updateDoc, setDoc, doc, deleteDoc } from 'firebase/firestore';
import { Vehicle } from '../types';
import { maxPassengerSeats } from '../src/constants/seats';

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
                vehicleList.push({
                    id: doc.id,
                    name: data.name || '',
                    color: data.color || '',
                    licensePlate: data.licensePlate || '',
                    capacity: data.capacity || 4,
                    status: data.status || 'available',
                    currentDriverId: data.assignedDriverId || undefined,
                    currentDriverName: data.currentDriverName || undefined,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt
                });
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
                vehicleList.push({
                    id: doc.id,
                    name: data.name || '',
                    color: data.color || '',
                    licensePlate: data.licensePlate || '',
                    capacity: data.capacity || 4,
                    status: data.status || 'available',
                    currentDriverId: data.assignedDriverId || undefined,
                    currentDriverName: data.currentDriverName || undefined,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt
                });
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

export const releaseVehicle = async (vehicleId: string, driverId: string) => {
    try {
        // 1. Mark vehicle as available in both 'vehicles' and 'cars' collections safely
        const vehicleUpdates = {
            status: 'available',
            assignedDriverId: null,
            assignedDriverName: null,
            updatedAt: new Date().toISOString()
        };
        await Promise.all([
            setDoc(doc(db, 'vehicles', vehicleId), vehicleUpdates, { merge: true }),
            setDoc(doc(db, 'cars', vehicleId), vehicleUpdates, { merge: true })
        ]);

        // 2. Clear from driver profile and reset daily counters
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, {
            currentVehicleId: null as any,
            // Clearing only currentVehicleId left driverDoneForToday a stale
            // currentCarId to fall back to, and it would release a car another
            // driver had since been given.
            currentCarId: null as any,
            currentVehicleName: null as any,
            currentVehiclePlate: null as any,
            carModel: null as any,
            carColor: null as any,
            plateNumber: null as any,
            capacity: 0,
            status: 'offline', // Set driver offline when vehicle is released
            ridesCompletedToday: 0,
            totalStudentsToday: 0,
            totalDistanceToday: 0
        });
    } catch (error) {
        console.error("Error releasing vehicle:", error);
        throw error;
    }
};
