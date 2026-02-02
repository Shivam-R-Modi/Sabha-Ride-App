import { create } from 'zustand';
import {
    collection,
    doc,
    onSnapshot,
    query,
    where,
    getDocs,
    updateDoc,
    addDoc,
    serverTimestamp,
    deleteDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../firebase/config';
import type {
    Ride,
    RideContext,
    Student,
    Driver,
    Car,
    StudentStatus,
    DriverStatus,
    AssignmentResult,
    EventStatistics,
    Waypoint
} from '../types';

interface RideState {
    // System State
    rideContext: RideContext | null;

    // Student State
    studentData: Student | null;
    studentRide: Ride | null;

    // Driver State
    driverData: Driver | null;
    driverRide: Ride | null;
    availableCars: Car[];

    // Manager State
    allRides: Ride[];
    allStudents: Student[];
    allDrivers: Driver[];
    statistics: EventStatistics | null;

    // UI State
    isLoading: boolean;
    error: string | null;

    // Actions - Student
    initializeStudentListeners: (studentId: string) => () => void;
    requestPickup: (studentId: string) => Promise<void>;
    readyToLeave: (studentId: string) => Promise<void>;
    updateStudentLocation: (studentId: string, location: { lat: number; lng: number; address: string }) => Promise<void>;

    // Actions - Driver
    initializeDriverListeners: (driverId: string) => () => void;
    selectCar: (driverId: string, carId: string) => Promise<void>;
    releaseCar: (driverId: string, carId: string) => Promise<void>;
    assignMe: (driverId: string, carId: string) => Promise<AssignmentResult>;
    acceptRide: (rideId: string) => Promise<void>;
    completeRide: (rideId: string) => Promise<void>;
    doneForToday: (driverId: string, carId: string) => Promise<void>;
    updateDriverLocation: (driverId: string, location: { lat: number; lng: number }) => Promise<void>;
    markWaypointVisited: (rideId: string, waypointIndex: number) => Promise<void>;

    // Actions - Manager
    initializeManagerListeners: () => () => void;
    manualAssignStudent: (studentId: string, driverId: string) => Promise<void>;
    addCar: (carData: Omit<Car, 'id'>) => Promise<string>;
    removeCar: (carId: string) => Promise<void>;
    approveUser: (userId: string) => Promise<void>;
    rejectUser: (userId: string) => Promise<void>;
    exportStatistics: (eventDate: string) => Promise<string>;

    // Actions - Common
    clearError: () => void;
}

export const useRideStore = create<RideState>((set, get) => ({
    // Initial State
    rideContext: null,
    studentData: null,
    studentRide: null,
    driverData: null,
    driverRide: null,
    availableCars: [],
    allRides: [],
    allStudents: [],
    allDrivers: [],
    statistics: null,
    isLoading: false,
    error: null,

    // ==========================================
    // STUDENT ACTIONS
    // ==========================================

    initializeStudentListeners: (studentId: string) => {
        const unsubscribers: (() => void)[] = [];

        // Listen to ride context
        const unsubContext = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (doc) => {
                if (doc.exists()) {
                    set({ rideContext: doc.data() as RideContext });
                }
            },
            (error) => {
                console.error('Error listening to ride context:', error);
            }
        );
        unsubscribers.push(unsubContext);

        // Listen to student data
        const unsubStudent = onSnapshot(
            doc(db, 'students', studentId),
            (doc) => {
                if (doc.exists()) {
                    const student = { id: doc.id, ...doc.data() } as Student;
                    set({ studentData: student });

                    // If student has a current ride, listen to it
                    if (student.currentRideId) {
                        const unsubRide = onSnapshot(
                            doc(db, 'rides', student.currentRideId),
                            (rideDoc) => {
                                if (rideDoc.exists()) {
                                    set({ studentRide: { id: rideDoc.id, ...rideDoc.data() } as Ride });
                                } else {
                                    set({ studentRide: null });
                                }
                            }
                        );
                        unsubscribers.push(unsubRide);
                    } else {
                        set({ studentRide: null });
                    }
                }
            },
            (error) => {
                console.error('Error listening to student data:', error);
            }
        );
        unsubscribers.push(unsubStudent);

        // Return cleanup function
        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    },

    requestPickup: async (studentId: string) => {
        set({ isLoading: true, error: null });
        try {
            await updateDoc(doc(db, 'students', studentId), {
                pickupRequested: true,
                status: 'waiting_for_pickup',
            });
            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error requesting pickup:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    readyToLeave: async (studentId: string) => {
        set({ isLoading: true, error: null });
        try {
            await updateDoc(doc(db, 'students', studentId), {
                dropoffRequested: true,
                status: 'waiting_for_dropoff',
            });
            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error marking ready to leave:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    updateStudentLocation: async (studentId: string, location: { lat: number; lng: number; address: string }) => {
        try {
            await updateDoc(doc(db, 'students', studentId), {
                location,
            });
        } catch (error: any) {
            console.error('Error updating student location:', error);
            throw error;
        }
    },

    // ==========================================
    // DRIVER ACTIONS
    // ==========================================

    initializeDriverListeners: (driverId: string) => {
        const unsubscribers: (() => void)[] = [];

        // Listen to ride context
        const unsubContext = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (doc) => {
                if (doc.exists()) {
                    set({ rideContext: doc.data() as RideContext });
                }
            }
        );
        unsubscribers.push(unsubContext);

        // Listen to driver data
        const unsubDriver = onSnapshot(
            doc(db, 'drivers', driverId),
            (doc) => {
                if (doc.exists()) {
                    const driver = { id: doc.id, ...doc.data() } as Driver;
                    set({ driverData: driver });

                    // If driver has an active ride, listen to it
                    if (driver.activeRideId) {
                        const unsubRide = onSnapshot(
                            doc(db, 'rides', driver.activeRideId),
                            (rideDoc) => {
                                if (rideDoc.exists()) {
                                    set({ driverRide: { id: rideDoc.id, ...rideDoc.data() } as Ride });
                                } else {
                                    set({ driverRide: null });
                                }
                            }
                        );
                        unsubscribers.push(unsubRide);
                    } else {
                        set({ driverRide: null });
                    }
                }
            }
        );
        unsubscribers.push(unsubDriver);

        // Listen to available cars
        const unsubCars = onSnapshot(
            query(collection(db, 'cars'), where('status', '==', 'available')),
            (snapshot) => {
                const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Car));
                set({ availableCars: cars });
            }
        );
        unsubscribers.push(unsubCars);

        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    },

    selectCar: async (driverId: string, carId: string) => {
        set({ isLoading: true, error: null });
        try {
            // Update car status
            await updateDoc(doc(db, 'cars', carId), {
                status: 'in_use',
                assignedDriverId: driverId,
            });

            // Update driver data
            await updateDoc(doc(db, 'drivers', driverId), {
                currentCarId: carId,
                status: 'ready_for_assignment',
            });

            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error selecting car:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    releaseCar: async (driverId: string, carId: string) => {
        set({ isLoading: true, error: null });
        try {
            // Update car status
            await updateDoc(doc(db, 'cars', carId), {
                status: 'available',
                assignedDriverId: null,
            });

            // Update driver data
            await updateDoc(doc(db, 'drivers', driverId), {
                currentCarId: null,
                status: 'offline',
            });

            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error releasing car:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    assignMe: async (driverId: string, carId: string): Promise<AssignmentResult> => {
        set({ isLoading: true, error: null });
        try {
            // Get current ride context
            const rideContextDoc = await getDocs(collection(db, 'system'));
            const rideContext = rideContextDoc.docs.find(d => d.id === 'rideContext')?.data();

            if (!rideContext || !rideContext.rideType) {
                throw new Error('No rides available at this time');
            }

            // Get driver info
            const driverDoc = await getDocs(collection(db, 'drivers'));
            const driver = driverDoc.docs.find(d => d.id === driverId)?.data();

            if (!driver) {
                throw new Error('Driver not found');
            }

            // Get car info
            const carDoc = await getDocs(collection(db, 'cars'));
            const car = carDoc.docs.find(c => c.id === carId)?.data();

            if (!car) {
                throw new Error('Car not found');
            }

            // Get waiting students
            const waitingStatus = rideContext.rideType === 'home-to-sabha'
                ? 'waiting_for_pickup'
                : 'waiting_for_dropoff';

            const studentsQuery = query(
                collection(db, 'students'),
                where('status', '==', waitingStatus)
            );
            const studentsSnapshot = await getDocs(studentsQuery);

            if (studentsSnapshot.empty) {
                return { success: false, message: 'No students waiting for assignment' };
            }

            // Simple assignment: take up to car capacity students
            const availableStudents = studentsSnapshot.docs.slice(0, car.capacity);

            if (availableStudents.length === 0) {
                return { success: false, message: 'No students available' };
            }

            // Create ride
            const rideRef = doc(collection(db, 'rides'));
            const eventDate = new Date().toISOString().split('T')[0];

            const students: any[] = availableStudents.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                location: doc.data().location,
                picked: false,
            }));

            // Create simple route
            const route: Waypoint[] = [
                {
                    lat: driver.currentLocation?.lat || 0,
                    lng: driver.currentLocation?.lng || 0,
                    name: 'Start',
                    type: 'start',
                    visited: false,
                },
                ...students.map((s, idx) => ({
                    lat: s.location.lat,
                    lng: s.location.lng,
                    name: s.name,
                    type: rideContext.rideType === 'home-to-sabha' ? 'pickup' as const : 'dropoff' as const,
                    studentId: s.id,
                    visited: false,
                })),
                {
                    lat: rideContext.rideType === 'home-to-sabha' ? 40.5186 : driver.homeLocation?.lat || 0,
                    lng: rideContext.rideType === 'home-to-sabha' ? -74.3491 : driver.homeLocation?.lng || 0,
                    name: rideContext.rideType === 'home-to-sabha' ? 'Sabha Location' : 'Driver Home',
                    type: 'end',
                    visited: false,
                },
            ];

            const ride: Omit<Ride, 'id'> = {
                eventDate,
                driverId,
                driverName: driver.name,
                carId,
                carModel: car.model,
                carColor: car.color,
                carLicensePlate: car.licensePlate,
                rideType: rideContext.rideType,
                status: 'assigned',
                students,
                route,
                estimatedDistance: 0,
                estimatedTime: 0,
                startedAt: null,
                completedAt: null,
                allWaypointsVisited: false,
            };

            await setDoc(rideRef, ride);

            // Update driver
            await updateDoc(doc(db, 'drivers', driverId), {
                status: 'assigned',
                activeRideId: rideRef.id,
            });

            // Update students
            for (const student of availableStudents) {
                await updateDoc(doc(db, 'students', student.id), {
                    status: 'assigned',
                    currentRideId: rideRef.id,
                });
            }

            set({ isLoading: false });

            return {
                success: true,
                rideId: rideRef.id,
                assignment: {
                    rideNumber: rideRef.id.slice(-6),
                    rideType: rideContext.rideType,
                    studentCount: students.length,
                    capacity: car.capacity,
                    estimatedDistance: 0,
                    estimatedTime: 0,
                    route,
                },
            };
        } catch (error: any) {
            console.error('Error in assignMe:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    acceptRide: async (rideId: string) => {
        set({ isLoading: true, error: null });
        try {
            await updateDoc(doc(db, 'rides', rideId), {
                status: 'in_progress',
                startedAt: new Date().toISOString(),
            });

            // Update driver status
            const ride = get().driverRide;
            if (ride) {
                await updateDoc(doc(db, 'drivers', ride.driverId), {
                    status: 'active_ride',
                });
            }

            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error accepting ride:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    completeRide: async (rideId: string) => {
        set({ isLoading: true, error: null });
        try {
            const ride = get().driverRide;
            if (!ride) throw new Error('No active ride');

            await updateDoc(doc(db, 'rides', rideId), {
                status: 'completed',
                completedAt: new Date().toISOString(),
            });

            // Update driver stats
            const driverRef = doc(db, 'drivers', ride.driverId);
            const driverDoc = await getDoc(driverRef);
            const driver = driverDoc.data();

            if (driver) {
                await updateDoc(driverRef, {
                    status: 'ready_for_assignment',
                    activeRideId: null,
                    ridesCompletedToday: (driver.ridesCompletedToday || 0) + 1,
                    totalStudentsToday: (driver.totalStudentsToday || 0) + ride.students.length,
                });
            }

            // Update students
            for (const student of ride.students) {
                const newStatus = ride.rideType === 'home-to-sabha' ? 'at_sabha' : 'home_safe';
                await updateDoc(doc(db, 'students', student.id), {
                    status: newStatus,
                    currentRideId: null,
                });
            }

            set({ isLoading: false, driverRide: null });
        } catch (error: any) {
            console.error('Error completing ride:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    doneForToday: async (driverId: string, carId: string) => {
        set({ isLoading: true, error: null });
        try {
            // Release car
            await updateDoc(doc(db, 'cars', carId), {
                status: 'available',
                assignedDriverId: null,
            });

            // Update driver
            await updateDoc(doc(db, 'drivers', driverId), {
                currentCarId: null,
                status: 'offline',
                activeRideId: null,
            });

            set({ isLoading: false, driverRide: null });
        } catch (error: any) {
            console.error('Error marking done for today:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    updateDriverLocation: async (driverId: string, location: { lat: number; lng: number }) => {
        try {
            await updateDoc(doc(db, 'drivers', driverId), {
                currentLocation: location,
            });
        } catch (error: any) {
            console.error('Error updating driver location:', error);
        }
    },

    markWaypointVisited: async (rideId: string, waypointIndex: number) => {
        try {
            const rideRef = doc(db, 'rides', rideId);
            const rideDoc = await getDoc(rideRef);

            if (!rideDoc.exists()) return;

            const ride = rideDoc.data() as Ride;
            const route = [...ride.route];
            route[waypointIndex].visited = true;

            // Check if all waypoints visited
            const allVisited = route.every(w => w.visited);

            await updateDoc(rideRef, {
                route,
                allWaypointsVisited: allVisited,
            });

            // If student waypoint, mark student as picked
            const waypoint = route[waypointIndex];
            if (waypoint.studentId && (waypoint.type === 'pickup' || waypoint.type === 'dropoff')) {
                const studentIndex = ride.students.findIndex(s => s.id === waypoint.studentId);
                if (studentIndex >= 0) {
                    const students = [...ride.students];
                    students[studentIndex].picked = true;
                    await updateDoc(rideRef, { students });
                }

                await updateDoc(doc(db, 'students', waypoint.studentId), {
                    status: waypoint.type === 'pickup' ? 'in_ride' : 'home_safe',
                });
            }
        } catch (error: any) {
            console.error('Error marking waypoint visited:', error);
        }
    },

    // ==========================================
    // MANAGER ACTIONS
    // ==========================================

    initializeManagerListeners: () => {
        const unsubscribers: (() => void)[] = [];

        // Listen to all rides for today
        const today = new Date().toISOString().split('T')[0];
        const unsubRides = onSnapshot(
            query(collection(db, 'rides'), where('eventDate', '==', today)),
            (snapshot) => {
                const rides = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ride));
                set({ allRides: rides });
            }
        );
        unsubscribers.push(unsubRides);

        // Listen to all students
        const unsubStudents = onSnapshot(
            collection(db, 'students'),
            (snapshot) => {
                const students = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
                set({ allStudents: students });
            }
        );
        unsubscribers.push(unsubStudents);

        // Listen to all drivers
        const unsubDrivers = onSnapshot(
            collection(db, 'drivers'),
            (snapshot) => {
                const drivers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Driver));
                set({ allDrivers: drivers });
            }
        );
        unsubscribers.push(unsubDrivers);

        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    },

    manualAssignStudent: async (studentId: string, driverId: string) => {
        set({ isLoading: true, error: null });
        try {
            // Get student
            const studentDoc = await getDoc(doc(db, 'students', studentId));
            if (!studentDoc.exists()) throw new Error('Student not found');
            const student = studentDoc.data() as Student;

            // Get driver's active ride
            const driverDoc = await getDoc(doc(db, 'drivers', driverId));
            if (!driverDoc.exists()) throw new Error('Driver not found');
            const driver = driverDoc.data() as Driver;

            if (!driver.activeRideId) {
                throw new Error('Driver does not have an active ride');
            }

            // Get ride
            const rideDoc = await getDoc(doc(db, 'rides', driver.activeRideId));
            if (!rideDoc.exists()) throw new Error('Ride not found');
            const ride = rideDoc.data() as Ride;

            // Check capacity
            if (ride.students.length >= ride.carCapacity) {
                throw new Error('Ride is at capacity');
            }

            // Add student to ride
            const updatedStudents = [...ride.students, {
                id: studentId,
                name: student.name,
                location: student.location,
                picked: false,
            }];

            await updateDoc(doc(db, 'rides', driver.activeRideId), {
                students: updatedStudents,
            });

            // Update student
            await updateDoc(doc(db, 'students', studentId), {
                status: 'assigned',
                currentRideId: driver.activeRideId,
            });

            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error in manual assign:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    addCar: async (carData: Omit<Car, 'id'>) => {
        set({ isLoading: true, error: null });
        try {
            const carRef = doc(collection(db, 'cars'));
            await setDoc(carRef, {
                ...carData,
                status: 'available',
                assignedDriverId: null,
            });
            set({ isLoading: false });
            return carRef.id;
        } catch (error: any) {
            console.error('Error adding car:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    removeCar: async (carId: string) => {
        set({ isLoading: true, error: null });
        try {
            const carDoc = await getDoc(doc(db, 'cars', carId));
            if (!carDoc.exists()) throw new Error('Car not found');

            const car = carDoc.data() as Car;
            if (car.status === 'in_use') {
                throw new Error('Cannot remove car that is currently in use');
            }

            await deleteDoc(doc(db, 'cars', carId));
            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error removing car:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    approveUser: async (userId: string) => {
        set({ isLoading: true, error: null });
        try {
            await updateDoc(doc(db, 'users', userId), {
                accountStatus: 'approved',
            });
            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error approving user:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    rejectUser: async (userId: string) => {
        set({ isLoading: true, error: null });
        try {
            await updateDoc(doc(db, 'users', userId), {
                accountStatus: 'rejected',
            });
            set({ isLoading: false });
        } catch (error: any) {
            console.error('Error rejecting user:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    exportStatistics: async (eventDate: string): Promise<string> => {
        // Generate CSV content
        const { allRides, allStudents } = get();

        const pickupRides = allRides.filter(r => r.rideType === 'home-to-sabha' && r.status === 'completed');
        const dropoffRides = allRides.filter(r => r.rideType === 'sabha-to-home' && r.status === 'completed');

        let csv = 'Student Name,Pickup Driver,Pickup Car,Dropoff Driver,Dropoff Car\n';

        for (const student of allStudents) {
            const pickupRide = pickupRides.find(r => r.students.some(s => s.id === student.id));
            const dropoffRide = dropoffRides.find(r => r.students.some(s => s.id === student.id));

            csv += `${student.name},`;
            csv += pickupRide ? `${pickupRide.driverName},${pickupRide.carModel}` : ',';
            csv += ',';
            csv += dropoffRide ? `${dropoffRide.driverName},${dropoffRide.carModel}` : ',';
            csv += '\n';
        }

        return csv;
    },

    clearError: () => set({ error: null }),
}));

// Import needed functions
import { setDoc } from 'firebase/firestore';
