/**
 * No control may be invisible until hovered.
 *
 * The manager's Request Center shipped Assign and Dismiss as
 * `opacity-0 group-hover:opacity-100`. Three things go wrong with that, and all
 * three are the failure mode this repo keeps having — a control that looks wired
 * up and does nothing:
 *
 *  - A pointer that cannot hover never reveals it. A tablet or touchscreen
 *    laptop is `md:` and wider, so it gets the desktop table, not the mobile
 *    cards with their own buttons.
 *  - `opacity-0` hides a button without taking it out of the tab order, so
 *    keyboard focus lands on something the user cannot see.
 *  - Even with a mouse, the row's only actions are undiscoverable.
 *
 * The rule is deliberately blunt: nothing in the app pairs `opacity-0` with
 * `group-hover:opacity-*`. A decorative glow can still fade in from a visible
 * resting opacity (StudentDashboard's `opacity-20 group-hover:opacity-40`
 * does); starting from fully transparent is the pattern that hides controls.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const tsxFiles = ['components', 'src', 'hooks', 'contexts'].flatMap(dir =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
        .filter(f => f.endsWith('.tsx'))
        .map(f => path.join(dir, f))
).concat('App.tsx');

/** Every quoted className in a file, paired with its 1-based line number. */
const classNames = (source: string): { line: number; value: string }[] =>
    source.split('\n').flatMap((text, i) =>
        [...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
            .map(m => ({ line: i + 1, value: m[1] ?? m[2] })),
    );

describe('hover is never the only way to see a control', () => {
    it('finds .tsx files to scan at all', () => {
        // Without this the suite passes vacuously if the globbing above breaks.
        expect(tsxFiles.length).toBeGreaterThan(10);
        expect(tsxFiles).toContain(path.join('components', 'manager', 'RequestTable.tsx'));
    });

    it('pairs opacity-0 with group-hover nowhere in the app', () => {
        const offenders = tsxFiles.flatMap(file =>
            classNames(readFileSync(path.join(ROOT, file), 'utf8'))
                .filter(c => /(^|\s)opacity-0(\s|$)/.test(c.value) && /group-hover:opacity-/.test(c.value))
                .map(c => `${file}:${c.line}`),
        );

        expect(offenders).toEqual([]);
    });

    it("keeps the Request Center's Assign and Dismiss buttons visible", () => {
        // The specific regression, named: the actions cell of the desktop table.
        const source = readFileSync(path.join(ROOT, 'components/manager/RequestTable.tsx'), 'utf8');
        const actionsCell = source.slice(source.indexOf('"p-4 text-right"'), source.indexOf('title="Dismiss Request"'));

        expect(actionsCell).toContain('Assign to Driver');
        // Only the className attributes — prose in a comment may say "opacity-0".
        expect(classNames(actionsCell).map(c => c.value).join(' ')).not.toContain('opacity-0');
    });
});
