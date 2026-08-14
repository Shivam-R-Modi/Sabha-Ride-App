
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { Driver, StudentRequest, User } from '../types';
import { handleSnapshotError } from '../src/utils/firestoreErrors';
import { seatsOf } from '../src/constants/seats';
import { isDispatchable } from '../src/utils/ridePool';
import { useCurrentEvent } from './useCurrentEvent';

/** Same generated avatar the assignment function builds for ride peers. */
const avatarUrlFor = (name: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff`;

// --- Users / Admin ---

export const usePendingDrivers = () => {
    const [pendingDrivers, setPendingDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // `registeredRole`, not `roles`. This queue is "who signed up as a driver
        // and needs approving", which is a question about what someone registered
        // as — whereas `roles` now records everything they may ACT as, so a
        // manager carries 'driver' too and would appear here awaiting a driver
        // approval they never asked for. Managers are approved by the invite path,
        // not from this list.
        const q = query(
            collection(db, 'users'),
            where('registeredRole', '==', 'driver'),
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
        // `registeredRole` for the same reason as the drivers queue above: every
        // role grants 'student', so querying `roles` here would list every pending
        // account regardless of what they signed up as.
        //
        // This queue has always been empty and still is — students self-approve at
        // signup, so no student is ever pending. It is left wired rather than
        // deleted because the safeguarding work may reintroduce approval for
        // minors, and a correct empty query is cheap.
        const q = query(
            collection(db, 'users'),
            where('registeredRole', '==', 'student'),
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

/**
 * The riders a driver could actually be given right now.
 *
 * Scoped to the gathering and direction the server has published, because
 * globalAssignDriver dispatches from exactly that pool. Unscoped, the two
 * disagreed in public: on 2026-08-14 this read "Waiting · 4" while a driver
 * tapping Assign Me was told "Nobody is waiting right now" — four riders queued
 * whom no tap could serve, because they had asked for a pickup and the window had
 * moved to drop-off.
 *
 * A count a manager cannot act on is worse than no count: it sends them looking
 * for a fault in dispatch.
 *
 * Filtered in memory rather than in the query. Adding `eventDate` and `rideType`
 * clauses would need a composite index on rides(status, eventDate, rideType),
 * which does not exist, and a pickup request carries no `rideType` field at all —
 * so a Firestore equality filter would exclude every genuine one. See
 * src/utils/ridePool.ts.
 */
export const usePendingRequests = () => {
    const [requests, setRequests] = useState<StudentRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const { eventId, rideType } = useCurrentEvent();

    useEffect(() => {
        const q = query(collection(db, 'rides'), where('status', '==', 'requested'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list: StudentRequest[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                if (!isDispatchable(data, eventId, rideType)) return;
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
                    // How many people this row is for. Without it the queue reads
                    // as "7 waiting" when it is 7 requests and 14 people, and a
                    // large group that no car can take looks identical to a single
                    // rider who has simply not been picked up yet.
                    seats: seatsOf(data),
                    keepTogether: data.allowSplit === false,
                    // Set on both halves of a group that has been split across
                    // cars, so a part-served family is not mistaken for a new one.
                    groupSeatsTotal: data.groupSeatsTotal ?? undefined,
                    isRemainder: !!data.groupId,
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
        // Re-subscribes when the window flips. With [] the filter would close over
        // the first eventId and rideType it ever saw, so the queue would freeze on
        // the gathering the manager happened to load the page during.
    }, [eventId, rideType]);

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
        // Was `role == 'driver'`, which listed nobody: every driver in this
        // congregation is recorded as a manager, and `role` holds one value. So
        // the manager's "assign to any driver" control could only ever report
        // "No available drivers found", however many were on the road.
        //
        // `roles` is the granted set, so a manager who drives is included.
        const q = query(
            collection(db, 'users'),
            where('roles', 'array-contains', 'driver'),
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
