/**
 * Switching collections in Raw records must not move anything.
 *
 * Reported as "every element below feels like they are shaking or readjusting upon
 * switching". Measured in the preview harness (preview/records.html) before and
 * after, at 1280x900. Four separate causes, each small on its own:
 *
 *   1. The count badge rendered ONLY on the active tab, so switching moved a ~35px
 *      element from one pill to another: the old tab lost 35px of width, the new
 *      one gained 33, and every pill after them slid. The count now sits beside the
 *      search, always present.
 *   2. `scale-105` on the active pill, animated by `transition-all`. A transform
 *      does not move siblings, but one pill growing while another shrank is
 *      movement whatever the layout says.
 *   3. The active pill had NO border while the inactive ones had a 1px one, so it
 *      was 2px narrower and everything after it shifted 2px per switch.
 *   4. Switching sets `loading` true again (useAdminDatabase does it on every
 *      collection change), swapping a table of any height for a fixed `py-16`
 *      spinner and back. That is the vertical half of the complaint.
 *
 * Verified after: 0px tab drift across all five tabs and back, one distinct Status
 * position, one distinct results-region position, and no overflow anywhere.
 *
 * Textual because these are CSS facts. jsdom computes no Tailwind, so a rendering
 * test cannot see a min-height, a border width, or a transform.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
    path.resolve(__dirname, '../../components/manager/DatabaseConsole.tsx'), 'utf8',
);

/** Comments stripped: this file explains the reasoning in prose right beside it. */
const code = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the collection tabs keep a fixed size', () => {
    it('carries no per-tab count, so no pill can resize', () => {
        // `count: activeTab === 'x' ? documents.length : null` is the exact shape
        // that put a badge on one pill and took it off another.
        expect(code).not.toMatch(/count:\s*activeTab/);
    });

    it('does not scale the active pill', () => {
        expect(code).not.toMatch(/scale-1\d\d/);
    });

    it('does not animate every property on the pills', () => {
        // `transition-all` is what made the scale visible as movement; colour is
        // all that actually changes now.
        expect(code).not.toMatch(/transition-all[^']*whitespace-nowrap/);
    });

    it('gives the active pill a border so its box matches the inactive ones', () => {
        // Without this the active pill is 2px narrower than its neighbours.
        expect(code).toMatch(/border-transparent/);
    });
});

describe('the filter row keeps its controls still', () => {
    it('renders the conditional Role filter BEFORE the always-present Status', () => {
        // Load-bearing. The group is right-anchored, so only a member removed from
        // the LEFT leaves the rest in place. Status first was tried and measured:
        // it slid 136px on every switch away from Users.
        const role = code.indexOf('label="Role"');
        const status = code.indexOf('label="Status"');
        expect(role, 'the Role filter went missing').toBeGreaterThan(-1);
        expect(status, 'the Status filter went missing').toBeGreaterThan(-1);
        expect(role, 'Role must come before Status, or Status moves on every switch')
            .toBeLessThan(status);
    });

    it('has no decorative funnel icon to slide across the bar', () => {
        // It was aria-hidden and sat before the conditional Role filter, so it
        // travelled 152px on leaving Users. The selects carry visible labels.
        expect(code).not.toMatch(/<Filter\b/);
    });

    it('does not let the filter group be squeezed', () => {
        // The group is overflow-x-auto: squeeze it and it SCROLLS rather than
        // resizes, which reads as its contents jumping. That is how the record
        // count cost it 16px on Users.
        expect(code).toMatch(/md:shrink-0[^"]*overflow-x-auto/);
    });
});

describe('the results region does not collapse while a collection loads', () => {
    it('reserves a minimum height around all four states', () => {
        expect(code, 'without a reserved height the table collapses to the spinner and back on every switch')
            .toMatch(/min-h-\[\d+rem\]/);
    });

    it('still has all four states inside it', () => {
        // The min-height is only worth anything if it wraps the whole ternary.
        // Matched on the ternary branches specifically — `loading` and
        // `filteredDocuments.length === 0` both appear earlier in the file for
        // unrelated reasons, and matching those made this pass for the wrong reason.
        const region = code.indexOf('min-h-[');
        expect(region).toBeGreaterThan(-1);
        for (const branch of ['{loading ? (', ') : error ? (', ') : filteredDocuments.length === 0 ? (']) {
            const at = code.indexOf(branch);
            expect(at, `${branch} is not in the file any more`).toBeGreaterThan(-1);
            expect(at, `${branch} must sit inside the reserved-height wrapper`).toBeGreaterThan(region);
        }
    });
});

describe('the record count is honest about filtering', () => {
    it('shows how many of how many when a filter is on', () => {
        expect(code).toMatch(/filteredDocuments\.length\} of \$\{documents\.length\}/);
    });

    it('shows nothing while loading, rather than the previous collection\'s count', () => {
        // `documents` still holds the old collection until the new snapshot lands.
        // The old badge showed that stale number as if it were the new tab's.
        expect(code).toMatch(/!loading && !error &&/);
    });
});
