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
import { addDoc, doc, deleteDoc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';

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
        await setDoc(doc(db, 'settings', 'main'), { sabhaLocation: { lat: 42, lng: -71 } });
        await setDoc(doc(db, 'rides', 'ride_alice'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
        });
        await setDoc(doc(db, 'system', 'rideContext'), { rideType: 'home-to-sabha' });
        await setDoc(doc(db, 'system', 'assignmentLock'), { driverId: 'x', timestamp: 1 });

        // Legacy per-role mirrors. Seeded deliberately: the point of the tests
        // below is that documents which DO exist stay unreadable, not merely
        // that a read of a missing path fails.
        await setDoc(doc(db, 'students', STUDENT), {
            name: 'Alice', phone: '555', address: '1 Main St',
        });
        await setDoc(doc(db, 'drivers', DRIVER), {
            name: 'Dave', phone: '557', address: '3 Main St',
        });
    });
});

const asStudent = () => testEnv.authenticatedContext(STUDENT).firestore();
const asDriver = () => testEnv.authenticatedContext(DRIVER).firestore();
const asManager = () => testEnv.authenticatedContext(MANAGER).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

describe('a role counts however it is recorded', () => {
    // isManager/isDriver/isStudent each spelled the role test out separately, so
    // the four fields could drift apart one helper at a time. These pin each
    // field on its own BEFORE the helpers are collapsed onto a shared one, so the
    // refactor is guarded cell by cell rather than by "the suite still passes".
    //
    // The probe is a manager-only WRITE (settings/main). It has to be a write:
    // manager reads now also accept a custom claim, so a read cannot isolate the
    // document path, and these tests are about what the DOCUMENT records.

    const asUid = (uid: string) => testEnv.authenticatedContext(uid).firestore();

    const seedUser = async (uid: string, data: Record<string, unknown>) => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', uid), data);
        });
    };

    it('manager recorded in `role` alone is a manager', async () => {
        await seedUser('m_role', { role: 'manager', accountStatus: 'approved' });
        await assertSucceeds(updateDoc(doc(asUid('m_role'), 'settings', 'main'), { sabhaStartTime: '19:00' }));
    });

    it('manager recorded in `registeredRole` alone is a manager', async () => {
        await seedUser('m_reg', { registeredRole: 'manager', accountStatus: 'approved' });
        await assertSucceeds(updateDoc(doc(asUid('m_reg'), 'settings', 'main'), { sabhaStartTime: '19:00' }));
    });

    it('manager recorded in `roles[]` alone is a manager', async () => {
        await seedUser('m_arr', { roles: ['manager'], accountStatus: 'approved' });
        await assertSucceeds(updateDoc(doc(asUid('m_arr'), 'settings', 'main'), { sabhaStartTime: '19:00' }));
    });

    it('manager in `activeRole` alone is NOT a manager', async () => {
        // activeRole is a UI preference, not authority. A user cannot even write
        // it — touchesPrivilegeFields() denies it — so treating it as a grant
        // would be trusting a field the app cannot keep current.
        await seedUser('m_active', { activeRole: 'manager', accountStatus: 'approved' });
        await assertFails(updateDoc(doc(asUid('m_active'), 'settings', 'main'), { sabhaStartTime: '19:00' }));
    });

    it('none of the four grants manager without approval', async () => {
        await seedUser('m_pending', {
            role: 'manager', registeredRole: 'manager', roles: ['manager'],
            accountStatus: 'pending',
        });
        await assertFails(updateDoc(doc(asUid('m_pending'), 'settings', 'main'), { sabhaStartTime: '19:00' }));
    });

    it('a driver is not a manager, however it is recorded', async () => {
        // The hierarchy expands downward only. Nothing below manager implies it.
        await seedUser('d_all', {
            role: 'driver', registeredRole: 'driver', roles: ['driver'],
            accountStatus: 'approved',
        });
        await assertFails(updateDoc(doc(asUid('d_all'), 'settings', 'main'), { sabhaStartTime: '19:00' }));
    });
});

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

describe('the legacy students/ and drivers/ mirrors are closed', () => {
    // These held the same PII as /users and were readable by any signed-in
    // account — a side door around the /users rule above, on identical data.
    // No code reads or writes them, so every role is denied outright.

    it('nobody can read students/{uid}', async () => {
        await assertFails(getDoc(doc(asStudent(), 'students', STUDENT)));
        await assertFails(getDoc(doc(asDriver(), 'students', STUDENT)));
        await assertFails(getDoc(doc(asManager(), 'students', STUDENT)));
        await assertFails(getDoc(doc(asAnon(), 'students', STUDENT)));
    });

    it('nobody can read drivers/{uid}', async () => {
        await assertFails(getDoc(doc(asStudent(), 'drivers', DRIVER)));
        await assertFails(getDoc(doc(asDriver(), 'drivers', DRIVER)));
        await assertFails(getDoc(doc(asManager(), 'drivers', DRIVER)));
        await assertFails(getDoc(doc(asAnon(), 'drivers', DRIVER)));
    });

    it('not even the owner can read their own mirror', async () => {
        // The old rule was isAuthenticated(), so this is the case most likely to
        // be re-granted by reflex. There is no read path that needs it.
        await assertFails(getDoc(doc(asStudent(), 'students', STUDENT)));
        await assertFails(getDoc(doc(asDriver(), 'drivers', DRIVER)));
    });

    it('nobody can list them', async () => {
        await assertFails(getDocs(collection(asManager(), 'students')));
        await assertFails(getDocs(collection(asDriver(), 'drivers')));
    });

    it('nobody can create, update or delete a mirror', async () => {
        // Deletion is denied too: adminDeleteUser sweeps legacy rows under the
        // Admin SDK, which bypasses rules, so no client needs the permission.
        await assertFails(setDoc(doc(asStudent(), 'students', STUDENT), { name: 'X' }));
        await assertFails(updateDoc(doc(asStudent(), 'students', STUDENT), { name: 'X' }));
        await assertFails(deleteDoc(doc(asManager(), 'students', STUDENT)));
        await assertFails(setDoc(doc(asDriver(), 'drivers', DRIVER), { name: 'X' }));
        await assertFails(deleteDoc(doc(asManager(), 'drivers', DRIVER)));
    });
});

describe('manager invites are server-only', () => {
    // settings/managerCode is gone. It was one shared, never-expiring code that
    // any approved manager could read in plaintext and pass on indefinitely, with
    // nothing recording that they had. Invites replace it, and NOBODY reads them:
    // the stored salt and hash are as sensitive as the code was.

    const seedInvite = async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'managerInvites', 'ABC123'), {
                codeHash: 'deadbeef', salt: 'cafe', usedBy: null, revokedAt: null,
                expiresAt: '2099-01-01T00:00:00.000Z',
            });
        });
    };

    it('nobody can read an invite, manager included', async () => {
        await seedInvite();
        await assertFails(getDoc(doc(asManager(), 'managerInvites', 'ABC123')));
        await assertFails(getDoc(doc(asStudent(), 'managerInvites', 'ABC123')));
        await assertFails(getDoc(doc(asDriver(), 'managerInvites', 'ABC123')));
        await assertFails(getDoc(doc(asAnon(), 'managerInvites', 'ABC123')));
        await assertFails(getDocs(collection(asManager(), 'managerInvites')));
    });

    it('nobody can forge, revive or delete an invite', async () => {
        await seedInvite();
        // Forging one as somebody else, and clearing usedBy to make a spent code
        // live again, are the two writes worth naming.
        await assertFails(setDoc(doc(asManager(), 'managerInvites', 'FORGED'), {
            codeHash: 'x', salt: 'y', expiresAt: '2099-01-01T00:00:00.000Z',
        }));
        await assertFails(updateDoc(doc(asManager(), 'managerInvites', 'ABC123'), { usedBy: null }));
        await assertFails(deleteDoc(doc(asManager(), 'managerInvites', 'ABC123')));
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

    it('a student CAN ask for several seats', async () => {
        await assertSucceeds(setDoc(doc(asStudent(), 'rides', 'family'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
            seatsRequested: 4,
        }));
    });

    it('a ride with no seatsRequested is still allowed', async () => {
        // Absent means one. Every ride written before seats existed looks like
        // this, and so does any client that has not picked up the new bundle.
        await assertSucceeds(setDoc(doc(asStudent(), 'rides', 'plain'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
        }));
    });

    it('a student cannot request more seats than the bound allows', async () => {
        // The stepper in PickupForm stops at 8, but a stepper is a suggestion —
        // this is the enforcement. A 99-seat request would monopolise every car
        // that tapped Assign Me and split endlessly.
        await assertFails(setDoc(doc(asStudent(), 'rides', 'greedy'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
            seatsRequested: 99,
        }));
    });

    it('a student cannot request zero, a fraction or a word', async () => {
        for (const seatsRequested of [0, -3, 2.5, 'four']) {
            await assertFails(setDoc(doc(asStudent(), 'rides', 'bad'), {
                studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
                seatsRequested,
            }));
        }
    });

    it('a student cannot inflate their seats after the fact', async () => {
        // Raising the count on an already-queued request would take places from
        // whoever was behind them, with nothing to show it had happened.
        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), {
            seatsRequested: 8,
        }));
    });

    it('a student cannot attach themselves to a group split', async () => {
        // groupId and groupSeatsTotal drive the leftover-first priority and the
        // "all legs done" completion check. Forging them lets a rider jump the
        // queue, or leaves their status frozen mid-journey.
        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), {
            groupId: 'someone-elses-group', groupSeatsTotal: 6,
        }));
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

describe('feedback — anyone may give it, only a manager may read it', () => {
    /**
     * Same shape as `clientErrors`: any signed-in account may file one, the `uid`
     * is pinned to the caller by the rule, the size cap is enforced here because a
     * client is a trust boundary even when it belongs to a manager, and nothing is
     * editable afterwards.
     *
     * The document id is `{uid}_{YYYY-MM-DD}`, and that is the entire anti-spam
     * mechanism: `create` only applies to a document that does not exist, so with
     * `update` denied a person gets one submission per day — enforced by the
     * database rather than by a counter in a browser that can be reloaded. The
     * test for that is the one worth keeping.
     */
    const TODAY = '2026-08-21';
    const mine = `${STUDENT}_${TODAY}`;
    const good = { uid: STUDENT, rating: 4, comment: 'The pickup was on time.', createdAt: `${TODAY}T19:30:00.000Z` };

    it('a rider may file their own', async () => {
        await assertSucceeds(setDoc(doc(asStudent(), 'feedback', mine), good));
    });

    it('a Sarthi and a manager may file one too', async () => {
        await assertSucceeds(setDoc(doc(asDriver(), 'feedback', `${DRIVER}_${TODAY}`),
            { ...good, uid: DRIVER }));
        await assertSucceeds(setDoc(doc(asManager(), 'feedback', `${MANAGER}_${TODAY}`),
            { ...good, uid: MANAGER }));
    });

    it('cannot be filed under somebody else', async () => {
        // Otherwise one account could put words in another person's mouth, and the
        // manager would follow up with the wrong person.
        await assertFails(setDoc(doc(asStudent(), 'feedback', `${OTHER_STUDENT}_${TODAY}`),
            { ...good, uid: OTHER_STUDENT }));
    });

    it('refuses a rating outside 1 to 5', async () => {
        for (const rating of [0, 6, -1, 99]) {
            await assertFails(setDoc(doc(asStudent(), 'feedback', mine), { ...good, rating }));
        }
    });

    it('refuses a rating that is not a whole number', async () => {
        for (const rating of ['5', 4.5, null, true]) {
            await assertFails(setDoc(doc(asStudent(), 'feedback', mine), { ...good, rating }));
        }
    });

    it('refuses a comment past the cap', async () => {
        await assertFails(setDoc(doc(asStudent(), 'feedback', mine),
            { ...good, comment: 'x'.repeat(1001) }));
    });

    it('refuses a comment that is not a string', async () => {
        await assertFails(setDoc(doc(asStudent(), 'feedback', mine), { ...good, comment: 42 }));
    });

    it('refuses a SECOND submission on the same day', async () => {
        // The throttle. One write per person per day, decided by the database.
        await assertSucceeds(setDoc(doc(asStudent(), 'feedback', mine), good));
        await assertFails(setDoc(doc(asStudent(), 'feedback', mine),
            { ...good, comment: 'Actually, one more thing.' }));
    });

    it('allows the next day', async () => {
        await assertSucceeds(setDoc(doc(asStudent(), 'feedback', mine), good));
        await assertSucceeds(setDoc(doc(asStudent(), 'feedback', `${STUDENT}_2026-08-22`),
            { ...good, createdAt: '2026-08-22T19:30:00.000Z' }));
    });

    it('cannot be edited or deleted, including by the person who wrote it', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'feedback', mine), good);
        });
        await assertFails(updateDoc(doc(asStudent(), 'feedback', mine), { comment: 'changed' }));
        await assertFails(deleteDoc(doc(asStudent(), 'feedback', mine)));
        // Not even a manager: this is a record of what somebody said.
        await assertFails(updateDoc(doc(asManager(), 'feedback', mine), { rating: 1 }));
        await assertFails(deleteDoc(doc(asManager(), 'feedback', mine)));
    });

    it('is readable by a manager and by nobody else', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'feedback', mine), good);
        });
        await assertSucceeds(getDoc(doc(asManager(), 'feedback', mine)));
        // Not even the author: feedback about a named volunteer is not for the
        // congregation to browse.
        await assertFails(getDoc(doc(asStudent(), 'feedback', mine)));
        await assertFails(getDoc(doc(asAnon(), 'feedback', mine)));
    });

    it('a manager can LIST the whole collection', async () => {
        // The read rule must not touch `resource.data` — the manager's screen reads
        // this as a collection query, and a condition that inspects the document
        // makes the query fail wholesale. The trap recorded on the notices block.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'feedback', mine), good);
            await setDoc(doc(db, 'feedback', `${DRIVER}_${TODAY}`), { ...good, uid: DRIVER });
        });
        await assertSucceeds(getDocs(collection(asManager(), 'feedback')));
        await assertFails(getDocs(collection(asStudent(), 'feedback')));
    });

    it('a signed-out client can do nothing at all', async () => {
        await assertFails(setDoc(doc(asAnon(), 'feedback', `x_${TODAY}`), good));
    });
});

describe('stop progress is written by the Sarthi driving the run, and nobody else', () => {
    /**
     * ActiveRide saves `route[].visited` straight to the ride as each stop is
     * reached, because the Sarthi is in Google Maps for most of the run and iOS
     * discards the suspended page — ticks kept only in React state are gone by the
     * time they come back.
     *
     * No rule was added for it: the assigned driver already had update. These pin
     * that, so the write the run depends on cannot be closed off by a later tidy
     * of the driver arm, and cannot be opened to any other driver.
     */
    const ROUTE = [
        { lat: 42.37, lng: -71.08, name: 'Start', type: 'start', visited: false },
        { lat: 42.35, lng: -71.08, name: 'Alice', type: 'pickup', studentId: STUDENT, visited: false },
        { lat: 42.34, lng: -71.09, name: 'End', type: 'end', visited: false },
    ];
    const OTHER_DRIVER = 'driver_dina';

    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'users', OTHER_DRIVER), {
                name: 'Dina', role: 'driver', roles: ['driver'], accountStatus: 'approved',
            });
            await updateDoc(doc(db, 'rides', 'ride_alice'), {
                driverId: DRIVER, status: 'in_progress', route: ROUTE,
            });
        });
    });

    const ticked = ROUTE.map((wp, i) => (i === 1 ? { ...wp, visited: true } : wp));

    it('the assigned Sarthi may tick a stop off', async () => {
        await assertSucceeds(updateDoc(doc(asDriver(), 'rides', 'ride_alice'), { route: ticked }));
    });

    it('another Sarthi may not touch it', async () => {
        // Not a hypothetical: every Sarthi on shift is an approved driver, and
        // the arm that allows this write is `isDriver()` AND the ownership check.
        // Losing the second half would let any driver rewrite anyone's run.
        const asOther = testEnv.authenticatedContext(OTHER_DRIVER).firestore();
        await assertFails(updateDoc(doc(asOther, 'rides', 'ride_alice'), { route: ticked }));
    });

    it('the rider may not tick their own stop off', async () => {
        // `route` is one of the fields the assignment pipeline owns. A rider
        // marking themselves collected would make the Sarthi's screen lie.
        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), { route: ticked }));
    });

    it('a signed-out client may not touch it at all', async () => {
        await assertFails(updateDoc(doc(asAnon(), 'rides', 'ride_alice'), { route: ticked }));
    });

    it('the rider may not erase the stamps the run writes about them', async () => {
        // `arrivedAt` is what makes sarthiArrived idempotent; `nudges` holds the
        // per-rider cooldown; `noShowAt` records that they did not travel. Each
        // one, written by the person it is about, undoes something.
        for (const field of ['arrivedAt', 'nudges', 'noShowAt']) {
            await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), { [field]: null }));
        }
    });

    it('the Sarthi still may, because the callables are not the only writer', async () => {
        await assertSucceeds(updateDoc(doc(asDriver(), 'rides', 'ride_alice'), { arrivedAt: 'now' }));
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

describe('the manager claim', () => {
    // A custom claim skips the billed get() of the caller's own user document on
    // every manager read — on a list, once per document delivered. The cost of
    // that speed is staleness: a claim lives on an ID token for up to an hour
    // after a demotion. So it is honoured for READS ONLY, and every write,
    // delete and secret-guarding read still reads the document.

    /** A signed-in user with `mgr: true` and NO user document at all. */
    const asClaimOnly = () =>
        testEnv.authenticatedContext('claim_only', { mgr: true }).firestore();

    /** Signed in with no claim and no document — the baseline. */
    const asNobody = () => testEnv.authenticatedContext('nobody').firestore();

    it('lets a claim-holder READ what a manager reads', async () => {
        // No user document exists for this uid, so only the claim can be
        // authorising it.
        await assertSucceeds(getDoc(doc(asClaimOnly(), 'users', STUDENT)));
        await assertSucceeds(getDocs(collection(asClaimOnly(), 'users')));
        await assertSucceeds(getDoc(doc(asClaimOnly(), 'rides', 'ride_alice')));
        await assertSucceeds(getDocs(collection(asClaimOnly(), 'auditLogs')));
    });

    it('does NOT let a claim-holder write, delete, or read the manager code', async () => {
        // The staleness window must not reach anything destructive or secret.
        await assertFails(deleteDoc(doc(asClaimOnly(), 'users', OTHER_STUDENT)));
        await assertFails(updateDoc(doc(asClaimOnly(), 'users', STUDENT), { name: 'Hacked' }));
        await assertFails(setDoc(doc(asClaimOnly(), 'settings', 'main'), { sabhaLocation: null }));
        await assertFails(deleteDoc(doc(asClaimOnly(), 'rides', 'ride_alice')));
        // Invites are the successor to the shared manager code, and no claim
        // reaches them: minting managers must not run on an hour-stale token.
        await assertFails(getDoc(doc(asClaimOnly(), 'managerInvites', 'ABC123')));
    });

    it('a forged or absent claim grants nothing', async () => {
        await assertFails(getDoc(doc(asNobody(), 'users', STUDENT)));
        await assertFails(getDocs(collection(asNobody(), 'users')));
        // mgr present but false, and mgr as a string rather than a boolean.
        const asFalse = testEnv.authenticatedContext('c_false', { mgr: false }).firestore();
        const asString = testEnv.authenticatedContext('c_str', { mgr: 'true' }).firestore();
        await assertFails(getDocs(collection(asFalse, 'users')));
        await assertFails(getDocs(collection(asString, 'users')));
    });

    it('a real manager with NO claim still works, unchanged', async () => {
        // The whole point of deploying the OR before minting anything: with zero
        // claims in existence, behaviour is identical to before.
        await assertSucceeds(getDocs(collection(asManager(), 'users')));
        await assertSucceeds(updateDoc(doc(asManager(), 'settings', 'main'), { sabhaStartTime: '19:00' }));
        await assertSucceeds(deleteDoc(doc(asManager(), 'rides', 'ride_alice')));
    });

    it('a claim does not rescue a revoked manager on a destructive path', async () => {
        // The scenario the split exists for: rejected in the console, but their
        // token still carries mgr until it refreshes.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', 'revoked'), {
                name: 'Ex', role: 'manager', roles: ['manager'], accountStatus: 'rejected',
            });
        });
        const asRevoked = testEnv.authenticatedContext('revoked', { mgr: true }).firestore();

        await assertFails(deleteDoc(doc(asRevoked, 'users', STUDENT)));
        await assertFails(updateDoc(doc(asRevoked, 'settings', 'main'), { sabhaStartTime: '19:00' }));
        await assertFails(setDoc(doc(asRevoked, 'managerInvites', 'FORGED'), { codeHash: 'x' }));
    });
});

describe('the audit log is append-only', () => {
    // `allow write: if isManager()` covered update and delete, so a manager could
    // edit or erase any row — including the record of their own deletion. An audit
    // trail its own subject can rewrite is not one, and the console presents it as
    // though it were.

    const row = (extra: Record<string, unknown> = {}) => ({
        timestamp: '2026-08-07T18:00:00.000Z',
        actorUid: MANAGER,
        actorName: 'Mira',
        action: 'doc.update',
        targetCollection: 'users',
        targetDocumentId: STUDENT,
        summary: 'Updated fields: phone',
        ...extra,
    });

    const seedRow = async (id: string, data: Record<string, unknown>) => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'auditLogs', id), data);
        });
    };

    it('a manager CAN append a row', async () => {
        await assertSucceeds(setDoc(doc(asManager(), 'auditLogs', 'fresh'), row()));
    });

    it('a manager CANNOT edit an existing row', async () => {
        await seedRow('existing', row());
        await assertFails(updateDoc(doc(asManager(), 'auditLogs', 'existing'), {
            summary: 'Actually I did nothing',
        }));
    });

    it('a manager CANNOT delete a row', async () => {
        // The case that matters: erasing the evidence of a sabha deletion.
        await seedRow('the_deletion', row({ action: 'event.delete' }));
        await assertFails(deleteDoc(doc(asManager(), 'auditLogs', 'the_deletion')));
    });

    it('a manager cannot file a row under someone else\'s name', async () => {
        await assertFails(setDoc(doc(asManager(), 'auditLogs', 'framed'),
            row({ actorUid: OTHER_STUDENT })));
    });

    it('rejects a row with no timestamp', async () => {
        // A row without one is excluded from orderBy('timestamp') and so is
        // invisible in the console — written, and unreadable. That is how sabha
        // deletions went unrecorded on screen while appearing to be logged.
        const { timestamp, ...noTimestamp } = row();
        await assertFails(setDoc(doc(asManager(), 'auditLogs', 'invisible'), noTimestamp));
    });

    it('still accepts the previous bundle\'s managerId shape', async () => {
        // Deploy order is rules → functions → hosting, and a manager can be
        // mid-session on the old bundle. logAuditAction swallows its own failures,
        // so an over-tight rule would let their edit succeed silently unlogged —
        // the exact outcome this block exists to prevent. Remove this arm once no
        // old bundle can still be live.
        await assertSucceeds(setDoc(doc(asManager(), 'auditLogs', 'legacy_shape'), {
            timestamp: '2026-08-07T18:00:00.000Z',
            managerId: MANAGER,
            managerName: 'Mira',
            action: 'UPDATE',
            collection: 'users',
            documentId: STUDENT,
            details: 'Updated fields: phone',
        }));
    });

    it('a student can neither read nor append', async () => {
        await seedRow('private', row());
        await assertFails(getDoc(doc(asStudent(), 'auditLogs', 'private')));
        await assertFails(setDoc(doc(asStudent(), 'auditLogs', 'student_forged'), row({
            actorUid: STUDENT,
        })));
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

    it('a manager CAN write a long-form agenda', async () => {
        // The agenda became a paragraph, and this document is written STRAIGHT
        // FROM THE BROWSER by editOccurrence — there is no callable in between,
        // so these rules are the only real boundary on it.
        await assertSucceeds(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            agenda: '6:30 Kirtan\n7:15 Katha\n\n8:00 Prasad\n\nAll welcome 🙏',
        }));
    });

    it('a manager CAN write an agenda exactly at the ceiling', async () => {
        await assertSucceeds(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            agenda: 'x'.repeat(2000),
        }));
    });

    it('refuses an agenda over the ceiling', async () => {
        // Unbounded free text on a document every signed-in client reads.
        await assertFails(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            agenda: 'x'.repeat(2001),
        }));
    });

    it('refuses an oversize agenda on create too, not just update', async () => {
        await assertFails(setDoc(doc(asManager(), 'events', '2026-08-28'), {
            date: '2026-08-28', startTime: '18:00', endTime: '20:00',
            status: 'scheduled', venue: null, agenda: 'x'.repeat(2001),
        }));
    });

    it('refuses an agenda that is not a string', async () => {
        await assertFails(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            agenda: { nested: 'object' },
        }));
        await assertFails(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            agenda: 12345,
        }));
    });

    it('still allows an edit that does not mention agenda at all', async () => {
        // A merge write for times only never sends the field. Requiring it would
        // break every ordinary edit — the reason the rule tests for absence.
        await assertSucceeds(updateDoc(doc(asManager(), 'events', '2026-08-14'), {
            startTime: '17:00', endTime: '19:30',
        }));
    });

    it('a student still cannot write an agenda, long or short', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'events', '2026-08-14'), {
            agenda: 'Cancelled, go home',
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

/**
 * Crash reports: anyone may file, only managers may read.
 *
 * This collection is written by a BROKEN client, which makes it unusual — the
 * app is in a bad state at the exact moment it needs to write. So the rule has to
 * be permissive enough that a report actually lands, and tight enough that an
 * open write endpoint is not a way to fill the database or frame another user.
 *
 * A report pairs a stack trace with a uid, which is more than an ordinary rider
 * or driver has any reason to read about someone else.
 */
describe('clientErrors — crash reports', () => {
    const report = (uid: string) => ({
        uid, kind: 'render', message: 'boom', stack: 'at f()',
        path: '/dashboard', bundle: 'index-abc.js', userAgent: 'jsdom',
    });

    it('lets a signed-in user file their own crash', async () => {
        await assertSucceeds(addDoc(collection(asStudent(), 'clientErrors'), report(STUDENT)));
    });

    it('refuses an anonymous report', async () => {
        // An unauthenticated write endpoint is free storage for anyone who finds
        // it, and a report with no uid could not help anybody anyway.
        await assertFails(addDoc(collection(asAnon(), 'clientErrors'), report('whoever')));
    });

    it('refuses a report attributed to somebody else', async () => {
        // Otherwise one signed-in user can file crashes as another, and a manager
        // goes chasing the wrong person's phone.
        await assertFails(addDoc(collection(asStudent(), 'clientErrors'), report(OTHER_STUDENT)));
    });

    it('refuses a message big enough to be a payload', async () => {
        await assertFails(addDoc(collection(asStudent(), 'clientErrors'), {
            ...report(STUDENT), message: 'x'.repeat(2000),
        }));
    });

    it('refuses a report with no message', async () => {
        const { message, ...noMessage } = report(STUDENT);
        await assertFails(addDoc(collection(asStudent(), 'clientErrors'), noMessage));
    });

    it('lets a manager read them', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'clientErrors', 'e1'), report(STUDENT));
        });

        await assertSucceeds(getDoc(doc(asManager(), 'clientErrors', 'e1')));
    });

    it('does NOT let a rider or driver read them', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'clientErrors', 'e1'), report(STUDENT));
        });

        // Not even their own: the value is the aggregate, and read access here is
        // read access to every user's uid and stack traces.
        await assertFails(getDoc(doc(asStudent(), 'clientErrors', 'e1')));
        await assertFails(getDoc(doc(asDriver(), 'clientErrors', 'e1')));
    });

    it('nobody edits or deletes a report from the client', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'clientErrors', 'e1'), report(STUDENT));
        });

        // Reports are evidence of a crash somebody may be investigating. The
        // person who filed one must not be able to erase the trace, and neither
        // should a manager from the console — pruning is an Admin SDK job.
        await assertFails(updateDoc(doc(asStudent(), 'clientErrors', 'e1'), { message: 'nothing to see' }));
        await assertFails(deleteDoc(doc(asStudent(), 'clientErrors', 'e1')));
        await assertFails(updateDoc(doc(asManager(), 'clientErrors', 'e1'), { message: 'tidied' }));
        await assertFails(deleteDoc(doc(asManager(), 'clientErrors', 'e1')));
    });
});

/**
 * The notice board.
 *
 * Manager-authored, read by everyone, and DELETABLE BY NOBODY from the client.
 * That last one is the point: taking a notice down must also delete its image
 * from Storage, and a client that deletes the document first has thrown away the
 * only reference to the file. Same reasoning that already makes `events`
 * undeletable here — a raw delete orphans something.
 *
 * The read rule deliberately does not touch `resource.data`, which keeps it
 * list-safe. The board is read as a collection query, and a condition that
 * inspects the document makes the whole query fail rather than filtering it.
 */
describe('the notice board', () => {
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'notices', 'n1'), {
                body: 'Sabha this Friday',
                imagePath: 'notices/n1/flyer.jpg',
                imageUrl: 'https://example.test/flyer.jpg',
                showUntil: '2026-08-21',
                createdAt: '2026-08-19T00:00:00.000Z',
                createdByUid: MANAGER,
                createdByName: 'Mira',
            });
        });
    });

    it('everyone signed in can read the board', async () => {
        // It renders on the dashboard of all three roles.
        await assertSucceeds(getDoc(doc(asStudent(), 'notices', 'n1')));
        await assertSucceeds(getDoc(doc(asDriver(), 'notices', 'n1')));
        await assertSucceeds(getDoc(doc(asManager(), 'notices', 'n1')));
    });

    it('a signed-in user can LIST it, which is how the board is read', async () => {
        // The rule avoids `resource.data` precisely so this works.
        await assertSucceeds(getDocs(collection(asStudent(), 'notices')));
    });

    it('an anonymous visitor cannot read it', async () => {
        await assertFails(getDoc(doc(asAnon(), 'notices', 'n1')));
    });

    it('a manager can post and edit', async () => {
        await assertSucceeds(setDoc(doc(asManager(), 'notices', 'n2'), {
            body: 'Bhulka sabha moved to 7pm',
            createdAt: '2026-08-19T00:00:00.000Z',
            createdByUid: MANAGER,
            createdByName: 'Mira',
        }));
        await assertSucceeds(updateDoc(doc(asManager(), 'notices', 'n1'), { body: 'Corrected time' }));
    });

    it('a rider or Sarthi cannot post', async () => {
        await assertFails(setDoc(doc(asStudent(), 'notices', 'x'), { body: 'hello' }));
        await assertFails(setDoc(doc(asDriver(), 'notices', 'x'), { body: 'hello' }));
        await assertFails(updateDoc(doc(asStudent(), 'notices', 'n1'), { body: 'edited' }));
    });

    it('refuses a body big enough to be a payload', async () => {
        // The composer caps it too; this is the boundary that actually holds.
        await assertFails(setDoc(doc(asManager(), 'notices', 'big'), {
            body: 'x'.repeat(4001),
            createdAt: '2026-08-19T00:00:00.000Z',
        }));
    });

    it('refuses a body that is not a string', async () => {
        await assertFails(setDoc(doc(asManager(), 'notices', 'weird'), { body: { nested: true } }));
    });

    it('NOBODY deletes from the client — not even a manager', async () => {
        // Deletion goes through deleteNotice, which removes the Storage object
        // first. A client delete would orphan the image for ever.
        await assertFails(deleteDoc(doc(asManager(), 'notices', 'n1')));
        await assertFails(deleteDoc(doc(asStudent(), 'notices', 'n1')));
        await assertFails(deleteDoc(doc(asDriver(), 'notices', 'n1')));
    });
});

describe('a Sarthi cannot read the whole congregation', () => {
    /**
     * `allow list` carried an unconditional `isDriver()`. In Firestore `read` is
     * `get` + `list` and allow rules are OR'd, so the carefully scoped `allow read`
     * beneath it could not narrow that: any approved driver could list EVERY ride —
     * every child's name, phone number and pickup address, including rides assigned
     * to other drivers, and completed ones from previous weeks.
     *
     * A hook in this repo — `useDriverDashboard`, since deleted — queried rides
     * with no driver filter and sorted them out in the browser, which is the shape
     * of the mistake this arm invited. It turned out never to have been mounted, so
     * that particular query was not shipping data; the hole itself needed no help
     * from it, because the grant was to any approved driver's credentials and a
     * hand-written query is one line.
     *
     * And because the hierarchy makes every manager a driver, the same arm handed
     * it to managers without their claim being checked too.
     */
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'rides', 'ride_other'), {
                studentId: OTHER_STUDENT, studentName: 'Bob', studentPhone: '556',
                pickupAddress: '2 Main St', status: 'requested',
            });
            await setDoc(doc(db, 'rides', 'ride_mine'), {
                studentId: OTHER_STUDENT, driverId: DRIVER, status: 'assigned',
                studentName: 'Bob', pickupAddress: '2 Main St',
            });
        });
    });

    it('a driver cannot list every ride', async () => {
        await assertFails(getDocs(collection(asDriver(), 'rides')));
    });

    it('a driver CAN still list the rides assigned to them', async () => {
        // The dispatch screen has to keep working; it just has to ask for its own.
        await assertSucceeds(getDocs(
            query(collection(asDriver(), 'rides'), where('driverId', '==', DRIVER)),
        ));
    });

    it('a driver cannot list another driver\'s rides by asking for them', async () => {
        await assertFails(getDocs(
            query(collection(asDriver(), 'rides'), where('driverId', '==', 'driver_other')),
        ));
    });

    it('a rider CAN still list their own', async () => {
        await assertSucceeds(getDocs(
            query(collection(asStudent(), 'rides'), where('studentId', '==', STUDENT)),
        ));
    });

    it('a manager can still list everything', async () => {
        await assertSucceeds(getDocs(collection(asManager(), 'rides')));
    });
});

describe('a Sarthi cannot forge a ride', () => {
    /**
     * `allow create` had a bare `isDriver()` arm above the guarded student one, and
     * OR short-circuits — so a driver reached it first and none of the student
     * constraints applied. The comment directly above it said "previously any
     * student could forge a ride for another user, or create one already marked
     * 'assigned'": that fix went onto the student arm only, while the arm above
     * granted exactly what it described, plus a bypass of the seat bounds.
     *
     * Nothing needed it. The only client-side ride creation is a rider asking for
     * themselves; drivers get work through globalAssignDriver, which runs on the
     * Admin SDK and bypasses rules entirely.
     */
    it('a driver cannot create a ride for somebody else', async () => {
        await assertFails(setDoc(doc(asDriver(), 'rides', 'forged'), {
            studentId: OTHER_STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
        }));
    });

    it('a driver cannot create a ride already marked assigned', async () => {
        await assertFails(setDoc(doc(asDriver(), 'rides', 'forged2'), {
            studentId: DRIVER, status: 'assigned', driverId: DRIVER,
            pickupLat: 42, pickupLng: -71,
        }));
    });

    it('a driver cannot bypass the seat bounds', async () => {
        await assertFails(setDoc(doc(asDriver(), 'rides', 'forged3'), {
            studentId: DRIVER, status: 'requested', seatsRequested: 99,
            pickupLat: 42, pickupLng: -71,
        }));
    });

    it('a driver CAN still ask for a lift for themselves, properly', async () => {
        // The hierarchy grants a Sarthi the Bhulku hat on purpose. Requesting is
        // allowed — it just has to obey the same rules as any other rider.
        await assertSucceeds(setDoc(doc(asDriver(), 'rides', 'dave_asks'), {
            studentId: DRIVER, status: 'requested', seatsRequested: 1,
            pickupLat: 42, pickupLng: -71,
        }));
    });

    it('a manager can still create a ride, for the records console', async () => {
        await assertSucceeds(setDoc(doc(asManager(), 'rides', 'by_manager'), {
            studentId: STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
        }));
    });
});

describe('nobody drives and rides at the same time', () => {
    /**
     * The server backstop for the driver/passenger rule. Ride requests are direct
     * client writes with no callable in between, so this rule is the only thing
     * enforcing it — the rider screen's card is the readable half, not the
     * boundary.
     */
    it('somebody holding a car cannot request a lift', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', DRIVER), {
                name: 'Dave', role: 'driver', roles: ['driver'], accountStatus: 'approved',
                currentVehicleId: 'veh_1',
            });
        });

        await assertFails(setDoc(doc(asDriver(), 'rides', 'dave_while_driving'), {
            studentId: DRIVER, status: 'requested', seatsRequested: 1,
            pickupLat: 42, pickupLng: -71,
        }));
    });

    it('and can once they have handed the car back', async () => {
        await assertSucceeds(setDoc(doc(asDriver(), 'rides', 'dave_off_shift'), {
            studentId: DRIVER, status: 'requested', seatsRequested: 1,
            pickupLat: 42, pickupLng: -71,
        }));
    });
});

describe('taking a request back', () => {
    /**
     * The rules already allowed a rider to write `cancelled` — the UI never shipped
     * a control for it. Tightened while adding one: cancellable only from
     * `requested`, so nobody can vanish from the manifest of a car already on its
     * way. Cancelling after assignment needs the seat released and the Sarthi told,
     * which is a different job.
     */
    it('a rider can withdraw a request nobody has taken', async () => {
        // The EXACT payload withdrawRideRequest writes, `cancelledAt` included. A
        // test that asserts a tidier write than the client makes can pass while
        // production is refused.
        await assertSucceeds(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), {
            status: 'cancelled',
            cancelledAt: '2026-08-20T18:00:00.000Z',
        }));
    });

    it('a rider cannot cancel once a Sarthi is on the way', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'rides', 'ride_alice'), {
                studentId: STUDENT, status: 'assigned', driverId: DRIVER,
                pickupLat: 42, pickupLng: -71,
            });
        });

        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_alice'), {
            status: 'cancelled',
        }));
    });

    it('a rider still cannot cancel somebody else\'s request', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'rides', 'ride_bob'), {
                studentId: OTHER_STUDENT, status: 'requested', pickupLat: 42, pickupLng: -71,
            });
        });

        await assertFails(updateDoc(doc(asStudent(), 'rides', 'ride_bob'), {
            status: 'cancelled',
        }));
    });
});

describe('the fleet — a Sarthi cannot take a car somebody else is holding', () => {
    /**
     * `allow update: if isManager() || isDriver()` was unconditional on both
     * `cars` and `vehicles`, so any approved driver could rewrite ANY vehicle
     * document. The server callable does guard the holder
     * (globalAssignDriver: "Vehicle is assigned to another Sarthi") but
     * assignVehicleToDriver writes the document straight from the browser and never
     * reaches it. Two Sarthis, one car.
     *
     * Neither collection had a single rules test before this.
     */
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'vehicles', 'veh_free'), { name: 'Odyssey', status: 'available' });
            await setDoc(doc(db, 'vehicles', 'veh_taken'), {
                name: 'Sienna', status: 'in_use', assignedDriverId: 'driver_other',
            });
            await setDoc(doc(db, 'vehicles', 'veh_mine'), {
                name: 'Civic', status: 'in_use', assignedDriverId: DRIVER,
            });
        });
    });

    it('a driver can claim a free car', async () => {
        await assertSucceeds(updateDoc(doc(asDriver(), 'vehicles', 'veh_free'), {
            status: 'in_use', assignedDriverId: DRIVER,
        }));
    });

    it('a driver cannot take a car another Sarthi is holding', async () => {
        await assertFails(updateDoc(doc(asDriver(), 'vehicles', 'veh_taken'), {
            status: 'in_use', assignedDriverId: DRIVER,
        }));
    });

    it('a driver can hand back the car they hold', async () => {
        await assertSucceeds(updateDoc(doc(asDriver(), 'vehicles', 'veh_mine'), {
            status: 'available', assignedDriverId: null,
        }));
    });

    it('a manager can still move any car', async () => {
        await assertSucceeds(updateDoc(doc(asManager(), 'vehicles', 'veh_taken'), {
            status: 'available', assignedDriverId: null,
        }));
    });

    it('a rider cannot touch the fleet at all', async () => {
        await assertFails(updateDoc(doc(asStudent(), 'vehicles', 'veh_free'), {
            status: 'in_use', assignedDriverId: STUDENT,
        }));
    });
});

describe('managers cannot delete what only the server should', () => {
    /**
     * `allow write` includes DELETE, and allow rules are OR'd — so a later
     * `allow delete: if false` could not take it back. storage.rules documents this
     * hazard; three blocks here still had it.
     */
    it('nobody deletes the venue settings', async () => {
        // settings/main drives the map and the pickup destination for everyone.
        await assertFails(deleteDoc(doc(asManager(), 'settings', 'main')));
    });

    it('a manager can still change the venue', async () => {
        await assertSucceeds(setDoc(doc(asManager(), 'settings', 'main'), {
            sabhaLocation: { lat: 43, lng: -72 },
        }, { merge: true }));
    });

    it('nobody deletes an attendance response', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'weeklyAttendance', '2026-08-14', 'responses', STUDENT), {
                studentName: 'Alice', response: 'yes',
            });
        });

        // Not even their own: the record is what a manager plans the evening from.
        await assertFails(deleteDoc(
            doc(asStudent(), 'weeklyAttendance', '2026-08-14', 'responses', STUDENT),
        ));
        await assertFails(deleteDoc(
            doc(asManager(), 'weeklyAttendance', '2026-08-14', 'responses', STUDENT),
        ));
    });

    it('a rider can still answer and change their mind', async () => {
        await assertSucceeds(setDoc(
            doc(asStudent(), 'weeklyAttendance', '2026-08-14', 'responses', STUDENT),
            { response: 'no' },
        ));
    });

    it('nobody deletes statistics', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'statistics', '2026-08-14'), { rides: 11 });
        });

        await assertFails(deleteDoc(doc(asManager(), 'statistics', '2026-08-14')));
    });
});

describe('the notifications collection is closed', () => {
    /**
     * Nothing reads or writes it — push goes through FCM. The block that stood here
     * gated update on the EXISTING document's `userId` with no constraint on the
     * incoming one, so its owner could reassign `userId` and rewrite the title and
     * body: a forged message from the app, into somebody else's inbox.
     *
     * Closed rather than repaired, like the legacy students/ and drivers/ mirrors.
     */
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'notifications', 'n1'), {
                userId: STUDENT, title: 'Your ride is arranged', body: 'x',
            });
        });
    });

    it('the owner cannot read it', async () => {
        await assertFails(getDoc(doc(asStudent(), 'notifications', 'n1')));
    });

    it('the owner cannot reassign it to somebody else', async () => {
        // The exact forgery the old rule allowed.
        await assertFails(updateDoc(doc(asStudent(), 'notifications', 'n1'), {
            userId: OTHER_STUDENT, title: 'Ignore the Sarthi, walk home',
        }));
    });

    it('a manager cannot create one either', async () => {
        await assertFails(setDoc(doc(asManager(), 'notifications', 'n2'), {
            userId: STUDENT, title: 'x', body: 'y',
        }));
    });
});

describe('signup writes the GRANTED set, and the rules still allow it', () => {
    /**
     * RoleSelection used to write `roles: [selectedRole]` while the invite path wrote
     * ['manager','driver','student'] — two meanings for one field, and `useUsers`
     * queries it to build the driver picker, so a manager created down the signup
     * path was invisible there however many nights they drove.
     *
     * These pin the exact shapes signup now writes, because
     * `createsUnprivilegedProfile()` inspects the incoming document and a future
     * tightening of it would break registration silently.
     */
    it('a rider can register themselves, approved, with roles ["student"]', async () => {
        const fresh = testEnv.authenticatedContext('new_rider').firestore();
        await assertSucceeds(setDoc(doc(fresh, 'users', 'new_rider'), {
            role: 'student', registeredRole: 'student', activeRole: 'student',
            roles: ['student'],
            accountStatus: 'approved', name: 'New Rider',
        }));
    });

    it('a Sarthi can register themselves pending, with the driver granted set', async () => {
        // grantedRoles({ role: 'driver' }) === ['driver', 'student']
        const fresh = testEnv.authenticatedContext('new_driver').firestore();
        await assertSucceeds(setDoc(doc(fresh, 'users', 'new_driver'), {
            role: 'driver', registeredRole: 'driver', activeRole: 'driver',
            roles: ['driver', 'student'],
            accountStatus: 'pending', name: 'New Sarthi',
        }));
    });

    it('but a rider still cannot self-approve with a wider set than student', async () => {
        // The escalation the create guard exists for: approved AND carrying driver.
        const fresh = testEnv.authenticatedContext('sneaky').firestore();
        await assertFails(setDoc(doc(fresh, 'users', 'sneaky'), {
            role: 'student', registeredRole: 'student', activeRole: 'student',
            roles: ['student', 'driver'],
            accountStatus: 'approved', name: 'Sneaky',
        }));
    });
});
