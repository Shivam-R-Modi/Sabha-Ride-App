
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { Driver, StudentRequest } from '../types';

// --- Users / Admin ---

export const usePendingDrivers = () => {
    const [pendingDrivers, setPendingDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'users'),
            where('roles', 'array-contains', 'driver'),
            where('accountStatus', '==', 'pending')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const drivers: Driver[] = [];
            snapshot.forEach((doc) => {
                drivers.push({ id: doc.id, ...doc.data() } as Driver);
            });
            setPendingDrivers(drivers);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    return { pendingDrivers, loading };
};

export const usePendingRequests = () => {
    const [requests, setRequests] = useState<StudentRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(collection(db, 'rides'), where('status', '==', 'requested'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list: StudentRequest[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Map fields to StudentRequest type for UI
                list.push({
                    id: doc.id,
                    name: data.studentName,
                    address: data.pickupAddress,
                    avatarUrl: data.studentAvatarUrl,
                    phone: '',
                    requestTime: data.createdAt,
                    requestedTimeSlot: data.timeSlot,
                    status: 'pending',
                    coordinates: data.coordinates || { x: 50, y: 50 } // fallback
                } as StudentRequest);
            });
            setRequests(list);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    return { requests, loading };
};

export const updateUserStatus = async (userId: string, status: 'approved' | 'rejected') => {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, { accountStatus: status });
    } catch (error) {
        console.error("Error updating user status:", error);
        throw error;
    }
};

export const updateUserProfile = async (userId: string, updates: { name?: string; phone?: string; address?: string }) => {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, updates);
    } catch (error) {
        console.error("Error updating user profile:", error);
        throw error;
    }
};

export const setDriverAvailability = async (driverId: string, status: 'available' | 'offline') => {
    try {
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, { status: status });
        console.log(`Driver ${driverId} availability updated to ${status}`);
    } catch (error) {
        console.error("Error updating driver availability:", error);
        throw error; // Re-throw so the UI can handle it
    }
};

// --- Drivers ---

export const useAvailableDrivers = () => {
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'users'),
            where('role', '==', 'driver'),
            where('accountStatus', '==', 'approved')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const driverList: Driver[] = [];
            snapshot.forEach((doc) => {
                driverList.push({ id: doc.id, ...doc.data() } as Driver);
            });
            setDrivers(driverList);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching available drivers:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    return { drivers, loading };
};
