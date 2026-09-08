/**
 * A FIRESTORE QUERY MUST NEVER FILTER BY HALL.
 *
 * This is the first safety rule of the two-location work, and it is the one rule that
 * looks most like a mistake to anybody who has not been bitten by it. The short query
 * is the wrong query:
 *
 *     db.collection('rides').where('locationId', '==', hall)   // ← never this
 *
 * Two things are true of `locationId`. No composite index carries it. And a Firestore
 * equality filter on a field a document does not have does not error, does not warn and
 * does not appear in any log — **it silently omits that document.** So a ride written
 * before the field existed, or one whose stamp a bug dropped, is not "wrongly included":
 * it vanishes. The query returns fewer rows and reports total success.
 *
 * What that looks like on a Friday night is "Nobody is waiting" on a Sarthi's screen
 * while somebody's child stands outside, and an empty list is indistinguishable from a
 * quiet evening. There is nothing to diagnose from, because nothing failed.
 *
 * So the shape is always: **one `where` on a field every document provably carries**
 * (`status`, `eventDate`, `studentId`, `documentId()`), then the hall filtered IN MEMORY,
 * where an absent field is a value you can branch on and name. `isValidPendingRide`
 * returns `'no-location'` for exactly that case rather than dropping the ride, which is
 * how it became visible in the manager's board as "N requests name no sabha".
 *
 * `cityId` is held to the same rule, for the same reason and by explicit decision.
 * `functions/src/constants/tenancy.ts` records it: every document is stamped so a later
 * release *can* filter, but "nothing queries `cityId`, and deliberately so" until a
 * verifier proves nothing is unstamped. Stamping is cheap to get right; filtering on a
 * partially-stamped collection fails in the direction nobody sees.
 *
 * ── WHY THIS TEST EXISTS AT ALL ─────────────────────────────────────────────────────
 *
 * The plan that introduced two halls named this rule non-negotiable and named this exact
 * file as its guard. The file was never written, so for three days the rule held by
 * discipline alone — in a repo whose entire test convention exists because discipline
 * does not survive contact with the next session. The next person to read a two-`where`
 * query and "tidy" it has no way to know any of the above.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

/** Every directory that contains a Firestore query, client and server. */
const QUERY_TREES = ['hooks', 'components', 'src', 'functions/src'];

/** The tenancy keys that are stamped on documents but must not be queried. */
const UNQUERYABLE = ['locationId', 'cityId'] as const;

/**
 * `where('locationId', …)` and `orderBy('locationId')` both drop documents lacking the
 * field. `orderBy` is included because it is the same silent omission wearing different
 * clothes, and it is the shape somebody reaches for when grouping a board by hall.
 */
const FORBIDDEN = new RegExp(
    String.raw`\b(?:where|orderBy)\s*\(\s*['"\`](?:${UNQUERYABLE.join('|')})['"\`]`,
);

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

/**
 * Comments out, code in.
 *
 * NOT optional politeness. The two clearest statements of this rule in the whole
 * codebase are comments that quote the forbidden line verbatim —
 * `deleteSabhaEvent.ts` ("Adding `where('locationId', '==', …)` would be the shorter
 * query and the wrong one") and `constants/tenancy.ts`. A substring search cannot tell
 * prose from code, so without this the rule's own documentation is what fails the test,
 * and the obvious fix is to delete the explanation.
 *
 * Strings are left alone: a query field name is written as a string literal, so
 * stripping those would strip the very thing being looked for.
 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block, including the /** … */ headers
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line, without eating the // in a URL
}

const sources = QUERY_TREES.flatMap(t => walk(path.join(ROOT, t)))
    .map(f => ({ file: path.relative(ROOT, f), text: readFileSync(f, 'utf8') }));

describe('a query never filters by hall', () => {
    it('scans a plausible number of files, so a passing run means something', () => {
        // A broken walk() returns [] and every other test here passes vacuously. This is
        // the cheapest possible check that the scanner actually looked at the code.
        expect(sources.length).toBeGreaterThan(100);
        expect(sources.some(s => s.file === 'functions/src/http/globalAssignDriver.ts')).toBe(true);
        expect(sources.some(s => s.file.startsWith('hooks/'))).toBe(true);
    });

    it('strips comments without stripping code', () => {
        // The other way this whole file could pass for the wrong reason: a stripComments
        // that removes everything. Both halves are asserted.
        const sample = [
            '/** where("locationId", "==", x) is forbidden — see the header. */',
            "const q = db.collection('rides').where('status', '==', 'requested');",
            "// and never where('cityId', '==', c)",
            "const u = 'https://example.com/a//b';",
        ].join('\n');

        const stripped = stripComments(sample);

        expect(stripped).toMatch(/where\('status', '==', 'requested'\)/);
        expect(stripped).toContain('https://example.com');
        expect(FORBIDDEN.test(stripped)).toBe(false);
    });

    it('really does catch the forbidden shapes', () => {
        // Proving the regex bites, so that a green run is evidence rather than silence.
        for (const bad of [
            "db.collection('rides').where('locationId', '==', hall)",
            'query(collection(db, "rides"), where("locationId", "in", halls))',
            "db.collection('users').where('cityId', '==', FOUNDING_CITY_ID)",
            "ref.orderBy('locationId')",
            "db.collection('rides')\n    .where(\n        'locationId',\n        '==',\n        hall,\n    )",
        ]) {
            expect(FORBIDDEN.test(bad), `should have been caught:\n  ${bad}`).toBe(true);
        }

        // And that it does not fire on the shapes that are correct.
        for (const good of [
            "db.collection('rides').where('status', '==', 'requested')",
            "db.collection('rides').where('eventDate', '==', date)",
            'docs.filter(d => locationOfRide(d.data()) === locationId)',
            "where('locationIds', 'array-contains', hall)", // a different field
        ]) {
            expect(FORBIDDEN.test(good), `false positive on:\n  ${good}`).toBe(false);
        }
    });

    it('no query filters or orders by locationId or cityId', () => {
        const offenders = sources
            .filter(s => FORBIDDEN.test(stripComments(s.text)))
            .map(s => s.file);

        expect(
            offenders,
            `A Firestore filter on a field a document may not carry omits that document `
            + `SILENTLY — no error, no log, one fewer row. For a hall that means "Nobody `
            + `is waiting" while somebody is waiting, and nothing to diagnose from.\n\n`
            + `Keep one \`where\` on a field every document provably carries (status, `
            + `eventDate, studentId, documentId()) and filter the hall in memory, where `
            + `an absent value can be named — see \`locationOfRide\` and the `
            + `'no-location' reason in functions/src/utils/ridePool.ts.\n\n`
            + `Offending files:\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
});

describe('because the hall is filtered in memory instead', () => {
    /**
     * Guards the other direction. A test that only forbids things passes just as happily
     * if hall filtering disappeared altogether — which would not be a tidier query, it
     * would be every waiting rider offered to every hall's Sarthi.
     *
     * EVERY ASSERTION HERE IS ON AN EXECUTABLE FORM, and that is the whole difficulty.
     * The first version of this block matched `/locationOfRide/` and `/'no-location'/`,
     * which are satisfied by an `import` on line 27, a union member on line 41 and a
     * sentence on line 64. Deleting the entire hall-filtering branch left all three
     * matches standing and the suite green. So: the call needs its parenthesis, the
     * reasons need their `return`, and comments are stripped first.
     */
    const poolSource = (rel: string) =>
        stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));

    it('dispatch reads the hall by CALLING locationOfRide, not by querying', () => {
        // `locationOfRide\s*\(` and not `locationOfRide`: the bare name is the import.
        expect(poolSource('functions/src/utils/ridePool.ts')).toMatch(/locationOfRide\s*\(/);
    });

    it('a ride naming no hall is REFUSED with its own reason, not dropped', () => {
        // The point of filtering in memory: absence becomes a value that can be named
        // and shown. These two `return`s are what put "N requests name no sabha" on the
        // manager's board instead of leaving those riders invisible.
        //
        // `return` and not just the literal: the literals also appear in the RideRejection
        // union, which survives the logic being deleted.
        const pool = poolSource('functions/src/utils/ridePool.ts');
        expect(pool).toMatch(/return\s+'no-location'/);
        expect(pool).toMatch(/return\s+'other-location'/);
    });

    it('the client mirror filters the same way, rather than by query', () => {
        // The two ridePool copies are mirrored and pinned by ride-pool-parity.test.ts.
        // This only checks the client half did not quietly switch to a query.
        expect(poolSource('src/utils/ridePool.ts')).toMatch(/locationOfRide\s*\(/);
    });
});
