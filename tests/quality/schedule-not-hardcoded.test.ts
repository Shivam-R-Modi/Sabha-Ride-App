/**
 * When sabha happens is a manager's decision, not a constant.
 *
 * The schedule is one record — `settings/sabhaRecurrence` — and everything else
 * reads it. That was not always true: the day of the week lived in
 * `functions/src/utils/schedule.ts` as `SABHA_DAY = 5 // Friday`, and even after
 * it stopped being consulted it stayed exported in the file a reader would search
 * first when asking which day sabha is. A stale answer in an obvious place is
 * worse than no answer.
 *
 * This is a ratchet, not a style rule. What it protects against is the specific
 * regression of a weekday being pinned in code again — which would silently
 * disagree with the rule the manager can see and edit, and disagree only for
 * whichever congregation moved its sabha.
 *
 * DEFAULT_SABHA_START / DEFAULT_SABHA_END are deliberately allowed. They are
 * last-resort fallbacks for a project with nothing saved at all, documented as
 * such in both copies, and they are read only when the stored value is missing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../..');

/** Every source file that could plausibly decide when sabha is. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const skip = new Set(['node_modules', 'dist', 'lib', '.git', 'preview-dist', 'e2e', 'reports']);
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (skip.has(entry)) continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
        }
    };
    for (const dir of ['src', 'functions/src', 'hooks', 'components', 'contexts']) {
        walk(join(ROOT, dir));
    }
    return out;
}

describe('no weekday is pinned in code', () => {
    it('nothing exports a sabha day-of-week constant', () => {
        // The exact shape that existed and was dead for two releases.
        const offenders = sourceFiles().filter(f =>
            /export\s+const\s+\w*(SABHA_DAY|SABHA_WEEKDAY|SABHA_DAY_OF_WEEK)\w*/.test(readFileSync(f, 'utf8')));

        expect(offenders.map(f => f.replace(ROOT + '/', ''))).toEqual([]);
    });

    it('SABHA_DAY is gone from the schedule helpers', () => {
        for (const path of ['functions/src/utils/schedule.ts', 'src/constants/schedule.ts']) {
            const src = readFileSync(join(ROOT, path), 'utf8');
            // Named in a comment explaining the deletion is fine; declared is not.
            expect(src).not.toMatch(/export\s+const\s+SABHA_DAY/);
        }
    });
});

describe('the rule is the only schedule', () => {
    it('the recurrence document path exists in exactly the two mirror files', () => {
        // Client and functions have separate tsconfigs and no shared path, so one
        // literal each is the most this can be — the same arrangement as seats.
        // A third copy is drift; an inline copy in a component is how it started.
        const definitions = sourceFiles()
            .filter(f => /const\s+RECURRENCE_DOC\s*=\s*'/.test(readFileSync(f, 'utf8')))
            .map(f => f.replace(ROOT + '/', ''))
            .sort();

        expect(definitions).toEqual([
            'functions/src/http/sabhaRecurrence.ts',
            'src/constants/schedule.ts',
        ]);
    });

    it('the two mirrors hold the same path', () => {
        const read = (f: string) =>
            readFileSync(join(ROOT, f), 'utf8').match(/const\s+RECURRENCE_DOC\s*=\s*'([^']+)'/)?.[1];

        expect(read('src/constants/schedule.ts'))
            .toBe(read('functions/src/http/sabhaRecurrence.ts'));
    });

    it('the manager form reads the saved rule live rather than assuming its own defaults', () => {
        // Its `useState('19:00')` values are pre-load placeholders. Without the
        // subscription they would become the form's answer, and a manager who
        // saved without looking would overwrite the real times with them.
        const src = readFileSync(join(ROOT, 'components/manager/RecurringSabha.tsx'), 'utf8');

        expect(src).toMatch(/onSnapshot\(\s*\n?\s*doc\(db, RECURRENCE_DOC\)/);
        expect(src).toMatch(/normaliseRecurrence\(snap\.data\(\)\)/);
    });

    /**
     * A weekday named in something the user READS is the same defect one layer up.
     *
     * The Notices composer shipped a placeholder reading "No sabha this Friday —
     * the hall is unavailable." after the congregation had moved to Monday. It
     * schedules nothing, so no test about behaviour could catch it, and it is
     * precisely what a manager would take as the app's own statement of the day.
     *
     * Comments are stripped first, deliberately: this codebase explains its history
     * in prose and mentions Friday constantly. Only quoted strings count.
     */
    it('no weekday name appears in a string the user can read', () => {
        // The three places a day-name list is the actual subject: the picker, and
        // the two `describeRule` mirrors that turn a rule into a sentence.
        const allowed = [
            'src/utils/recurrence.ts',
            'functions/src/http/sabhaRecurrence.ts',
            'components/manager/RecurringSabha.tsx',
        ];
        const DAYS = /Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday/;

        const offenders: string[] = [];

        for (const file of sourceFiles()) {
            const rel = file.replace(ROOT + '/', '');
            if (allowed.includes(rel)) continue;

            const code = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
                .replace(/^\s*\/\/.*$/gm, ' ');       // line comments

            for (const match of code.matchAll(/(['"`])((?:(?!\1)[\s\S])*?)\1/g)) {
                if (DAYS.test(match[2])) offenders.push(`${rel}: "${match[2].slice(0, 60)}"`);
            }
        }

        expect(offenders).toEqual([]);
    });

});

/**
 * THE CLIENT'S COPY OF THE WINDOW CONSTANTS MUST MATCH THE SERVER'S.
 *
 * `src/constants/schedule.ts` restates PICKUP_LEAD_DAYS, DROPOFF_LEAD_MINUTES and
 * DEFAULT_REQUESTS_OPEN_TIME so pure client modules can print "requests open
 * Wednesday at 10am" without importing firebase. `functions/src/utils/schedule.ts` is
 * the copy that actually decides the boundary. They carried a "mirrors X" comment and
 * nothing else — a comment is a hope.
 *
 * The drift that matters is the last one: the client telling a rider requests open at
 * 10am while the server still opens them at midnight is a screen that is simply wrong,
 * and nothing anywhere would fail.
 */
describe('the client and server agree about the window constants', () => {
    it('lead days, drop-off lead and the default open time', async () => {
        const client = await import('../../src/constants/schedule');
        const server = await import('../../functions/src/utils/schedule');

        expect(client.PICKUP_LEAD_DAYS).toBe(server.PICKUP_LEAD_DAYS);
        expect(client.DROPOFF_LEAD_MINUTES).toBe(server.DROPOFF_LEAD_MINUTES);
        expect(client.DEFAULT_REQUESTS_OPEN_TIME).toBe(server.DEFAULT_REQUESTS_OPEN_TIME);
    });

    it('the default open time is not midnight, which is what it used to be', async () => {
        // Stated as its own case because '00:00' on both sides would pass the test
        // above. A window that opens at midnight is how the "requests are open" push
        // came to wake the congregation in the middle of the night.
        const server = await import('../../functions/src/utils/schedule');
        expect(server.DEFAULT_REQUESTS_OPEN_TIME).not.toBe('00:00');
    });
});
