/**
 * EVERY NOTIFICATION THE SERVER CAN SEND MUST BE ONE A MANAGER CAN SWITCH OFF.
 *
 * The manager panel is built from `NOTIFICATION_CATALOGUE`, and the guard in
 * `dispatch` looks up `data.type` in the same catalogue. So a send whose type is
 * missing from the catalogue is UNMANAGEABLE — it is not on the panel, and the guard
 * falls open and delivers it. Nothing errors, nothing logs, and the manager simply
 * never learns that one notification ignores their settings.
 *
 * That is this repo's signature defect wearing a new coat: a control that looks wired
 * up and silently does not cover everything it claims to. It is also the exact way the
 * feature will rot — the next person adds `notifyX`, ships it, and the panel is
 * quietly incomplete from that day.
 *
 * So this checks BOTH directions:
 *
 *   A `type:` in the sending code that is not in the catalogue → unmanageable send.
 *   A catalogue key with no sender anywhere → a switch over nothing, which is the
 *   dead control. `notifyManagerUnassignedStudents` was exactly this: defined, tagged
 *   `unassigned_students`, called from nowhere, for months.
 *
 * Source text is parsed rather than the modules imported, because importing
 * functions/src pulls in firebase-admin and every call site with it. The tag is a
 * literal in a payload object, so a regex reads it exactly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { NOTIFICATION_KEYS } from '../../src/constants/notifications';

const FUNCTIONS_SRC = join(__dirname, '../../functions/src');

/** Every non-test .ts under functions/src. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        if (!entry.name.endsWith('.ts')) return [];
        if (entry.name.endsWith('.test.ts')) return [];
        return [full];
    });
}

/**
 * Files that actually send. Scanning everything would sweep up unrelated `type:`
 * fields — audit details, error payloads — and turn this into a test about string
 * literals rather than about notifications.
 */
function sendingFiles(): string[] {
    return sourceFiles(FUNCTIONS_SRC).filter(path => {
        if (path.endsWith(join('constants', 'notifications.ts'))) return false;
        const text = readFileSync(path, 'utf8');
        return /from '\.\.?\/(utils\/)?notifications'/.test(text)
            || path.endsWith(join('utils', 'notifications.ts'));
    });
}

/** The `type: '...'` tags in one file. */
function tagsIn(text: string): string[] {
    return [...text.matchAll(/\btype:\s*'([a-z0-9_-]+)'/gi)].map(m => m[1]);
}

describe('every send is manageable', () => {
    it('finds the sending files at all', () => {
        // A guard on the guard: if the import pattern above ever stops matching, this
        // whole file would pass by testing nothing.
        expect(sendingFiles().length).toBeGreaterThan(5);
    });

    it('tags every notification with a key the catalogue knows', () => {
        const unknown: string[] = [];
        for (const path of sendingFiles()) {
            for (const tag of tagsIn(readFileSync(path, 'utf8'))) {
                if (!(NOTIFICATION_KEYS as readonly string[]).includes(tag)) {
                    unknown.push(`${path.slice(FUNCTIONS_SRC.length + 1)}: '${tag}'`);
                }
            }
        }
        expect(unknown).toEqual([]);
    });

    it('has a real sender behind every switch on the panel', () => {
        const sent = new Set(
            sendingFiles().flatMap(path => tagsIn(readFileSync(path, 'utf8'))),
        );
        const orphans = NOTIFICATION_KEYS.filter(key => !sent.has(key));
        expect(orphans).toEqual([]);
    });
});
