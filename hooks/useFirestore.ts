
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, setDoc, getDocs } from '@firebase/firestore';
import { Ride, RideStatus, Driver, Vehicle, DriverAssignment, StudentRequest } from '../types';
import { VENUE_ADDRESS } from '../constants';

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
        await addDoc(collection(db, 'rides'), {
            studentId: userId,
            studentName: details.studentName || 'Unknown', // Ensure name is saved
            date: details.date,
            timeSlot: details.time,
            pickupAddress: details.address,
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

export const unassignRide = async (rideId: string) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        await updateDoc(rideRef, {
            status: 'requested',
            driver: null as any
        });
    } catch (error) {
        console.error("Error unassigning ride:", error);
        throw error;
    }
};

export const markReadyToLeave = async (rideId: string) => {
    try {
        const rideRef = doc(db, 'rides', rideId);
        await updateDoc(rideRef, { isReadyToLeave: true });
    } catch (error) {
        console.error("Error updating status:", error);
    }
};

// --- Users / Admin ---

export const usePendingDrivers = () => {
    const [pendingDrivers, setPendingDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'users'),
            where('role', '==', 'driver'),
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

// --- Vehicle Management ---

export const useVehicles = () => {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(collection(db, 'vehicles'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const vList: Vehicle[] = [];
            snapshot.forEach((doc) => vList.push({ id: doc.id, ...doc.data() } as Vehicle));
            setVehicles(vList);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    return { vehicles, loading };
};

export const useAvailableVehicles = () => {
    const [availableVehicles, setAvailableVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(collection(db, 'vehicles'), where('status', '==', 'available'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const vList: Vehicle[] = [];
            snapshot.forEach((doc) => vList.push({ id: doc.id, ...doc.data() } as Vehicle));
            setAvailableVehicles(vList);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    return { availableVehicles, loading };
};

export const addVehicle = async (vehicleData: Omit<Vehicle, 'id'>) => {
    try {
        await addDoc(collection(db, 'vehicles'), vehicleData);
    } catch (error) {
        console.error("Error adding vehicle:", error);
        throw error;
    }
};

export const updateVehicle = async (id: string, data: Partial<Vehicle>) => {
    try {
        const ref = doc(db, 'vehicles', id);
        await updateDoc(ref, data);
    } catch (error) {
        console.error("Error updating vehicle:", error);
        throw error;
    }
};

export const deleteVehicle = async (id: string) => {
    try {
        await deleteDoc(doc(db, 'vehicles', id));
    } catch (error) {
        console.error("Error deleting vehicle:", error);
        throw error;
    }
};

export const assignVehicleToDriver = async (vehicle: Vehicle, driverId: string, driverName: string) => {
    try {
        // 1. Mark vehicle as in-use
        const vehicleRef = doc(db, 'vehicles', vehicle.id);
        await updateDoc(vehicleRef, {
            status: 'in-use',
            currentDriverId: driverId,
            currentDriverName: driverName
        });

        // 2. Update driver profile with current vehicle ID
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, {
            currentVehicleId: vehicle.id,
            carModel: vehicle.name,
            carColor: vehicle.color,
            plateNumber: vehicle.plateNumber,
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
        // 1. Mark vehicle as available
        const vehicleRef = doc(db, 'vehicles', vehicleId);
        await updateDoc(vehicleRef, {
            status: 'available',
            currentDriverId: null,
            currentDriverName: null as any
        });

        // 2. Clear from driver profile
        const userRef = doc(db, 'users', driverId);
        await updateDoc(userRef, {
            currentVehicleId: null as any,
            carModel: null as any,
            carColor: null as any,
            plateNumber: null as any,
            capacity: 0,
            status: 'active' // actually offline, but let's keep status simple
        });
    } catch (error) {
        console.error("Error releasing vehicle:", error);
        throw error;
    }
};

// --- Driver Dashboard Data ---

export const useDriverAssignments = (driverId: string) => {
    const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!driverId) return;

        // Watch for rides where I am the pickup driver or the return driver
        const q = query(
            collection(db, 'rides'),
            where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'completed'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const pickupRides: Ride[] = [];
            const dropoffRides: Ride[] = [];

            snapshot.forEach(doc => {
                const ride = { id: doc.id, ...doc.data() } as Ride;
                // Pickup check
                if (ride.driver?.id === driverId) {
                    pickupRides.push(ride);
                }
                // Dropoff check
                if (ride.returnDriver?.id === driverId) {
                    dropoffRides.push(ride);
                }
            });

            const newAssignments: DriverAssignment[] = [];

            // Group Pickup Rides into one Assignment (Simplified: All current pickups are one round)
            // In a real app, you'd group by Date/TimeSlot
            const activePickups = pickupRides.filter(r => r.status !== 'completed' && r.status !== 'cancelled');
            if (activePickups.length > 0) {
                newAssignments.push({
                    id: 'pickup_round_1',
                    type: 'pickup',
                    date: activePickups[0].date,
                    status: 'active',
                    passengers: activePickups.map((r, idx) => ({
                        ...r, // ride has studentId, studentName etc? No, User details are spread or fetched. 
                        // Simplified: Assuming ride stores student snapshot. If not, we map what we have.
                        id: r.id, // Using Ride ID as passenger key for now to avoid complexity
                        name: (r as any).studentName || "Student",
                        address: r.pickupAddress,
                        phone: (r as any).studentPhone || "",
                        avatarUrl: (r as any).studentAvatarUrl || "",
                        stopStatus: r.status === 'completed' ? 'completed' : 'pending',
                        sequenceOrder: idx + 1,
                        eta: '5:30 PM'
                    })),
                    totalDistance: `${activePickups.length * 2.5} mi`,
                    totalTime: `${activePickups.length * 10} min`,
                    venueAddress: VENUE_ADDRESS
                });
            }

            // Group Dropoff Rides
            // For dropoff, these are rides where isReadyToLeave is true and returnDriver is me
            const activeDropoffs = dropoffRides.filter(r => r.isReadyToLeave);
            if (activeDropoffs.length > 0) {
                newAssignments.push({
                    id: 'dropoff_round_1',
                    type: 'dropoff',
                    date: activeDropoffs[0].date,
                    status: 'pending',
                    passengers: activeDropoffs.map((r, idx) => ({
                        id: r.id,
                        name: (r as any).studentName || "Student",
                        address: r.pickupAddress, // Destination is home
                        phone: (r as any).studentPhone || "",
                        avatarUrl: (r as any).studentAvatarUrl || "",
                        stopStatus: 'pending',
                        sequenceOrder: idx + 1,
                        eta: '8:30 PM'
                    })),
                    totalDistance: `${activeDropoffs.length * 3} mi`,
                    totalTime: `${activeDropoffs.length * 12} min`,
                    venueAddress: VENUE_ADDRESS
                });
            }

            setAssignments(newAssignments);
            setLoading(false);
        });

        return unsubscribe;
    }, [driverId]);

    return { assignments, loading };
};


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
