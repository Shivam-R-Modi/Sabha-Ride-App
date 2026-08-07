
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, getDoc, getDocs, orderBy, limit, startAfter, DocumentSnapshot } from 'firebase/firestore';
import { Ride, RideStatus, Driver } from '../types';
import { handleSnapshotError } from '../src/utils/firestoreErrors';

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
            // 'completed' is deliberately excluded.
            //
            // It used to be in this list "so the return trip stays visible".
            // But this hook sorts by date and takes the newest match, so once a
            // student had any completed ride, activeRide was non-null forever.
            // StudentDashboard renders the ride card instead of the Request
            // Pickup tile whenever activeRide is set, and there is no other
            // route to the request form — so a single completed ride locked the
            // student out of ever requesting another one.
            //
            // Nothing is lost: the Return Trip tile is rendered separately and
            // gated only on the time window, not on activeRide, and completed
            // rides belong to the history view (useRideHistory).
            where('status', 'in', ['requested', 'assigned', 'driver_en_route', 'arriving', 'in_progress'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            // Most recent in-flight ride. Once the return leg is created by
            // studentReadyToLeave it is 'requested', so it becomes the active
            // ride here and drives the drop-off confirmation state.
            const active = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() } as Ride))
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

            if (active) {
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
            where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress', 'completed'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list: Ride[] = [];
            snapshot.forEach(doc => {
                list.push({ id: doc.id, ...doc.data() } as Ride);
            });
            setRides(list);
            setLoading(false);
        }, handleSnapshotError('useRides', () => setLoading(false)));
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
            where('status', 'in', ['requested', 'assigned', 'driver_en_route', 'arriving', 'in_progress'])
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
        const studentPhone = userData?.phone || details.phone || '';

        // Extract lat/lng — coordinates were saved by AddressAutocomplete during ProfileSetup
        const pickupLat = location?.latitude ?? 0;
        const pickupLng = location?.longitude ?? 0;

        if (pickupLat === 0 && pickupLng === 0) {
            throw new Error('Your address coordinates are missing. Please update your address in Profile.');
        }

        await addDoc(collection(db, 'rides'), {
            studentId: userId,
            studentName: details.studentName || userData?.name || 'Unknown',
            studentPhone,
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

/**
 * Assign a pending request to a driver from the manager dashboard.
 *
 * This used to write exactly `{ status: 'assigned', driver: <object> }` — with
 * no `driverId`. The driver dashboard subscribes with
 * `where('driverId', '==', uid)`, so a ride assigned this way was invisible to
 * the driver it had been assigned to. The manager saw "assigned", the student's
 * card showed a driver's name and car, and nobody was coming.
 *
 * That is the same defect the browser auto-dispatcher was disabled for in
 * 80c3c0e. It survived here because this path is manager-triggered rather than
 * automatic, so it was never part of that hook. It now writes the shape
 * globalAssignDriver writes, including the `students` roster that startRide,
 * releaseAssignment and completeRide all iterate — they silently operated on an
 * empty array otherwise.
 */
export const assignRideToDriver = async (rideId: string, driver: Driver) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        const rideSnap = await getDoc(rideRef);
        if (!rideSnap.exists()) throw new Error('That ride request no longer exists.');

        const ride = rideSnap.data();
        const d = driver as any;

        const carModel = d.carModel || d.currentVehicleName || 'Vehicle';
        const plateNumber = d.plateNumber || d.currentVehiclePlate || '';
        const avatarUrl = d.avatarUrl
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.name || 'Driver')}&background=FF6B35&color=fff`;

        await updateDoc(rideRef, {
            status: 'assigned',
            // The field the driver dashboard actually queries on.
            driverId: driver.id,
            driverName: driver.name || 'Driver',
            // The nested object the student's ride card renders.
            driver: {
                id: driver.id,
                name: driver.name || 'Driver',
                phone: d.phone || '',
                avatarUrl,
                carModel,
                carColor: d.carColor || 'Unknown',
                plateNumber,
            },
            carId: d.currentVehicleId || d.currentCarId || null,
            carModel,
            carColor: d.carColor || 'Unknown',
            carLicensePlate: plateNumber,
            // The roster the ride lifecycle functions iterate.
            students: [{
                id: ride.studentId,
                rideRequestId: rideId,
                name: ride.studentName || 'Student',
                phone: ride.studentPhone || '',
                location: {
                    lat: ride.pickupLat,
                    lng: ride.pickupLng,
                    address: ride.pickupAddress || '',
                },
                status: 'assigned',
                picked: false,
            }],
            assignedStudentIds: ride.studentId ? [ride.studentId] : [],
            assignedAt: new Date().toISOString(),
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

            // Update ride status to dismissed and store manager info (keep studentId so query finds it)
            await updateDoc(rideRef, {
                status: 'dismissed',
                dismissedAt: new Date().toISOString(),
                dismissedBy: managerInfo?.managerId || null,
                managerName: managerInfo?.managerName || 'Manager',
                managerContact: managerInfo?.managerPhone || '',
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

/**
 * Hook to fetch ride history with pagination
 * Returns completed rides for a user, sorted by date (newest first)
 */
export const useRideHistory = (userId: string, pageSize: number = 10) => {
    const [rides, setRides] = useState<Ride[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);

    // Fetch initial page
    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }

        const fetchInitialRides = async () => {
            try {
                setLoading(true);
                const q = query(
                    collection(db, 'rides'),
                    where('studentId', '==', userId),
                    where('status', '==', 'completed'),
                    orderBy('date', 'desc'),
                    limit(pageSize)
                );

                const snapshot = await getDocs(q);
                const fetchedRides = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Ride));

                setRides(fetchedRides);
                setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
                setHasMore(snapshot.docs.length === pageSize);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching ride history:', error);
                setLoading(false);
            }
        };

        fetchInitialRides();
    }, [userId, pageSize]);

    // Load more function
    const loadMore = async () => {
        if (!hasMore || !lastDoc || loading) return;

        try {
            setLoading(true);
            const q = query(
                collection(db, 'rides'),
                where('studentId', '==', userId),
                where('status', '==', 'completed'),
                orderBy('date', 'desc'),
                startAfter(lastDoc),
                limit(pageSize)
            );

            const snapshot = await getDocs(q);
            const fetchedRides = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Ride));

            setRides(prev => [...prev, ...fetchedRides]);
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.docs.length === pageSize);
            setLoading(false);
        } catch (error) {
            console.error('Error loading more rides:', error);
            setLoading(false);
        }
    };

    return { rides, loading, hasMore, loadMore };
};
