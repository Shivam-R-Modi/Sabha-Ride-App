/**
 * Where a manager can go, and what each destination shows.
 *
 * Fleet and Raw records were sections inside Setup's accordion until 2026-08-18.
 * Promoting them to nav destinations touched four files — the TabView union, the
 * nav list, the router switch, and Setup itself — and the failure mode of getting
 * that wrong is silent: a nav item that renders the dashboard because its `case`
 * was never added. You would only notice by clicking every tab.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const layoutSrc = readFileSync(path.join(ROOT, 'components/Layout.tsx'), 'utf8');
const appSrc = readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
const typesSrc = readFileSync(path.join(ROOT, 'types.ts'), 'utf8');

/**
 * The nav list for one role, read out of getNavItems.
 *
 * Sliced to the CLOSING bracket of each array, not a fixed offset — an earlier
 * version took `indexOf('return [') + 2000` and swallowed the rider array into the
 * manager one, which made "Records is last" fail against `profile` and invented a
 * `rides` destination for managers. A parser that reads the wrong block is worse
 * than no test, because both its passes and its failures are meaningless.
 */
function navFor(role: 'driver' | 'manager' | 'student'): Array<{ id: string; label: string }> {
    const body = layoutSrc.slice(layoutSrc.indexOf('const getNavItems'));
    const start = role === 'student'
        ? body.lastIndexOf('return [')
        : body.indexOf('return [', body.indexOf(`if (role === '${role}')`));
    const block = body.slice(start, body.indexOf('];', start));

    const items = [...block.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)]
        .map(m => ({ id: m[1]!, label: m[2]! }));

    // Guards against the slice silently matching nothing and every assertion below
    // passing vacuously — the recurring failure in this repo's quality tests.
    if (items.length < 3) throw new Error(`navFor('${role}') parsed ${items.length} items`);
    return items;
}

describe('the manager nav', () => {
    const nav = navFor('manager');

    it('offers Fleet and Records', () => {
        expect(nav.map(i => i.id)).toContain('fleet');
        expect(nav.map(i => i.id)).toContain('records');
    });

    it('puts Records LAST, away from Dispatch', () => {
        // It edits live documents holding riders' names, phone numbers and home
        // addresses, with no undo. It must not be adjacent to the button a manager
        // presses every Friday evening.
        expect(nav[nav.length - 1]!.id).toBe('records');
        const dispatchIndex = nav.findIndex(i => i.id === 'home');
        const recordsIndex = nav.findIndex(i => i.id === 'records');
        expect(recordsIndex - dispatchIndex).toBeGreaterThan(1);
    });

    it('marks Records as separated, so the sidebar draws a divider', () => {
        expect(layoutSrc).toMatch(/id: 'records'[^}]*separated: true/);
    });

    it('keeps every label short enough for the 375px bottom nav', () => {
        // ~47px per item at 375px, and text-[10px] uppercase. "RAW RECORDS" would
        // truncate; "RECORDS" and "FLEET" do not. Eight characters is the ceiling
        // measured against the existing longest label, "Dispatch".
        for (const { label } of nav) {
            expect(label.length, `"${label}" is too long for the mobile nav`).toBeLessThanOrEqual(8);
        }
    });
});

describe('the other roles are untouched', () => {
    it('a driver sees neither Fleet nor Records', () => {
        const ids = navFor('driver').map(i => i.id);
        expect(ids).not.toContain('fleet');
        expect(ids).not.toContain('records');
    });

    it('a rider sees neither', () => {
        const ids = navFor('student').map(i => i.id);
        expect(ids).not.toContain('fleet');
        expect(ids).not.toContain('records');
    });
});

describe('every manager destination is routed', () => {
    it('TabView declares fleet and records', () => {
        expect(typesSrc).toMatch(/'fleet'/);
        expect(typesSrc).toMatch(/'records'/);
    });

    it('App.tsx has a case for each nav id — no tab silently falling to default', () => {
        // The silent failure this whole file exists for: a nav item with no `case`
        // renders ManagerDashboard, so the button "works" and shows the wrong page.
        const managerBlock = appSrc.slice(
            appSrc.indexOf("if (displayRole === 'manager')"),
            appSrc.indexOf("if (displayRole === 'driver')"),
        );
        for (const { id } of navFor('manager')) {
            expect(managerBlock, `no case for '${id}' — it would fall through to the dashboard`)
                .toMatch(new RegExp(`case '${id}':`));
        }
    });
});

describe('Setup no longer owns what moved out', () => {
    const setupSrc = readFileSync(path.join(ROOT, 'components/manager/ManagerSetup.tsx'), 'utf8');

    it('does not render Fleet or the record console any more', () => {
        expect(setupSrc).not.toMatch(/<FleetManagement/);
        expect(setupSrc).not.toMatch(/<DatabaseConsole/);
    });

    it('keeps the three sections that describe a sabha', () => {
        for (const id of ["'calendar'", "'window'", "'venue'"]) {
            expect(setupSrc).toContain(id);
        }
    });
});

describe('the Raw records warning survived the move', () => {
    // It was attached to Setup's accordion row. Losing it while promoting the tool
    // to a nav item would be strictly worse: easier to reach, with no warning.
    vi.mock('../../components/manager/DatabaseConsole', () => ({
        DatabaseConsole: () => <div>console</div>,
    }));

    // Added when the member export moved onto this page. It reaches
    // `src/utils/cloudFunctions`, which calls `getFunctions(app)` at module scope and
    // drags in `firebase/config` — and that calls `getAuth()` at import time, so
    // importing ManagerRecords now needs real Firebase credentials unless this is
    // mocked. Stubbed rather than given credentials: this file is about the WARNINGS
    // on the page, and a test of those should not depend on an .env.
    vi.mock('../../components/manager/MemberExportCard', () => ({
        MemberExportCard: () => <div>export</div>,
    }));

    it('names the data at risk and says there is no undo', async () => {
        const { ManagerRecords } = await import('../../components/manager/ManagerRecords');
        render(<ManagerRecords />);

        // TWO notes now: the standing danger warning, and the one carve-out from
        // it. Found by content rather than by role alone, so neither can quietly
        // replace the other.
        const notes = screen.getAllByRole('note');
        const danger = notes.find(n => /no undo/i.test(n.textContent || ''))!;

        expect(danger).toBeDefined();
        expect(danger.textContent).toMatch(/names, phone numbers and home addresses/);
    });

    it('says that changing a role is the one checked route on the page', async () => {
        // Without this the warning above is misleading in the other direction: a
        // manager would reasonably assume the role controls are as unguarded as
        // the field editor beside them, when they are the opposite — checked,
        // refused mid-run, and audited.
        const { ManagerRecords } = await import('../../components/manager/ManagerRecords');
        render(<ManagerRecords />);

        const notes = screen.getAllByRole('note');
        const carveOut = notes.find(n => /Except roles/i.test(n.textContent || ''))!;

        expect(carveOut).toBeDefined();
        expect(carveOut.textContent).toMatch(/name/i);
        expect(carveOut.textContent).toMatch(/audit log/i);
    });
});
