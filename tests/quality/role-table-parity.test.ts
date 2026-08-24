/**
 * THE ROLE HIERARCHY EXISTS IN SIX PLACES. THEY MUST ALL SAY THE SAME THING.
 *
 * There is no shared module to import: `src/` and `functions/` have separate
 * tsconfigs and no shared path, `firestore.rules` is a different language entirely,
 * and the `scripts/*.cjs` maintenance tools run under plain node with the Admin SDK.
 * So the table is written out six times:
 *
 *   1. src/roles.ts                        IMPLIES
 *   2. functions/src/utils/roles.ts        IMPLIES
 *   3. firestore.rules                     grantsRole()
 *   4. scripts/backfill-granted-roles.cjs  IMPLIES
 *   5. scripts/mint-manager-claims.cjs     isApprovedManager()
 *   6. storage.rules                       isApprovedManager()
 *
 * Until now nothing failed if they drifted. Each file carried a comment asking the
 * next person to keep them in step, which is a hope rather than a check — and the
 * owner's standing instruction on this repo is "no parity so no future problems".
 *
 * WHAT DRIFT ACTUALLY COSTS, in the two directions:
 *
 *   Client MORE permissive than rules → the switcher offers a role, the screens
 *   render, and every read underneath fails. A dead UI, which is this repo's
 *   signature defect.
 *
 *   Client LESS permissive than rules → a capability silently disappears. That has
 *   happened here: `useUsers` once queried `role == 'driver'` for the driver pool
 *   and listed nobody, because every driver in this congregation is recorded as a
 *   manager who also drives. The manager's assign control could only ever say "No
 *   available drivers found", however many were on the road.
 *
 * The table is asserted STRUCTURALLY, not by string match, so reformatting is free
 * and a changed meaning is not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The one true table. Every copy below is compared against this. */
const EXPECTED: Record<string, string[]> = {
    manager: ['manager', 'driver', 'student'],
    driver: ['driver', 'student'],
    student: ['student'],
};

/** Parse an `IMPLIES = { manager: [...], ... }` literal out of source text. */
function parseImplies(src: string, label: string): Record<string, string[]> {
    const block = src.match(/IMPLIES[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!block) throw new Error(`No IMPLIES table found in ${label}`);

    const table: Record<string, string[]> = {};
    for (const line of block[1]!.split('\n')) {
        const row = line.match(/(\w+)\s*:\s*\[([^\]]*)\]/);
        if (!row) continue;
        table[row[1]!] = [...row[2]!.matchAll(/'([^']+)'/g)].map(m => m[1]!);
    }
    return table;
}

describe('the two TypeScript copies agree', () => {
    const client = parseImplies(read('src/roles.ts'), 'src/roles.ts');
    const server = parseImplies(read('functions/src/utils/roles.ts'), 'functions/src/utils/roles.ts');

    it('the client table is the expected hierarchy', () => {
        expect(client).toEqual(EXPECTED);
    });

    it('the server table is identical to the client one', () => {
        expect(server).toEqual(client);
    });

    it('expands downward only — nothing implies manager', () => {
        // The property that matters most. If `driver` ever implied `manager`, every
        // volunteer with a car would be able to read every family's address.
        for (const [role, granted] of Object.entries(client)) {
            if (role !== 'manager') {
                expect(granted, `${role} must not imply manager`).not.toContain('manager');
            }
        }
    });

    it('every role grants itself', () => {
        for (const [role, granted] of Object.entries(client)) {
            expect(granted, `${role} must grant itself`).toContain(role);
        }
    });
});

describe('the maintenance scripts agree', () => {
    it('backfill-granted-roles.cjs carries the same table', () => {
        // It WRITES the granted set onto live documents. A stale table here would
        // quietly hand out the wrong roles across the whole congregation.
        expect(parseImplies(read('scripts/backfill-granted-roles.cjs'), 'backfill-granted-roles.cjs'))
            .toEqual(EXPECTED);
    });

    it('mint-manager-claims.cjs reads all three role fields', () => {
        // The recorded-role arms, not the hierarchy: this script decides who gets a
        // `mgr` claim. Missing the `roles[]` arm is a mistake made four separate
        // times in this codebase.
        const src = read('scripts/mint-manager-claims.cjs');
        expect(src).toMatch(/role === 'manager'/);
        expect(src).toMatch(/registeredRole === 'manager'/);
        expect(src).toMatch(/roles\.includes\('manager'\)/);
        expect(src, 'a claim must never be minted for an unapproved account')
            .toMatch(/accountStatus !== 'approved'/);
    });
});

describe('firestore.rules encodes the same hierarchy', () => {
    const rules = read('firestore.rules');
    const grantsRole = (() => {
        const m = rules.match(/function grantsRole\(data, role\) \{([\s\S]*?)\n    \}/);
        if (!m) throw new Error('No grantsRole() in firestore.rules');
        return m[1]!.replace(/\/\/.*$/gm, '');
    })();

    it('grants student to a manager and to a driver', () => {
        expect(grantsRole).toMatch(/role == 'student'/);
        expect(grantsRole).toMatch(/recordsRole\(data, 'manager'\)/);
        expect(grantsRole).toMatch(/recordsRole\(data, 'driver'\)/);
    });

    it('grants driver to a manager', () => {
        expect(grantsRole).toMatch(/role == 'driver'[\s\S]*recordsRole\(data, 'manager'\)/);
    });

    it('has NO clause that would grant manager', () => {
        // `grantsRole(data,'manager')` must reduce to `recordsRole(data,'manager')`.
        // That reduction is what makes isManager() recorded-only, matching
        // hasRecordedRole on the server. A `role == 'manager' && …` clause here
        // would promote somebody without the document saying so.
        expect(grantsRole).not.toMatch(/role == 'manager'/);
    });

    it('reads all three recorded-role fields, like the TS mirrors', () => {
        const recordsRole = rules.match(/function recordsRole\(data, role\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
        expect(recordsRole).toMatch(/data\.role == role/);
        expect(recordsRole).toMatch(/data\.registeredRole == role/);
        expect(recordsRole).toMatch(/role in data\.roles/);
        expect(recordsRole, 'activeRole is a UI hat, never authority')
            .not.toMatch(/activeRole/);
    });
});

describe('storage.rules agrees about who is a manager', () => {
    const storage = read('storage.rules');

    it('reads all three recorded-role fields', () => {
        expect(storage).toMatch(/role == 'manager'/);
        expect(storage).toMatch(/registeredRole == 'manager'/);
        expect(storage).toMatch(/'manager' in callerData\(\)\.roles/);
    });

    it('keeps the document arm, which is the one that honours a demotion', () => {
        // This assertion used to also require that storage.rules NEVER mentioned
        // `request.auth.token`, on the reasoning that a claim survives on an ID
        // token for up to an hour after a demotion. That reasoning still holds and
        // is why the document arm must stay — but the ban was wrong, and it was
        // guarding a rule that could not run.
        //
        // Reading the document from Storage rules is a CROSS-SERVICE `firestore.get()`,
        // which needs an IAM grant on the Firebase Rules service agent that
        // `firebase deploy --only storage` does not create. Without it the get
        // fails, `.data` errors, and an errored condition denies — so notice-image
        // uploads returned `storage/unauthorized` for every manager. A test that
        // forbade the only arm which works, while pinning the arm that could not,
        // is the shape of a guard that protects the wrong thing.
        //
        // So: BOTH arms are now required. That is stricter than the old assertion,
        // not looser — it pins the claim arm as a fallback AND forbids the document
        // arm being dropped once the fallback makes uploads work.
        expect(storage).toMatch(/accountStatus == 'approved'/);
        expect(storage).toMatch(/firestore\.get\(/);
        expect(storage).toMatch(/request\.auth\.token\.get\('mgr', false\)/);
    });

    it('checks the DOCUMENT before the claim', () => {
        // This assertion was the other way round for a few hours, while the
        // cross-service read was broken and the claim was the only arm that worked.
        // The cause turned out to be IAM — the Cloud Storage service agent had no
        // Firestore permission — and once granted, the ordering had to flip back:
        // the document arm is the stronger of the two and the only one that honours
        // a demotion immediately, which was the entire point of chasing the grant.
        // Claim first would keep answering before the correct arm was consulted.
        expect(storage).toMatch(/isApprovedManager\(\)\s*\|\|\s*isManagerToken\(\)/);
    });

    it('keeps the claim as a fallback, so a lost IAM binding degrades instead of failing', () => {
        // If that binding is ever removed the document arm errors again, and `||`
        // lets the claim answer. Deleting this arm would turn a silent IAM change
        // into "notice images stop uploading" with a message nobody can act on.
        expect(storage).toMatch(/request\.auth\.token\.get\('mgr', false\)/);
    });
});

describe('activeRole is authority nowhere', () => {
    it('is excluded from every recorded-role reader', () => {
        // It records which hat someone is wearing in the UI. Treating it as
        // authority is why manualAssignStudent was once weaker than the rules it was
        // meant to mirror, and why the dispatch pool matched nobody.
        for (const f of ['src/roles.ts', 'functions/src/utils/roles.ts']) {
            const src = read(f);
            const recorded = src.match(/export function recordedRoles[\s\S]*?\n\}/)?.[0] ?? '';
            expect(recorded, `${f} must not read activeRole`).not.toMatch(/profile\.activeRole/);
        }
    });

    it('is still blocked as a self-writable field', () => {
        // A user cannot set it, which is what makes the switcher pure UI state.
        const priv = read('firestore.rules').match(/function touchesPrivilegeFields\(\)[\s\S]*?\n    \}/)?.[0] ?? '';
        for (const field of ['role', 'registeredRole', 'roles', 'activeRole', 'accountStatus', 'platformRole']) {
            expect(priv, `${field} must be unwritable by its own owner`).toContain(`'${field}'`);
        }
    });
});
