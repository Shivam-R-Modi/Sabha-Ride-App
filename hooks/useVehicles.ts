
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { Vehicle } from '../types';

// --- Vehicle Management ---

export const updateVehicle = async (id: string, data: Partial<Vehicle>) => {
    try {
        const ref = doc(db, 'cars', id);

        // Map Partial<Vehicle> -> Partial<Car>
        const updates: any = {
            updatedAt: new Date().toISOString()
        };
        if (data.name !== undefined) updates.name = data.name;
        if (data.color !== undefined) updates.color = data.color;
        if (data.licensePlate !== undefined) updates.licensePlate = data.licensePlate;
        if (data.capacity !== undefined) updates.capacity = data.capacity;
        if (data.status !== undefined) updates.status = data.status;
        if (data.currentDriverId !== undefined) updates.assignedDriverId = data.currentDriverId;

        await updateDoc(ref, updates);
    } catch (error) {
        console.error("Error updating vehicle:", error);
        throw error;
    }
};

export const deleteVehicle = async (id: string) => {
    try {
        await deleteDoc(doc(db, 'cars', id));
    } catch (error) {
        console.error("Error deleting vehicle:", error);
        throw error;
    }
};

export const createVehicle = async (data: Omit<Vehicle, 'id'>): Promise<string> => {
    try {
        const docRef = await addDoc(collection(db, 'cars'), {
            name: data.name,
            color: data.color,
            licensePlate: data.licensePlate,
            capacity: data.capacity,
            status: data.status || 'available',
            assignedDriverId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
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
        const q = query(collection(db, 'cars'));

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

export const useAvailableVehicles = () => {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'cars'),
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
        // 1. Mark vehicle as in_use in 'cars' collection
        const vehicleRef = doc(db, 'cars', vehicle.id);
        await updateDoc(vehicleRef, {
            status: 'in_use', // Backend expects underscore
            assignedDriverId: driverId,
            updatedAt: new Date().toISOString()
        });

        // 2. Update driver profile with current vehicle ID
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, {
            currentVehicleId: vehicle.id,
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
        // 1. Mark vehicle as available in 'cars' collection
        const vehicleRef = doc(db, 'cars', vehicleId);
        await updateDoc(vehicleRef, {
            status: 'available',
            assignedDriverId: null
        });

        // 2. Clear from driver profile
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, {
            currentVehicleId: null as any,
            carModel: null as any,
            carColor: null as any,
            plateNumber: null as any,
            capacity: 0,
            status: 'offline' // Set driver offline when vehicle is released
        });
    } catch (error) {
        console.error("Error releasing vehicle:", error);
        throw error;
    }
};
