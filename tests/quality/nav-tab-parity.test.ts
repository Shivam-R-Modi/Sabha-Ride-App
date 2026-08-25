/**
 * THE NAV LIST AND THE TAB INVARIANT MUST AGREE, FOR EVERY ROLE AND EVERY SERVICE.
 *
 * `getNavItems(role, service)` in components/Layout.tsx decides what a person can tap.
 * `tabBelongsTo(tab, service, role)` in src/constants/service.ts decides whether the tab
 * they are on is legal, and `serviceHome` decides where they are sent when it is not.
 * Those are two statements of the same fact, written in two files, and until this test
 * existed nothing held them together.
 *
 * WHAT DRIFT COSTS, in the two directions:
 *
 *   A tab in the NAV but not allowed by `tabBelongsTo` → tapping it fires the reset
 *   effect, which bounces straight back to the service home. A nav item that cannot be
 *   navigated to: the dead control this codebase keeps removing.
 *
 *   A tab ALLOWED but not in the nav → reachable, with nothing lit in the dock and no
 *   way back except the browser. That is the exact defect the reset was written to
 *   prevent, and it shipped once already — an arriving traveller's first render left
 *   `currentTab` at 'home', which no airport nav item matches.
 *
 * Written when the Arrivals board moved out of a manager's sabha nav and into their
 * Airport Seva, which put the same tab in different services for different roles. That
 * is a correct arrangement — a Sarthi has no switch and must reach the board from sabha,
 * a manager has one and switches to it — but it is exactly the shape that drifts.
 */

import { describe, it, expect } from 'vitest';

// Layout pulls in contexts that reach firebase/config, which calls getAuth() at import
// time. Stubbed rather than relying on a .env.local being present.
import { vi } from 'vitest';
vi.mock('../../firebase/config', () => ({ db: {}, auth: {}, app: {} }));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ userProfile: null, logout: vi.fn(), currentUser: null,
        getAvailableRoles: () => [], activeRole: 'student', setActiveRole: vi.fn() }),
}));

import { getNavItems } from '../../components/Layout';
import { serviceHome, tabBelongsTo } from '../../src/constants/service';
import type { Service, UserRole } from '../../types';

const ROLES: UserRole[] = ['student', 'driver', 'manager'];
const SERVICES: Service[] = ['sabha', 'airport'];

/** Every (role, service) pair, as a flat list, so a failure names the pair. */
const PAIRS: Array<[UserRole, Service]> = ROLES.flatMap(
    role => SERVICES.map(service => [role, service] as [UserRole, Service]),
);

describe('every nav item is a tab that belongs where it is shown', () => {
    it.each(PAIRS)('%s in %s', (role, service) => {
        for (const item of getNavItems(role, service)) {
            expect(
                tabBelongsTo(item.id, service, role),
                `${role}/${service}: nav offers "${item.label}" (${item.id}) but tabBelongsTo refuses it`,
            ).toBe(true);
        }
    });
});

/**
 * THE REVERSE DIRECTION, AND IT IS NARROWER THAN IT LOOKS — worth stating, because the
 * first version of this test asserted the wide version and failed correctly.
 *
 * `tabBelongsTo` answers "which SERVICE does this tab live in", NOT "may this role see
 * it". It is not an authorisation check and must not be mistaken for one: it returns
 * true for 'people' and 'records' whatever the role, because those are sabha tabs and
 * the question was about the service. Role gating for sabha tabs is App.tsx's per-role
 * `switch (currentTab)` with a `default:` that falls back to that role's own dashboard.
 *
 * So the reachability check applies only to the SERVICE-SCOPED tabs — the two whose
 * service genuinely depends on who is asking. Those are the ones that can strand
 * somebody, and 'arrivals' is the one that just moved.
 */
describe('a service-scoped tab that belongs is reachable from the nav', () => {
    const SERVICE_SCOPED = ['arrivals', 'airport-request'] as const;

    it.each(PAIRS)('%s in %s', (role, service) => {
        const navIds = getNavItems(role, service).map(item => item.id);
        for (const tab of SERVICE_SCOPED) {
            if (!tabBelongsTo(tab, service, role)) continue;
            // A student is allowed 'arrivals' in sabha by the service test above and has
            // no nav item for it, which is correct: the board is gated on the driver
            // role in firestore.rules, so offering it would be a screen of refusals.
            if (tab === 'arrivals' && service === 'sabha' && role === 'student') continue;
            expect(
                navIds,
                `${role}/${service}: tabBelongsTo allows "${tab}" but no nav item points at it`,
            ).toContain(tab);
        }
    });

    it('nothing outside those two moved service, so the sabha nav is untouched', () => {
        // The guard on this whole change: a manager lost exactly one destination and a
        // Sarthi lost none.
        expect(getNavItems('manager', 'sabha').map(i => i.id)).toEqual([
            'home', 'people', 'history', 'fleet', 'setup', 'profile', 'notices', 'records',
        ]);
        expect(getNavItems('driver', 'sabha').map(i => i.id)).toEqual([
            'home', 'arrivals', 'history', 'profile',
        ]);
    });
});

describe('the home of a service is in that service', () => {
    it.each(PAIRS)('%s in %s', (role, service) => {
        const home = serviceHome(service, role);
        expect(tabBelongsTo(home, service, role), `${role}/${service}: home is ${home}`).toBe(true);
        expect(getNavItems(role, service).map(i => i.id)).toContain(home);
    });
});

describe('the board is in exactly one service per role', () => {
    /**
     * The assertion this file was written for. Not "the board is in sabha" or "the board
     * is in airport" — both are true, for different roles — but that it is in EXACTLY ONE
     * for each of them, so nobody has two doors to it and nobody has none.
     */
    it.each(ROLES)('%s reaches Arrivals from one service or neither, never both', (role) => {
        const inSabha = tabBelongsTo('arrivals', 'sabha', role);
        const inAirport = tabBelongsTo('arrivals', 'airport', role);
        expect(inSabha && inAirport).toBe(false);
    });

    it('a manager reaches it from Airport Seva, because they have a switch', () => {
        expect(tabBelongsTo('arrivals', 'airport', 'manager')).toBe(true);
        expect(tabBelongsTo('arrivals', 'sabha', 'manager')).toBe(false);
    });

    it('a Sarthi reaches it from Sabha Seva, because they have none', () => {
        // If this ever flips, a Sarthi loses the board entirely: nothing offers them a
        // service switch, so an airport-only board would be unreachable for them.
        expect(tabBelongsTo('arrivals', 'sabha', 'driver')).toBe(true);
        expect(tabBelongsTo('arrivals', 'airport', 'driver')).toBe(false);
    });

    it('a Bhulku reaches it from neither', () => {
        expect(tabBelongsTo('arrivals', 'sabha', 'student')).toBe(true);
        // ...but has no nav item for it, which the reachability test above covers. The
        // board itself is gated on the driver role in the rules; a Bhulku opening it
        // would see every query refused.
        expect(getNavItems('student', 'sabha').map(i => i.id)).not.toContain('arrivals');
    });
});

describe("a manager's Airport Seva is not the traveller's", () => {
    it('offers the board, not a form that would file their own pickup', () => {
        // The defect this replaced: a manager switching to Airport Seva got the
        // newcomer's live request form, plus an "I am in the USA now" button that wrote
        // `isArriving: false` where it was already false and so did nothing at all.
        const ids = getNavItems('manager', 'airport').map(i => i.id);
        expect(ids).toEqual(['arrivals', 'profile']);
        expect(ids).not.toContain('airport-request');
    });

    it('opens on the board', () => {
        expect(serviceHome('airport', 'manager')).toBe('arrivals');
    });

    it("and a traveller's still opens on their own pickup", () => {
        expect(serviceHome('airport', 'student')).toBe('airport-request');
        expect(getNavItems('student', 'airport').map(i => i.id))
            .toEqual(['airport-request', 'profile']);
    });
});
