/**
 * Cloud Storage security-rules tests, run against the Storage emulator.
 *
 *   npm run test:rules
 *
 * storage.rules is the FIRST Storage rules file in this project and shipped
 * without tests. That is a bad combination here for two reasons:
 *
 *   1. Its manager check crosses services — `firestore.get()` on the caller's
 *      user document — so it can break for reasons that are invisible in the
 *      file itself, like a role recorded only in `roles[]`.
 *   2. `write` in Storage rules expands to create, update AND delete, and allow
 *      statements are OR'd. So `allow write` beside `allow delete: if false`
 *      grants the delete the second line looks like it forbids. These tests pin
 *      the OUTCOME — nobody deletes — but they cannot pin the cause; see the
 *      note on the delete test, and tests/quality/storage-rules-shape.ts.
 *
 * Both emulators are needed: Storage for the rules, Firestore for the user
 * documents they read.
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
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

const STUDENT = 'student_alice';
const MANAGER = 'manager_mira';
const ARRAY_MANAGER = 'manager_array_only';
const PENDING_MANAGER = 'manager_pending';

const JPEG = { contentType: 'image/jpeg' };
const tiny = () => new Uint8Array([1, 2, 3, 4]);

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'sabha-rules-test',
        firestore: {
            rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
        storage: {
            rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 9199,
        },
    });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
    await testEnv.clearStorage();
    await testEnv.clearFirestore();
    // Seeded with rules off, so the fixtures are not themselves under test.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'users', STUDENT), {
            name: 'Alice', role: 'student', roles: ['student'], accountStatus: 'approved',
        });
        await setDoc(doc(db, 'users', MANAGER), {
            name: 'Mira', role: 'manager', registeredRole: 'manager', roles: ['manager'],
            accountStatus: 'approved',
        });
        // A manager recorded ONLY in the array. A rule checking `role` alone
        // would lock this person out of posting a notice.
        await setDoc(doc(db, 'users', ARRAY_MANAGER), {
            name: 'Anand', roles: ['manager'], accountStatus: 'approved',
        });
        // Recorded as a manager but not approved yet.
        await setDoc(doc(db, 'users', PENDING_MANAGER), {
            name: 'Priya', role: 'manager', roles: ['manager'], accountStatus: 'pending',
        });
    });
});

const NOTICE = 'notices/notice_1/flyer.jpg';

describe('notice images — who may upload', () => {
    it('lets an approved manager upload an image', async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await assertSucceeds(uploadBytes(ref(s, NOTICE), tiny(), JPEG));
    });

    it('lets a manager recorded only in roles[] upload', async () => {
        // The reason the rule reads all three fields instead of just `role`.
        const s = testEnv.authenticatedContext(ARRAY_MANAGER).storage();
        await assertSucceeds(uploadBytes(ref(s, NOTICE), tiny(), JPEG));
    });

    it('refuses a rider', async () => {
        const s = testEnv.authenticatedContext(STUDENT).storage();
        await assertFails(uploadBytes(ref(s, NOTICE), tiny(), JPEG));
    });

    it('refuses a manager who is not approved yet', async () => {
        const s = testEnv.authenticatedContext(PENDING_MANAGER).storage();
        await assertFails(uploadBytes(ref(s, NOTICE), tiny(), JPEG));
    });

    it('refuses a signed-out caller', async () => {
        const s = testEnv.unauthenticatedContext().storage();
        await assertFails(uploadBytes(ref(s, NOTICE), tiny(), JPEG));
    });

    it('refuses someone with no user document at all', async () => {
        // firestore.get() on a missing document must deny, not error into an allow.
        const s = testEnv.authenticatedContext('ghost_uid').storage();
        await assertFails(uploadBytes(ref(s, NOTICE), tiny(), JPEG));
    });
});

describe('notice images — what may be uploaded', () => {
    it('refuses a non-image even from a manager', async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await assertFails(uploadBytes(ref(s, 'notices/notice_1/x.pdf'), tiny(), {
            contentType: 'application/pdf',
        }));
    });

    it('refuses a file with no content type', async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        // contentType.matches() on a null must not evaluate to an allow.
        await assertFails(uploadBytes(ref(s, 'notices/notice_1/x.bin'), tiny(), {
            contentType: '',
        }));
    });

    it('refuses an image over the 3 MB ceiling', async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        const tooBig = new Uint8Array(3 * 1024 * 1024 + 1);
        await assertFails(uploadBytes(ref(s, NOTICE), tooBig, JPEG));
    });
});

describe('notice images — reading', () => {
    beforeEach(async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await uploadBytes(ref(s, NOTICE), tiny(), JPEG);
    });

    it('lets any signed-in person read a notice image', async () => {
        const s = testEnv.authenticatedContext(STUDENT).storage();
        await assertSucceeds(getBytes(ref(s, NOTICE)));
    });

    it('refuses a signed-out reader', async () => {
        // A flyer is an announcement to the congregation, not public content.
        const s = testEnv.unauthenticatedContext().storage();
        await assertFails(getBytes(ref(s, NOTICE)));
    });
});

describe('notice images — deleting', () => {
    beforeEach(async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await uploadBytes(ref(s, NOTICE), tiny(), JPEG);
    });

    it('refuses a direct delete even from a manager', async () => {
        // Deletion must go through the deleteNotice callable, which removes the
        // file and the document together.
        //
        // This does NOT catch `allow write` being put back in place of
        // `allow create, update` — checked, and all 16 of these still passed with
        // the hole open, because the grant's condition reads request.resource,
        // which is null on a delete, so it errors and denies anyway. The methods
        // named in the grant are pinned by tests/quality/storage-rules-shape.ts
        // instead. What this test does prove is the outcome riders and managers
        // actually get today.
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await assertFails(deleteObject(ref(s, NOTICE)));
    });

    it('refuses a direct delete from a rider', async () => {
        const s = testEnv.authenticatedContext(STUDENT).storage();
        await assertFails(deleteObject(ref(s, NOTICE)));
    });
});

describe('everywhere else in the bucket is closed', () => {
    it('refuses an upload outside notices/, even from a manager', async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await assertFails(uploadBytes(ref(s, 'somewhere/else.jpg'), tiny(), JPEG));
    });

    it('refuses an upload nested deeper than notices/{id}/{file}', async () => {
        // A third segment falls through to the catch-all deny. Worth pinning:
        // the client sanitises '/' out of filenames, and this is what would
        // catch that sanitiser being loosened.
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await assertFails(uploadBytes(ref(s, 'notices/notice_1/deep/flyer.jpg'), tiny(), JPEG));
    });

    it('refuses a read at the bucket root', async () => {
        const s = testEnv.authenticatedContext(MANAGER).storage();
        await assertFails(getBytes(ref(s, 'anything.jpg')));
    });
});
