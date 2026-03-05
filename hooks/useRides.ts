
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, getDoc, getDocs } from 'firebase/firestore';
import { Ride, RideStatus, Driver } from '../types';

// --- Rides ---

export const useActiveRide = (userId: string) => {
    const [activeRide, setActiveRide] = useState<Ride | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'rides'),
            where('studentId', '==', userId),
            where('status', 'in', ['requested', 'assigned', 'driver_en_route', 'arriving', 'completed'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            // Filter locally for today/future relevant rides if needed, 
            // but for now just take the most recent active one
            const active = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() } as Ride))
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

            if (active) {
                // If it's completed but ready to leave is true, we still want to show it for the return trip
                // Or if it's 'requested'
                setActiveRide(active);
            } else {
                setActiveRide(null);
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching active ride:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, [userId]);

    return { activeRide, loading };
};

export const useAllActiveRides = () => {
    const [rides, setRides] = useState<Ride[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fetch all rides that are currently active (assigned to a driver)
        // This is used for the Manager's live monitoring view
        const q = query(
            collection(db, 'rides'),
            where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'completed'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list: Ride[] = [];
            snapshot.forEach(doc => {
                list.push({ id: doc.id, ...doc.data() } as Ride);
            });
            setRides(list);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    return { rides, loading };
};

export const createRideRequest = async (userId: string, details: any) => {
    try {
        // Guard: prevent duplicate ride requests
        const existingRidesQuery = query(
            collection(db, 'rides'),
            where('studentId', '==', userId),
            where('status', 'in', ['requested', 'assigned', 'driver_en_route', 'arriving'])
        );
        const existingSnapshot = await getDocs(existingRidesQuery);
        if (!existingSnapshot.empty) {
            throw new Error('You already have an active ride request. Please wait for it to be completed before requesting a new one.');
        }

        // Fetch user profile to get coordinates saved during signup
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) {
            throw new Error('User profile not found');
        }

        const userData = userDoc.data();
        const location = userData?.location;

        // Extract lat/lng — coordinates were saved by AddressAutocomplete during ProfileSetup
        const pickupLat = location?.latitude ?? 0;
        const pickupLng = location?.longitude ?? 0;

        if (pickupLat === 0 && pickupLng === 0) {
            throw new Error('Your address coordinates are missing. Please update your address in Profile.');
        }

        await addDoc(collection(db, 'rides'), {
            studentId: userId,
            studentName: details.studentName || 'Unknown',
            date: details.date,
            timeSlot: details.time,
            pickupAddress: details.address,
            pickupLat,
            pickupLng,
            notes: details.notes || '',
            status: 'requested',
            createdAt: new Date().toISOString(),
            peers: [],
            isReadyToLeave: false
        });
        return true;
    } catch (error) {
        console.error("Error creating ride:", error);
        throw error;
    }
};

export const updateRideStatus = async (rideId: string, status: RideStatus) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        await updateDoc(rideRef, { status });
    } catch (error) {
        console.error("Error updating ride:", error);
    }
};

export const updateRideDetails = async (rideId: string, updates: Partial<Ride>) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        await updateDoc(rideRef, updates);
    } catch (error) {
        console.error("Error updating ride details:", error);
        throw error;
    }
};

export const assignRideToDriver = async (rideId: string, driver: Driver) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        await updateDoc(rideRef, {
            status: 'assigned',
            driver: driver
        });
    } catch (error) {
        console.error("Error assigning ride:", error);
        throw error;
    }
};

export const unassignRide = async (rideId: string, managerInfo?: { managerId: string; managerName: string; managerPhone: string }) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        const rideSnap = await getDoc(rideRef);

        if (rideSnap.exists()) {
            const rideData = rideSnap.data();
            const studentId = rideData.studentId;

            // Update ride status to dismissed and store manager info
            await updateDoc(rideRef, {
                status: 'dismissed',
                dismissedAt: new Date().toISOString(),
                dismissedBy: managerInfo?.managerId || null,
                managerName: managerInfo?.managerName || 'Manager',
                managerContact: managerInfo?.managerPhone || '',
                studentId: null,
                studentName: null,
                pickupAddress: null,
                driverId: null,
                driver: null
            });

            // Also update the student's currentRideId to null
            if (studentId) {
                const studentRef = doc(db, 'users', studentId);
                await updateDoc(studentRef, {
                    currentRideId: null
                });
            }
        }
    } catch (error) {
        console.error("Error unassigning ride:", error);
        throw error;
    }
};

/**
 * Return a student to the waiting pool (Request Center).
 * Unlike unassignRide, this resets the status to 'requested' so the student
 * can be reassigned to another driver.
 */
export const returnStudentToPool = async (rideId: string) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        const rideSnap = await getDoc(rideRef);

        if (!rideSnap.exists()) {
            throw new Error('Ride not found');
        }

        const rideData = rideSnap.data();
        const studentId = rideData.studentId;

        // Reset ride status to 'requested' and clear driver assignment
        await updateDoc(rideRef, {
            status: 'requested',
            driverId: null,
            driverName: null,
            driver: null,
            carId: null,
            carModel: null,
            carColor: null,
            carLicensePlate: null,
            route: null,
            assignedAt: null,
            unassignedAt: new Date().toISOString()
        });

        // Update the student's status back to waiting
        if (studentId) {
            const studentRef = doc(db, 'users', studentId);
            await updateDoc(studentRef, {
                status: 'waiting',
                currentRideId: null
            });
        }

        console.log(`Student ${studentId} returned to pool from ride ${rideId}`);
    } catch (error) {
        console.error("Error returning student to pool:", error);
        throw error;
    }
};

// Hook to check if student has a dismissed request
export const useStudentRequestStatus = (userId: string) => {
    const [dismissedRequest, setDismissedRequest] = useState<{
        dismissedAt: string;
        managerName: string;
        managerContact: string;
    } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }

        // Query for recently dismissed rides (within last 24 hours)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const q = query(
            collection(db, 'rides'),
            where('studentId', '==', userId),
            where('status', '==', 'dismissed'),
            where('dismissedAt', '>=', yesterday.toISOString())
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const ride = snapshot.docs[0].data();
                setDismissedRequest({
                    dismissedAt: ride.dismissedAt,
                    managerName: ride.managerName,
                    managerContact: ride.managerContact
                });
            } else {
                setDismissedRequest(null);
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching dismissed request:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, [userId]);

    return { dismissedRequest, loading };
};

export const markReadyToLeave = async (rideId: string) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        await updateDoc(rideRef, { isReadyToLeave: true });
    } catch (error) {
        console.error("Error updating status:", error);
    }
};
