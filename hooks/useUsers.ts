
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { Driver, StudentRequest, User } from '../types';
import { handleSnapshotError } from '../src/utils/firestoreErrors';

/** Same generated avatar the assignment function builds for ride peers. */
const avatarUrlFor = (name: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff`;

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
        }, handleSnapshotError('useUsers', () => setLoading(false)));

        return unsubscribe;
    }, []);

    return { pendingDrivers, loading };
};

export const usePendingRiders = () => {
    const [pendingRiders, setPendingRiders] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'users'),
            where('roles', 'array-contains', 'student'),
            where('accountStatus', '==', 'pending')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const riders: User[] = [];
            snapshot.forEach((doc) => {
                riders.push({ id: doc.id, ...doc.data() } as User);
            });
            setPendingRiders(riders);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching pending riders:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    return { pendingRiders, loading };
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
                const name = data.studentName || 'Student';
                list.push({
                    id: doc.id,
                    name,
                    address: data.pickupAddress,
                    // `studentAvatarUrl` is read here and rendered by
                    // RequestTable, and nothing has ever written it — every
                    // request row showed a broken image. Derived from the name
                    // the same way globalAssignDriver derives peer avatars.
                    avatarUrl: data.studentAvatarUrl || avatarUrlFor(name),
                    phone: data.studentPhone || '',
                    requestTime: data.createdAt,
                    requestedTimeSlot: data.timeSlot,
                    status: 'pending',
                    // pickupLat/pickupLng were carried here for the dashboard
                    // map to plot. The map is gone and RequestTable never read
                    // them, so they were being copied onto every request row for
                    // nobody. The coordinates still live on the ride document,
                    // which is where the driver's route reads them.
                } as StudentRequest);
            });
            setRequests(list);
            setLoading(false);
        }, handleSnapshotError('useUsers', () => setLoading(false)));
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
