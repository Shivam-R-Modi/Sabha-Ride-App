/**
 * Every callable wrapper asks for the name it means to ask for.
 *
 * This exists because two of them did not. `publishNotice` and `deleteNotice`
 * passed `'"publishNotice"'` and `'"deleteNotice"'` — the name with literal double
 * quotes inside the string. `httpsCallable(functions, name)` builds the URL from
 * `name` verbatim, so both requests went to `.../"publishNotice"` and 404'd, and
 * the manager Notices tab's Publish and Take-down buttons did nothing at all.
 * The repo's signature failure: a control that looks wired up and is inert.
 *
 * This file used to be unable to catch that. It never imported the module — it
 * REPLICATED `downloadCSV` locally to dodge the Firebase init that happens at
 * import time, so no wrapper had ever been executed by a test. The replica had
 * already drifted too: the real `downloadCSV` prepends a UTF-8 BOM and the copy
 * did not. Mocking `firebase/functions` and `@/firebase/config` costs six lines
 * and makes the whole module reachable, so both problems close together.
 *
 * The name assertions are three-deep on purpose, cheapest first:
 *   1. it equals the expected bare string,
 *   2. it contains no quote character — the specific bug, stated as a class,
 *   3. it is a name `functions/src/index.ts` actually exports.
 *
 * (3) is the one that catches the next variant. A typo, a rename, or a callable
 * deleted server-side all produce the same silent 404, and only parity against
 * the deployed export list notices. Same reasoning as
 * tests/quality/agenda-cap.test.ts: a value written down twice must be checked,
 * because the drift is invisible from either side alone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Hoisted so the vi.mock factory below can close over them — vi.mock is lifted
// above the imports, so a plain `const` here would still be uninitialised.
const mocks = vi.hoisted(() => {
    const callable = vi.fn((_data?: unknown) => Promise.resolve({ data: {} }));
    return { callable, httpsCallable: vi.fn((_functions: unknown, _name: string) => callable) };
});

// cloudFunctions.ts calls getFunctions(app) at module scope, so both of these
// have to be in place before the import below or it reaches for a real Firebase
// app. Same shape as the vi.mock('../../firebase/config') in tests/utils/audit.test.ts;
// the specifier matches the source's `@/firebase/config` exactly.
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: mocks.httpsCallable,
}));
vi.mock('@/firebase/config', () => ({ app: {}, default: {} }));

import * as cloudFunctions from '../../src/utils/cloudFunctions';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/constants/notifications';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Every name re-exported by functions/src/index.ts, i.e. every callable that is
 * actually deployed. Anchored to line start so the prose in that file's comments
 * — which names several callables that were deliberately DELETED — cannot count.
 */
const DEPLOYED = new Set(
    [...readFileSync(path.join(ROOT, 'functions/src/index.ts'), 'utf8')
        .matchAll(/^export\s*\{([^}]+)\}\s*from/gm)]
        .flatMap(([, names]) => names.split(',')
            .map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())
            .filter(Boolean)),
);

/** The name this wrapper handed to httpsCallable, plus the payload it sent. */
async function callOf(invoke: () => Promise<unknown>): Promise<{ name: string; data: unknown }> {
    mocks.httpsCallable.mockClear();
    mocks.callable.mockClear();
    await invoke();
    expect(mocks.httpsCallable, 'the wrapper never reached httpsCallable').toHaveBeenCalledOnce();
    return {
        name: mocks.httpsCallable.mock.calls[0][1],
        data: mocks.callable.mock.calls[0]?.[0],
    };
}

function assertName(name: string, expected: string) {
    expect(name).toBe(expected);
    // Stated separately from the equality above so the failure message says which
    // of the two things went wrong. This is the bug that shipped.
    expect(name, `callable name ${JSON.stringify(name)} contains a quote character`)
        .not.toMatch(/['"`]/);
    expect(DEPLOYED, `no export of ${name} in functions/src/index.ts`).toContain(name);
}

/** One row per wrapper whose callable name is just its own name. */
const WRAPPERS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    ['globalAssignDriver', () => cloudFunctions.globalAssignDriver('d1', 'c1')],
    ['startRide', () => cloudFunctions.startRide('r1')],
    ['publishNotice', () => cloudFunctions.publishNotice({ title: 'Sabha moved', body: 'Sabha moved to 7pm' })],
    ['deleteNotice', () => cloudFunctions.deleteNotice('n1')],
    ['managerBroadcast', () => cloudFunctions.managerBroadcast('Sabha moved to 7pm')],
    ['updateNotificationSettings', () => cloudFunctions.updateNotificationSettings(
        DEFAULT_NOTIFICATION_SETTINGS)],
    ['sarthiArrived', () => cloudFunctions.sarthiArrived('r1')],
    ['nudgeRider', () => cloudFunctions.nudgeRider('r1', 's1')],
    ['completeRide', () => cloudFunctions.completeRide('r1')],
    ['releaseAssignment', () => cloudFunctions.releaseAssignment('r1')],
    ['driverDoneForToday', () => cloudFunctions.driverDoneForToday('d1')],
    ['updateSabhaRecurrence', () => cloudFunctions.updateSabhaRecurrence({
        enabled: true, daysOfWeek: [0], startTime: '18:00', endTime: '20:00',
    })],
    ['managerReleaseVehicle', () => cloudFunctions.managerReleaseVehicle('v1')],
    ['managerSetUserRole', () => cloudFunctions.managerSetUserRole('u1', 'driver')],
    ['studentReadyToLeave', () => cloudFunctions.studentReadyToLeave('s1')],
    ['manualAssignStudent', () => cloudFunctions.manualAssignStudent('s1', 'd1')],
    ['generateEventCSV', () => cloudFunctions.generateEventCSV('2026-08-24')],
    ['createManagerInvite', () => cloudFunctions.createManagerInvite('Mira')],
    ['redeemManagerInvite', () => cloudFunctions.redeemManagerInvite('CODE1234')],
    ['requestAirportPickup', () => cloudFunctions.requestAirportPickup({
        arrivalDate: '2099-09-20', arrivalTime: '22:00', airportCode: 'BOS',
        isInternational: true, partySize: 1, largeBags: 2, cabinBags: 1,
        dropoffAddress: '360 Huntington Ave', dropoffLat: 42.34, dropoffLng: -71.09,
        hasUsWorkingPhone: false, fullName: 'Ramesh Patel', dateOfBirth: '2007-04-11',
        email: 'r@example.com', phone: '+16175550123', whatsappOn: 'primary',
    })],
    ['updateAirportPickup', () => cloudFunctions.updateAirportPickup({
        pickupId: 'p1', action: 'claim',
    })],
    ['exportMembers', () => cloudFunctions.exportMembers('all')],
    ['manuallyUpdateRideContext', () => cloudFunctions.manuallyUpdateRideContext({ reset: true })],
];

/**
 * The wrappers below whose callable name is NOT their own name, so the table
 * above cannot hold them. Counted here so the coverage check at the bottom stays
 * honest when one is added.
 */
const SPECIAL_CASE_SITES = 4;

describe('callable names', () => {
    it.each(WRAPPERS)('%s targets its own name', async (expected, invoke) => {
        assertName((await callOf(invoke)).name, expected);
    });

    // Both of these call 'deleteSabhaEvent' — the preview is the same callable
    // with dryRun, not a second endpoint. So the expected name is not derivable
    // from the wrapper's name, which is exactly how a wrong one hides.
    it('previewDeleteSabhaEvent targets deleteSabhaEvent, as a dry run', async () => {
        const { name, data } = await callOf(() => cloudFunctions.previewDeleteSabhaEvent('2026-08-24'));
        assertName(name, 'deleteSabhaEvent');
        expect(data).toMatchObject({ date: '2026-08-24', dryRun: true });
    });

    it('deleteSabhaEvent targets deleteSabhaEvent, without dryRun', async () => {
        const { name, data } = await callOf(() => cloudFunctions.deleteSabhaEvent('2026-08-24', true));
        assertName(name, 'deleteSabhaEvent');
        expect(data).toMatchObject({ date: '2026-08-24', acknowledge: true });
        expect(data).not.toHaveProperty('dryRun');
    });

    // Two call sites behind one wrapper, one per input shape. Either could carry
    // a bad name on its own.
    it('adminDeleteUserViaCloud targets adminDeleteUser for a single id', async () => {
        const { name, data } = await callOf(() => cloudFunctions.adminDeleteUserViaCloud('u1'));
        assertName(name, 'adminDeleteUser');
        expect(data).toMatchObject({ targetUserId: 'u1' });
    });

    it('adminDeleteUserViaCloud targets adminDeleteUser for a batch', async () => {
        const { name, data } = await callOf(() => cloudFunctions.adminDeleteUserViaCloud(['u1', 'u2']));
        assertName(name, 'adminDeleteUser');
        expect(data).toMatchObject({ targetUserIds: ['u1', 'u2'] });
    });

    it('parses a plausible export list out of functions/src/index.ts', () => {
        // Without this, a regex that silently matched nothing would make every
        // DEPLOYED assertion above vacuously... fail, actually — but it would fail
        // for the wrong reason, and this says so in one line.
        expect(DEPLOYED.size).toBeGreaterThan(15);
        expect(DEPLOYED).toContain('publishNotice');
        expect(DEPLOYED).toContain('deleteNotice');
        // Deleted server-side and named only in that file's comments.
        expect(DEPLOYED).not.toContain('verifyManagerCode');
        expect(DEPLOYED).not.toContain('geocodeAddress');
    });

    it('covers every callFunction site in the module', () => {
        // The point of the count: adding a wrapper without adding a case here is
        // otherwise invisible, and an uncovered wrapper is how this bug survived.
        const source = readFileSync(path.join(ROOT, 'src/utils/cloudFunctions.ts'), 'utf8');
        const sites = (source.match(/return callFunction[<(]/g) ?? []).length;
        expect(sites).toBe(WRAPPERS.length + SPECIAL_CASE_SITES);
    });
});

// jsdom does not implement URL.createObjectURL, so we mock it
const createObjectURLMock = vi.fn((_blob: Blob) => 'blob:http://localhost/mock-blob-url');
const revokeObjectURLMock = vi.fn();

beforeEach(() => {
    globalThis.URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;
});

afterEach(() => {
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
});

const { downloadCSV } = cloudFunctions;

describe('downloadCSV', () => {
    let clickSpy: ReturnType<typeof vi.fn>;
    let appendChildSpy: ReturnType<typeof vi.spyOn>;
    let removeChildSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        clickSpy = vi.fn();
        appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            // Attach our spy to the click method
            (node as HTMLElement).click = clickSpy;
            return node;
        });
        removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    });

    it('creates an anchor element and triggers click', () => {
        downloadCSV('name,age\nAlice,30', 'test.csv');
        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('sets download attribute to the given filename', () => {
        // Capture the element passed to appendChild
        let capturedLink: HTMLAnchorElement | null = null;
        appendChildSpy.mockImplementation((node) => {
            capturedLink = node as HTMLAnchorElement;
            capturedLink.click = clickSpy;
            return node;
        });

        downloadCSV('a,b\n1,2', 'report_2026.csv');
        expect(capturedLink).not.toBeNull();
        expect(capturedLink!.getAttribute('download')).toBe('report_2026.csv');
    });

    it('sets visibility to hidden', () => {
        let capturedLink: HTMLAnchorElement | null = null;
        appendChildSpy.mockImplementation((node) => {
            capturedLink = node as HTMLAnchorElement;
            capturedLink.click = clickSpy;
            return node;
        });

        downloadCSV('data', 'file.csv');
        expect(capturedLink!.style.visibility).toBe('hidden');
    });

    it('removes the link after clicking', () => {
        downloadCSV('x', 'y.csv');
        expect(removeChildSpy).toHaveBeenCalledOnce();
    });

    it('sets the href to a blob URL', () => {
        let capturedLink: HTMLAnchorElement | null = null;
        appendChildSpy.mockImplementation((node) => {
            capturedLink = node as HTMLAnchorElement;
            capturedLink.click = clickSpy;
            return node;
        });

        downloadCSV('hello', 'test.csv');
        const href = capturedLink!.getAttribute('href');
        expect(href).toBeTruthy();
        expect(href!.startsWith('blob:')).toBe(true);
    });

    it('prepends a UTF-8 BOM so Excel does not mangle non-ASCII names', async () => {
        // The reason the local replica of this function had to go: it omitted the
        // BOM, so this would have passed against a copy that was wrong. Excel
        // reads a BOM-less UTF-8 CSV as Latin-1, and for this congregation most
        // names are non-ASCII.
        //
        // Asserted on BYTES, not via blob.text(). text() runs UTF-8 decode, which
        // per spec STRIPS a leading BOM — so the string comes back without the one
        // character this test exists to check, and passes whether the BOM was
        // written or not. Bytes are what Excel reads anyway.
        downloadCSV('name\nÅsa', 'test.csv');
        const blob = createObjectURLMock.mock.calls[0][0];
        const bytes = new Uint8Array(await blob.arrayBuffer());
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(new TextDecoder().decode(bytes.slice(3))).toBe('name\nÅsa');
    });
});
