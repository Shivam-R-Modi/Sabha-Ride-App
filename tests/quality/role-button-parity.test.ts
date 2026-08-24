/**
 * Promote and demote must look like the same kind of act.
 *
 * They did not. Reported from two screenshots of the same dialog: **Make Sarthi**
 * was a FILLED green button with a car icon, **Return to Bhulku** was an OUTLINED
 * red one with a generic down-arrow. Same screen, same consequence class, and only
 * ever ONE of them visible at a time — so the difference did not read as "one of
 * these is the safer option", the way an Approve/Turn-down PAIR does on the People
 * page. It read as two unrelated controls, and which weight a manager saw depended
 * purely on which direction they happened to be going.
 *
 * They were two separately written `<button>` blocks, which is why they drifted.
 * The fix is that there is now exactly one, `RoleChangeButton`, taking the
 * direction as a prop — so the geometry and weight cannot diverge again, and only
 * the things that carry meaning vary: the colour, and the icon of the role the
 * person is BECOMING.
 *
 * Textual, not a render test, for the reason records-tab-stability.test.ts gives:
 * jsdom computes no Tailwind, so a rendering test cannot see a fill, a border
 * width or a padding. tests/setup.ts also bans asserting on class names from a
 * component test, which is exactly why this kind of check lives in here instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = path.resolve(__dirname, '../../components/manager/UserDetailSheet.tsx');
const source = readFileSync(SOURCE, 'utf8');

/** Comments stripped, so the prose above the code cannot satisfy a check. */
const code = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the role-change button is one control, not two', () => {
    it('declares exactly one <button> in the whole file', () => {
        // The load-bearing assertion. Two button elements is how the last
        // divergence happened; the Sheet supplies its own close control, and every
        // other row in this dialog is read-only text.
        expect((code.match(/<button/g) ?? []).length).toBe(1);
    });

    it('routes every direction through RoleChangeButton', () => {
        // Four uses: promote, demote, and both of them again in the arm for a
        // record whose role fields disagree with each other.
        expect((code.match(/<RoleChangeButton/g) ?? []).length).toBe(4);
    });

    it('fills both directions, rather than filling one and outlining the other', () => {
        expect(code).toContain('--success-fill');
        expect(code).toContain('--danger-fill');

        // The outlined treatment is what made demote look like a lesser act. It
        // belongs to the Approve/Turn-down PAIR on the People page, where the
        // asymmetry means something, and not here.
        expect(code).not.toContain('border-2');
        expect(code).not.toMatch(/border-\[rgb\(var\(--danger\)\)\]/);
    });

    it('uses one text colour for both, so neither reads as lighter', () => {
        // A filled button takes --text-on-accent whatever the fill is. Two
        // different label colours would reintroduce the difference this fixes.
        expect((code.match(/--text-on-accent/g) ?? []).length).toBe(1);
        expect(code).not.toContain('--danger-text');
    });

    it('varies only the fill and the icon between the two directions', () => {
        // Everything else is in the shared class string. If a future edit moves
        // geometry into the ternary, this catches it: the conditional should
        // resolve to a bare background utility on each side and nothing more.
        const ternary = code.match(/to === 'driver'\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/);
        expect(ternary).not.toBeNull();
        expect(ternary![1]).toBe('bg-[rgb(var(--success-fill))]');
        expect(ternary![2]).toBe('bg-[rgb(var(--danger-fill))]');
    });

    it('labels each direction with the icon of the role being BECOME', () => {
        // The app's existing role language, from RoleSwitcher's roleConfig: Car is
        // a Sarthi, GraduationCap is a Bhulku. The old demote button used a
        // generic ArrowDownCircle, which said "downwards" and named nothing.
        expect(code).toMatch(/to === 'driver' \? <Car size=\{16\}\ ?\/> : <GraduationCap size=\{16\}\ ?\/>/);
        expect(code).not.toContain('<ArrowDownCircle');
    });
});
