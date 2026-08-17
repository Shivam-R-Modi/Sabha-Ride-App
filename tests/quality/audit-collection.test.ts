/**
 * Every audit writer must name the SAME collection.
 *
 * `scripts/clear-stale-presence.cjs` shipped writing to `auditLog`, while the
 * whole app reads `auditLogs`. One character. The script reported success, the
 * repair really happened, and its audit row landed in a parallel collection that
 * nothing reads — so the trail said the repair had never been made. It was found
 * only because a hand-written diagnostic query happened to use the same wrong
 * name and came back nearly empty.
 *
 * This is the repo's signature failure in a new place: an action that looks
 * recorded and is not. The app's own code all routes through `writeAuditLog`, so
 * it cannot drift — the risk is entirely in the `scripts/`, which use the Admin
 * SDK directly and therefore have to name the collection by hand.
 *
 * The check is textual on purpose. A .cjs maintenance script cannot be imported
 * into vitest without dragging in firebase-admin and a credential, and the thing
 * worth protecting is a string literal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

/** The one true name, read from the source rather than repeated here. */
const declared = (() => {
    const src = readFileSync(path.join(ROOT, 'functions/src/utils/audit.ts'), 'utf8');
    const match = src.match(/AUDIT_COLLECTION\s*=\s*'([^']+)'/);
    if (!match) throw new Error('Could not find AUDIT_COLLECTION in functions/src/utils/audit.ts');
    return match[1]!;
})();

const scripts = () =>
    readdirSync(path.join(ROOT, 'scripts'))
        .filter(f => f.endsWith('.cjs') || f.endsWith('.js'))
        .map(f => ({ name: f, body: readFileSync(path.join(ROOT, 'scripts', f), 'utf8') }));

describe('the audit collection has exactly one name', () => {
    it('is plural, which is the whole trap', () => {
        expect(declared).toBe('auditLogs');
    });

    it('no script names a near-miss spelling, wherever the name is written', () => {
        // Scans STRING LITERALS, not `collection(...)` calls.
        //
        // The first version of this test matched `collection('…audit…')` and was
        // useless: the script that actually had the bug assigns the name to a
        // constant and passes the constant, so there was no literal inside the
        // call at all. It passed happily against the real defect.
        //
        // A literal whose whole content is audit-ish (`auditLog`, `auditLogs`,
        // `audit_logs`) is a collection name by construction. Prose in comments
        // does not match, because it is not a quoted literal of that exact shape.
        const offenders: string[] = [];

        for (const { name, body } of scripts()) {
            for (const match of body.matchAll(/['"](audit[A-Za-z_]*)['"]/g)) {
                if (match[1] !== declared) offenders.push(`${name} names '${match[1]}'`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('every script that writes a row names the right collection', () => {
        // The positive half: a script writing audit rows must reference the
        // declared name somewhere, or it is writing them nowhere useful.
        const writers = scripts().filter(s => /collection\(\s*['"][^'"]*audit/i.test(s.body));

        expect(writers.length).toBeGreaterThan(0); // guard against the filter rotting
        for (const { name, body } of writers) {
            expect(body, `${name} does not reference '${declared}'`).toContain(declared);
        }
    });
});

/**
 * Two checks I wrote and removed, recorded so they are not re-added:
 *
 *  - "must assign the name to a constant" — a style rule I invented. It flagged
 *    repair-fleet.cjs, which uses the correct name inline and is fine.
 *  - "must carry cityId" — flagged backfill-audit-shape.cjs, which only READS the
 *    collection to add a missing `timestamp` to existing rows. It writes no new
 *    rows, so there is nothing to stamp.
 *
 * Both were false positives dressed as rigour. The check that earns its place is
 * the near-miss spelling, because that is the defect that actually happened.
 */
