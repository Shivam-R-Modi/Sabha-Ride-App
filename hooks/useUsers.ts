
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { writeAuditLog } from '../src/utils/audit';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { Driver, StudentRequest, User } from '../types';
import { handleSnapshotError } from '../src/utils/firestoreErrors';
import { seatsOf } from '../src/constants/seats';
import { isDispatchable } from '../src/utils/ridePool';
import { locationOfRide } from '../src/utils/locations';
import { useLocations } from './useLocations';
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
 * Bhulka who have asked to become a Sarthi.
 *
 * ON THE USER DOCUMENT, NOT A COLLECTION OF ITS OWN
 * ------------------------------------------------
 * A rider cannot write their own role fields — `touchesPrivilegeFields()` in
 * firestore.rules blocks all six — but they CAN write any other field on their
 * own document. So the request needs no new collection, no new rules block and no
 * composite index: Firestore indexes nested map fields on its own, and the
 * manager's row already carries the name, phone and address this queue wants to
 * show, with no join.
 *
 * The rules do pin the SHAPE a rider may write, and that is not paranoia about
 * escalation — the field grants nothing. It is that a forged
 * `status: 'approved'` would make the rider's own screen and this queue disagree,
 * and a request that has silently answered itself is precisely the failure mode
 * this app keeps having to remove.
 *
 * `handleSnapshotError` is not optional. A listener with no error callback is how
 * the whole driver-approval queue became silently invisible for want of an index:
 * it rendered as "nobody is waiting", which is indistinguishable from working.
 */
export const useRoleUpgradeRequests = () => {
    const [requests, setRequests] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(
            collection(db, 'users'),
            where('roleUpgrade.status', '==', 'pending')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list: User[] = [];
            snapshot.forEach((doc) => {
                list.push({ id: doc.id, ...doc.data() } as User);
            });
            setRequests(list);
            setLoading(false);
        }, handleSnapshotError('useRoleUpgradeRequests', () => setLoading(false)));

        return unsubscribe;
    }, []);

    return { requests, loading };
};

/**
 * A Bhulku asks to become a Sarthi.
 *
 * A plain field write, not a callable: it grants nothing, so there is nothing for
 * a server to guard. What it must NOT do is claim an outcome — the status a rider
 * may write is `pending` and firestore.rules holds them to it.
 *
 * Writing the whole map rather than merging a field keeps a previous rejection
 * from surviving underneath a new request, which would show the person both "we
 * are looking at this" and "you were turned down" at once.
 */
export const requestRoleUpgrade = async (userId: string) => {
    await updateDoc(doc(db, 'users', userId), {
        roleUpgrade: { status: 'pending', requestedAt: new Date().toISOString() },
    });
};

/**
 * The rider takes it back, or clears a rejection they have read.
 *
 * `null`, not a field delete, and the same value for both: the rules have to
 * validate what a rider may put here, and `== null` is one clause where telling an
 * absent field from a deleted one is three. Nothing reads the difference.
 */
export const clearRoleUpgradeRequest = async (userId: string) => {
    await updateDoc(doc(db, 'users', userId), { roleUpgrade: null });
};

/**
 * A manager turns a request down.
 *
 * Not the callable, because nothing about the person's access changes — the
 * callable exists for the atomic four-field write and the car and rides that come
 * with it, and none of that applies here. Same shape as `updateUserStatus`
 * directly below: a direct write, then a row naming who decided.
 *
 * `actor` is REQUIRED, not defaulted, for the reason that function gives: a row
 * whose actor is 'Manager' or '' looks like a record and identifies nobody.
 *
 * The rejection is LEFT ON THE DOCUMENT rather than clearing the request. A
 * decline that just makes the request vanish tells the rider nothing, so they ask
 * again, and again — the dead-end this app has spent releases removing. They can
 * dismiss it themselves once they have seen it.
 */
export const declineRoleUpgrade = async (
    userId: string,
    requestedAt: string | undefined,
    actor: { uid: string; name: string },
) => {
    await updateDoc(doc(db, 'users', userId), {
        roleUpgrade: {
            status: 'rejected',
            requestedAt: requestedAt ?? new Date().toISOString(),
            decidedAt: new Date().toISOString(),
            decidedBy: actor.uid,
            decidedByName: actor.name,
        },
    });

    // After the write, so a refused update leaves no row claiming it happened.
    // `doc.update` rather than a new action: no role changed, and the summary is
    // what a human reads. Adding vocabulary for a decision that alters nothing
    // would split the trail for no gain.
    await writeAuditLog({
        action: 'doc.update',
        actorUid: actor.uid,
        actorName: actor.name,
        targetCollection: 'users',
        targetDocumentId: userId,
        summary: 'Declined a request to become a Sarthi',
    });
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
    /**
     * The halls, so a row can NAME the one it is for.
     *
     * Not to filter by — every hall's riders belong in this queue, because a manager
     * oversees both. What a manager cannot currently see is WHICH, and the consequence
     * is a wasted tap: `manualAssignStudent` refuses to add a rider to a Sarthi's car
     * when the halls differ, so a manager assigning by hand gets an error the screen
     * could have prevented.
     *
     * `hallNames` rather than the records, so a re-render of the list does not depend
     * on the identity of the array.
     */
    const { active: openHalls } = useLocations();
    const hallNames = openHalls.map(h => `${h.id}:${h.name}`).join('|');

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
                    // How this rider established they were at the sabha, on a
                    // return request. Presence is advisory — nobody is ever
                    // blocked — so carrying it to the manager's board is the only
                    // thing that makes an implausible claim visible rather than
                    // silent. Absent on pickups and on anything an older client
                    // created.
                    presence: data.presence ?? undefined,
                    /**
                     * Which sabha this rider is going to, NAMED rather than as an id —
                     * the queue is read by a person, and `boston-huntington` is not a
                     * place anybody calls it.
                     *
                     * Only when more than one hall is open, so nothing changes on the
                     * screen until it means something. Absent when the request names a
                     * hall that is no longer open, which the row should not silently
                     * relabel — `verify` in scripts/locations.cjs is what finds those.
                     */
                    locationId: locationOfRide(data) ?? undefined,
                    locationName: openHalls.length > 1
                        ? openHalls.find(h => h.id === locationOfRide(data))?.name
                        : undefined,
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
        // `hallNames` rather than the array: the hook returns a fresh array on every
        // snapshot, and depending on it would resubscribe the rides listener whenever
        // any hall document was touched.
    }, [eventId, rideType, hallNames]);

    return { requests, loading };
};

/**
 * Approve or reject an account, and RECORD IT.
 *
 * The write itself is one field. What was missing is the trace: `manager.promote`
 * audited a grant and nothing audited the other direction, so cutting an account
 * off left no record of who did it or when — on a system holding children's names,
 * phone numbers and addresses, where
 * docs/compliance/ownership-and-handover.md requires "every grant, revocation and
 * impersonation audited".
 *
 * `actor` is REQUIRED, not defaulted. An audit row whose actor is 'Manager' or ''
 * is worse than none: it looks like a record and identifies nobody.
 *
 * WHAT THIS STILL DOES NOT DO, deliberately, rather than half-doing it:
 * rejecting a manager does not clear their `mgr` custom claim, because a client
 * cannot — that needs the Admin SDK. `isManagerForRead()` accepts that claim for up
 * to an hour, so a just-revoked manager keeps READ access to rider lists for that
 * long. Every write, delete and secret read is already on `isManager()`, which
 * re-reads the document and so cuts them off immediately. The remedy today is
 * `node scripts/mint-manager-claims.cjs`, which reconciles claims from documents and
 * revokes refresh tokens. A callable that does it automatically is the real fix and
 * is not this change.
 */
export const updateUserStatus = async (
    userId: string,
    status: 'approved' | 'rejected',
    actor: { uid: string; name: string },
) => {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, { accountStatus: status });

        // After the write, so a refused update leaves no row claiming it happened.
        await writeAuditLog({
            action: status === 'approved' ? 'account.approved' : 'account.rejected',
            actorUid: actor.uid,
            actorName: actor.name,
            targetCollection: 'users',
            targetDocumentId: userId,
            summary: status === 'approved'
                ? 'Approved an account'
                : 'Rejected an account, cutting off access',
        });
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
