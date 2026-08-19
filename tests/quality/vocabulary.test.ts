/**
 * The rename, and the line it must not cross.
 *
 * The app is **Bhulka Gaadi**; riders are **Bhulku / Bhulka**; drivers are
 * **Sarthi / Sarthis**. Every word a person reads uses those.
 *
 * NOTHING THE DATABASE READS CHANGED, and that is the point of this file.
 * `Student` and `Driver` live in three layers here, and only one of them is
 * copy:
 *
 *   copy         "Bhulka Served", "Looking for Sarthi"        — renamed
 *   stored       role literals 'student' / 'driver', the
 *                /students and /drivers collections, ride
 *                fields students / assignedStudentIds /
 *                studentId / driverId, ride status
 *                'driver_en_route'                            — UNCHANGED
 *   identifiers  DriverDashboard, useDriverLocation,
 *                RideStudent, driverDoneForToday              — UNCHANGED
 *
 * Renaming the middle layer is a live data migration, not a rename. Every
 * existing user document holds `role: 'student'`; the security rules match on
 * it; custom claims are minted from it. Change the literal and the rules stop
 * matching the data — and the failure mode is a silent permission denial, or a
 * guard that quietly allows, on an app holding children's names, phone numbers
 * and home addresses.
 *
 * So this file asserts in BOTH directions: the copy has moved, and the wire
 * format has not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

function sourceFiles(dirs: string[], ext: RegExp): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === 'node_modules' || entry === 'dist') continue;
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (ext.test(entry)) found.push(full);
        }
    };
    for (const d of dirs) walk(path.join(ROOT, d));
    return found;
}

/**
 * Strings a person can read: JSX text, and quoted text that is prose rather
 * than a module path or an identifier.
 *
 * Comments are skipped on purpose — they discuss the TYPES `Driver` and
 * `Student`, which are identifiers and are deliberately not renamed.
 */
function visibleStrings(source: string): string[] {
    const out: string[] = [];
    for (const line of source.split('\n')) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (/^\s*(import|export)\s/.test(line)) continue;
        // Developer logs are not copy. They deliberately keep the old words,
        // because those match the code identifiers (`studentId`, `driverId`)
        // and that is what makes a log greppable.
        if (/console\.(log|warn|error|info|debug)\s*\(/.test(line)) continue;

        for (const m of line.matchAll(/(['"`])([^'"`\n]{2,160})\1/g)) {
            const body = m[2]!;
            if (body.includes('/') || body.startsWith('.')) continue;   // module paths
            out.push(body);
        }
        for (const m of line.matchAll(/>([^<>{}\n]{2,160})</g)) out.push(m[1]!);
    }
    return out;
}

const OLD_WORDS = /\b(Students?|Drivers?)\b|Sabha Ride/;

describe('the words people read', () => {
    it('no client screen still shows the old vocabulary', () => {
        const offences: string[] = [];
        for (const file of sourceFiles(['components', 'preview', 'src'], /\.tsx?$/)) {
            for (const s of visibleStrings(readFileSync(file, 'utf8'))) {
                if (OLD_WORDS.test(s)) offences.push(`${path.relative(ROOT, file)}  "${s.slice(0, 60)}"`);
            }
        }
        expect(offences, `Old vocabulary still on screen:\n  ${offences.join('\n  ')}`).toEqual([]);
    });

    it('the app is named Bhulka Gaadi everywhere it ships', () => {
        expect(read('index.html')).toContain('<title>Bhulka Gaadi</title>');
        expect(read('index.html')).toContain('content="Bhulka Gaadi"');
        expect(read('vite.config.ts')).toContain("name: 'Bhulka Gaadi'");
        expect(read('vite.config.ts')).toContain("short_name: 'Bhulka Gaadi'");
        expect(read('metadata.json')).toContain('"name": "Bhulka Gaadi"');
    });

    it('the checker really looks at something — it cannot pass vacuously', () => {
        // The recurring failure in this repo's quality tests is a matcher that
        // matches nothing and reports success.
        const strings = visibleStrings(read('components/manager/ManagerReports.tsx'));
        expect(strings.length).toBeGreaterThan(10);
        expect(strings.some(s => /Bhulka|Sarthi/.test(s))).toBe(true);
    });

    it('skips comments, which talk about the types and not about people', () => {
        expect(visibleStrings('// the prop is `User | Driver`')).toEqual([]);
    });
});

describe('the wire format did NOT move', () => {
    it('the role literals are still student / driver', () => {
        // Every user document in production holds one of these. Renaming them
        // is a migration, and the rules below match on them.
        expect(read('types.ts')).toContain("export type UserRole = 'student' | 'driver' | 'manager'");
    });

    it('the collections are still /students and /drivers', () => {
        const rules = read('firestore.rules');
        expect(rules).toMatch(/match \/students\/\{/);
        expect(rules).toMatch(/match \/drivers\/\{/);
    });

    it('the ride document fields are unchanged', () => {
        const types = read('types.ts');
        for (const field of ['studentId', 'studentName', 'driverId', 'driverName', 'students?']) {
            expect(types, `ride field ${field} was renamed — that is a migration`).toContain(field);
        }
    });

    it('the ride status is still driver_en_route', () => {
        // Stored on live ride documents, and matched by the client.
        expect(read('types.ts')).toContain("'driver_en_route'");
    });

    it('the audit action label was left alone', () => {
        // Audit rows are a record. Changing the action mid-stream would split
        // the trail into before-and-after for no user-visible gain.
        expect(read('functions/src/http/manualAssignStudent.ts')).toContain("'manually assign students'");
    });
});
