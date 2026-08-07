/**
 * Security rules tests, run against the Firestore emulator.
 *
 *   npm run test:rules
 *
 * These are assertions about who may do what. They are the only safe way to
 * change firestore.rules: the two failure modes are opposite and both bad —
 * too tight locks real users out mid-Friday, too loose leaves the hole open —
 * and neither is visible by looking at the running site.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, deleteDoc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const STUDENT = 'student_alice';
const OTHER_STUDENT = 'student_bob';
const DRIVER = 'driver_dave';
const MANAGER = 'manager_mira';

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'sabha-rules-test',
        firestore: {
            rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
    });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed with rules disabled so the fixtures themselves aren't under test.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'users', STUDENT), {
            name: 'Alice', email: 'a@x.com', phone: '555', address: '1 Main St',
            role: 'student', registeredRole: 'student', roles: ['student'],
            accountStatus: 'approved',
        });
        await setDoc(doc(db, 'users', OTHER_STUDENT), {
            name: 'Bob', phone: '556', address: '2 Main St',
            role: 'student', roles: ['student'], accountStatus: 'approved',
        });
        await setDoc(doc(db, 'users', DRIVER), {
            name: 'Dave', role: 'driver', roles: ['driver'], accountStatus: 'approved',
        });
        await setDoc(doc(db, 'users', MANAGER), {
            name: 'Mira', role: 'manager', registeredRole: 'manager', roles: ['manager'],
            accountStatus: 'approved',
        });
        await setDoc(doc(db, 'settings', 'managerCode'), { code: 'top-secret-code' });
        await setDoc(doc(db, 'settings', 'main'), { sabhaLocation: { lat: 42, lng: -71 } });
        await setDoc(doc(db, 'rides', 'ride_alice'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
        });
        await setDoc(doc(db, 'system', 'rideContext'), { rideType: 'home-to-sabha' });
        await setDoc(doc(db, 'system', 'assignmentLock'), { driverId: 'x', timestamp: 1 });
    });
});

const asStudent = () => testEnv.authenticatedContext(STUDENT).firestore();
const asDriver = () => testEnv.authenticatedContext(DRIVER).firestore();
const asManager = () => testEnv.authenticatedContext(MANAGER).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

describe('privilege escalation', () => {
    it('a student cannot make themselves a manager', async () => {
        // The whole authorisation model rests on this. isManager() reads
        // role/accountStatus off the caller's own document, so if a user can
        // write those fields they define their own privileges.
        await assertFails(updateDoc(doc(asStudent(), 'users', STUDENT), {
            role: 'manager', registeredRole: 'manager', roles: ['manager'],
        }));
    });

    it('a pending user cannot approve their own account', async () => {
        // Must be tested with a genuinely pending user. Writing 'approved' onto
        // a doc that already says 'approved' produces an empty diff, so
        // affectedKeys() is empty and the guard correctly sees nothing changed.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', 'pending_self'), {
                name: 'Pat', role: 'driver', roles: ['driver'], accountStatus: 'pending',
            });
        });
        const asPending = testEnv.authenticatedContext('pending_self').firestore();
        await assertFails(updateDoc(doc(asPending, 'users', 'pending_self'), {
            accountStatus: 'approved',
        }));
    });

    it('a pending user CAN still complete their own profile', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', 'pending_self2'), {
                name: 'Pat', role: 'driver', roles: ['driver'], accountStatus: 'pending',
            });
        });
        const asPending = testEnv.authenticatedContext('pending_self2').firestore();
        await assertSucceeds(updateDoc(doc(asPending, 'users', 'pending_self2'), {
            address: '9 Elm St', phone: '555-0199',
        }));
    });

    it('a student cannot grant themselves the platform role', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'users', STUDENT), {
            platformRole: 'superManager',
        }));
    });

    it('a student cannot write another user document', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'users', OTHER_STUDENT), { name: 'Hacked' }));
    });

    it('a student CAN still edit their own profile fields', async () => {
        // The rules must not be so tight that normal use breaks.
        await assertSucceeds(updateDoc(doc(asStudent(), 'users', STUDENT), {
            name: 'Alice Patel', phone: '555-0100', address: '3 New St',
        }));
    });
});

describe('escalation at create time', () => {
    // Blocking privilege fields on UPDATE closed only half the hole. A brand-new
    // account has no document, so its first write is a create — and a create
    // could name any role and any accountStatus. Signing up as an approved
    // manager took one console call and no access code.

    it('a new user cannot create themselves as an approved manager', async () => {
        const asNew = testEnv.authenticatedContext('sneaky_new').firestore();
        await assertFails(setDoc(doc(asNew, 'users', 'sneaky_new'), {
            role: 'manager', registeredRole: 'manager', roles: ['manager'],
            activeRole: 'manager', accountStatus: 'approved',
        }));
    });

    it('a new user cannot create themselves as an approved driver', async () => {
        const asNew = testEnv.authenticatedContext('sneaky_driver').firestore();
        await assertFails(setDoc(doc(asNew, 'users', 'sneaky_driver'), {
            role: 'driver', registeredRole: 'driver', roles: ['driver'],
            activeRole: 'driver', accountStatus: 'approved',
        }));
    });

    it('a new user cannot smuggle a manager role in via the roles array', async () => {
        // role says student, roles says otherwise — and hasRole()/isManager()
        // both check the array.
        const asNew = testEnv.authenticatedContext('sneaky_array').firestore();
        await assertFails(setDoc(doc(asNew, 'users', 'sneaky_array'), {
            role: 'student', registeredRole: 'student', roles: ['student', 'manager'],
            activeRole: 'student', accountStatus: 'approved',
        }));
    });

    it('a new user cannot create themselves with a platform role', async () => {
        const asNew = testEnv.authenticatedContext('sneaky_platform').firestore();
        await assertFails(setDoc(doc(asNew, 'users', 'sneaky_platform'), {
            role: 'student', registeredRole: 'student', roles: ['student'],
            activeRole: 'student', accountStatus: 'approved',
            platformRole: 'superManager',
        }));
    });

    it('a new manager CAN be created pending, which is what the callable approves', async () => {
        // verifyManagerCode runs with the Admin SDK and bypasses rules, so it is
        // unaffected either way — but a pending manager must remain a legal
        // client write, since that is the state PendingApproval retries from.
        const asNew = testEnv.authenticatedContext('pending_manager').firestore();
        await assertSucceeds(setDoc(doc(asNew, 'users', 'pending_manager'), {
            role: 'manager', registeredRole: 'manager', roles: ['manager'],
            activeRole: 'manager', accountStatus: 'pending',
        }));
    });
});

describe('signup must still work', () => {
    it('a brand-new student CAN create their approved profile', async () => {
        // RoleSelection writes role, roles, activeRole and accountStatus in one
        // setDoc. Students are auto-approved by product decision — if this
        // breaks, no student can register at all.
        const asNew = testEnv.authenticatedContext('brand_new_user').firestore();
        await assertSucceeds(setDoc(doc(asNew, 'users', 'brand_new_user'), {
            role: 'student', registeredRole: 'student', roles: ['student'],
            activeRole: 'student', accountStatus: 'approved',
            email: 'new@x.com', createdAt: '2026-08-07',
        }));
    });

    it('a new DRIVER can create their profile as pending', async () => {
        const asNew = testEnv.authenticatedContext('brand_new_driver').firestore();
        await assertSucceeds(setDoc(doc(asNew, 'users', 'brand_new_driver'), {
            role: 'driver', registeredRole: 'driver', roles: ['driver'],
            activeRole: 'driver', accountStatus: 'pending',
        }));
    });

    it('a user CAN complete ProfileSetup on their own new profile', async () => {
        // ProfileSetup.tsx:61 setDoc with merge — name, address, location.
        await assertSucceeds(setDoc(doc(asStudent(), 'users', STUDENT), {
            name: 'Alice', address: '5 Oak St',
            location: { latitude: 42.1, longitude: -71.1 },
        }, { merge: true }));
    });

    it('a driver CAN set their own availability and vehicle', async () => {
        // setDriverAvailability / assignVehicleToDriver write status and
        // currentVehicleId on the driver's own doc. Neither is a privilege
        // field, so both must still be allowed.
        await assertSucceeds(updateDoc(doc(asDriver(), 'users', DRIVER), {
            status: 'available', currentVehicleId: 'veh_1',
        }));
    });
});

describe('PII exposure', () => {
    it('a student cannot read another user profile', async () => {
        // users docs hold name, phone, email, home address and coordinates.
        await assertFails(getDoc(doc(asStudent(), 'users', OTHER_STUDENT)));
    });

    it('a student cannot list all users', async () => {
        await assertFails(getDocs(collection(asStudent(), 'users')));
    });

    it('a student CAN read their own profile', async () => {
        await assertSucceeds(getDoc(doc(asStudent(), 'users', STUDENT)));
    });

    it('a manager CAN read a user profile', async () => {
        await assertSucceeds(getDoc(doc(asManager(), 'users', STUDENT)));
    });

    it('an anonymous visitor cannot read anything', async () => {
        await assertFails(getDoc(doc(asAnon(), 'users', STUDENT)));
        await assertFails(getDoc(doc(asAnon(), 'rides', 'ride_alice')));
    });
});

describe('the manager access code', () => {
    it('a student cannot read settings/managerCode', async () => {
        // Reading it is equivalent to becoming a manager: the signup flow
        // accepts the code and self-approves.
        await assertFails(getDoc(doc(asStudent(), 'settings', 'managerCode')));
    });

    it('a student CAN still read the venue settings', async () => {
        // settings/main drives the map and pickup destination for everyone.
        await assertSucceeds(getDoc(doc(asStudent(), 'settings', 'main')));
    });

    it('a student cannot write settings', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'settings', 'main'), { sabhaLocation: { lat: 0, lng: 0 } }));
    });
});

describe('ride integrity', () => {
    it('a student cannot self-assign a driver', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), {
            status: 'assigned', driverId: DRIVER,
        }));
    });

    it('a student cannot mark their own ride completed', async () => {
        // completeRide does vehicle release, driver counters and student status.
        // Letting a client shortcut it corrupts all three.
        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), { status: 'completed' }));
    });

    it('a student cannot create a ride for someone else', async () => {
        await assertFails(setDoc(doc(asStudent(), 'rides', 'forged'), {
            studentId: OTHER_STUDENT, status: 'requested', pickupLat: 1, pickupLng: 1,
        }));
    });

    it('a student CAN create their own ride request', async () => {
        await assertSucceeds(setDoc(doc(asStudent(), 'rides', 'mine'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
        }));
    });

    it('a student CAN cancel their own ride', async () => {
        await assertSucceeds(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), { status: 'cancelled' }));
    });

    it('a student cannot read another student ride', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'rides', 'ride_bob'), {
                studentId: OTHER_STUDENT, status: 'requested', pickupAddress: '2 Main St',
            });
        });
        await assertFails(getDoc(doc(asStudent(), 'rides', 'ride_bob')));
    });

    it('the assigned driver CAN read the ride', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await updateDoc(doc(ctx.firestore(), 'rides', 'ride_alice'), { driverId: DRIVER, status: 'assigned' });
        });
        await assertSucceeds(getDoc(doc(asDriver(), 'rides', 'ride_alice')));
    });
});

describe('server-owned documents', () => {
    it('nobody can write the assignment lock', async () => {
        // globalAssignDriver computes lockAge = now - timestamp and only checks
        // lockAge < TTL. A far-future timestamp makes lockAge negative, which is
        // always under the TTL — one write disables assignment platform-wide.
        await assertFails(setDoc(doc(asStudent(), 'system', 'assignmentLock'), {
            driverId: 'x', timestamp: 9999999999999,
        }));
        await assertFails(setDoc(doc(asManager(), 'system', 'assignmentLock'), {
            driverId: 'x', timestamp: 9999999999999,
        }));
    });

    it('nobody can write the ride context', async () => {
        await assertFails(setDoc(doc(asStudent(), 'system', 'rideContext'), { rideType: 'sabha-to-home' }));
    });

    it('everyone CAN read the ride context', async () => {
        // Drivers and students both render the current window from it.
        await assertSucceeds(getDoc(doc(asStudent(), 'system', 'rideContext')));
        await assertSucceeds(getDoc(doc(asDriver(), 'system', 'rideContext')));
    });

    it('a driver cannot rewrite the audit log', async () => {
        await assertFails(setDoc(doc(asDriver(), 'auditLogs', 'forged'), { action: 'nothing to see' }));
    });
});

describe('manager approval flow still works', () => {
    it('a manager CAN approve a pending driver', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', 'pending_pat'), {
                name: 'Pat', role: 'driver', roles: ['driver'], accountStatus: 'pending',
            });
        });
        await assertSucceeds(updateDoc(doc(asManager(), 'users', 'pending_pat'), {
            accountStatus: 'approved',
        }));
    });

    it('a manager CAN query the pending queue', async () => {
        await assertSucceeds(getDocs(query(
            collection(asManager(), 'users'),
            where('roles', 'array-contains', 'driver'),
            where('accountStatus', '==', 'pending'),
        )));
    });
});

describe('the sabha calendar', () => {
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'events', '2026-08-14'), {
                date: '2026-08-14', startTime: '19:00', endTime: '22:00',
                status: 'scheduled', venue: null, agenda: '',
            });
        });
    });

    it('a student CAN read the calendar', async () => {
        // The dashboard tells riders when the next sabha is.
        await assertSucceeds(getDoc(doc(asStudent(), 'events', '2026-08-14')));
    });

    it('a driver CAN read the calendar', async () => {
        await assertSucceeds(getDoc(doc(asDriver(), 'events', '2026-08-14')));
    });

    it('a student cannot move a sabha', async () => {
        // Changing a gathering's time changes when rides open for everyone.
        await assertFails(updateDoc(doc(asStudent(), 'events', '2026-08-14'), {
            startTime: '06:00',
        }));
    });

    it('a student cannot cancel a sabha', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'events', '2026-08-14'), {
            status: 'cancelled',
        }));
    });

    it('a student cannot invent a sabha', async () => {
        await assertFails(setDoc(doc(asStudent(), 'events', '2026-08-21'), {
            date: '2026-08-21', startTime: '19:00', endTime: '22:00', status: 'scheduled',
        }));
    });

    it('a driver cannot move a sabha either', async () => {
        await assertFails(updateDoc(doc(asDriver(), 'events', '2026-08-14'), {
            startTime: '06:00',
        }));
    });

    it('a manager CAN still schedule and move a sabha', async () => {
        // Regression guard: splitting the old blanket `allow write` into create
        // and update must not break the calendar.
        await assertSucceeds(setDoc(doc(asManager(), 'events', '2026-08-21'), {
            date: '2026-08-21', startTime: '18:00', endTime: '20:00',
            status: 'scheduled', venue: null, agenda: 'Youth sabha',
        }));
        await assertSucceeds(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            startTime: '16:30',
        }));
    });

    it('a manager CANNOT delete a sabha directly — only the callable may', async () => {
        // The new invariant, and the test that would have caught the old
        // `allow write: if isManager()`, since `write` silently includes delete.
        //
        // Deleting the event document does not delete
        // weeklyAttendance/{date}/responses/* — Firestore leaves subcollections
        // behind — and every read path for those derives the id from
        // system/rideContext, so they become unreachable. Outstanding ride
        // requests also have to be cancelled or the next sabha inherits them.
        // deleteSabhaEvent does all of that; a raw delete does none of it.
        await assertFails(deleteDoc(doc(asManager(), 'events', '2026-08-14')));
    });

    it('nobody else can delete a sabha either', async () => {
        await assertFails(deleteDoc(doc(asStudent(), 'events', '2026-08-14')));
        await assertFails(deleteDoc(doc(asDriver(), 'events', '2026-08-14')));
        await assertFails(deleteDoc(doc(asAnon(), 'events', '2026-08-14')));
    });

    it('an anonymous visitor cannot read the calendar', async () => {
        await assertFails(getDoc(doc(asAnon(), 'events', '2026-08-14')));
    });
});

describe('attendance records are server-owned', () => {
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'weeklyAttendance', '2026-08-07'), {
                eventId: '2026-08-07', startsAt: '2026-08-07T23:00:00.000Z',
            });
            await setDoc(doc(db, 'weeklyAttendance', '2026-08-07', 'responses', STUDENT), {
                response: 'yes', studentId: STUDENT, studentName: 'Alice',
            });
        });
    });

    it('a manager CAN read the attendance header', async () => {
        await assertSucceeds(getDoc(doc(asManager(), 'weeklyAttendance', '2026-08-07')));
    });

    it('nobody can write or delete the attendance header, manager included', async () => {
        // Derived state, written only by the scheduler with the Admin SDK. The
        // Database Console renders a delete button for this collection, and
        // deleting the parent would leave every responses/* document behind,
        // invisible to a console that only lists parents. Previously this was
        // denied only by the ABSENCE of a write rule — an accident.
        await assertFails(setDoc(doc(asManager(), 'weeklyAttendance', '2026-08-07'), { eventId: 'x' }));
        await assertFails(deleteDoc(doc(asManager(), 'weeklyAttendance', '2026-08-07')));
        await assertFails(deleteDoc(doc(asStudent(), 'weeklyAttendance', '2026-08-07')));
    });

    it('a student CAN still read and write their own response', async () => {
        await assertSucceeds(getDoc(doc(asStudent(), 'weeklyAttendance', '2026-08-07', 'responses', STUDENT)));
        await assertSucceeds(setDoc(doc(asStudent(), 'weeklyAttendance', '2026-08-07', 'responses', STUDENT), {
            response: 'no', studentId: STUDENT, studentName: 'Alice',
        }));
    });

    it('a student cannot read another student\'s response', async () => {
        await assertFails(getDoc(doc(asStudent(), 'weeklyAttendance', '2026-08-07', 'responses', OTHER_STUDENT)));
    });

    it('the event generator marker is not client-writable', async () => {
        await assertFails(setDoc(doc(asManager(), 'system', 'eventGenerator'), { seededAt: 'now' }));
        await assertFails(setDoc(doc(asStudent(), 'system', 'eventGenerator'), { seededAt: 'now' }));
    });
});
