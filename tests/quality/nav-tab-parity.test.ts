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

/**
 * Every (role, service, arriving) TRIPLE, so a failure names the exact combination.
 *
 * `arriving` is in here because it, not role, decides which Airport Seva renders — and
 * the pair-only version of this test could not see the hole it was added for: a manager
 * wearing the Sarthi hat, who has `role === 'driver'` and a service switch at the same
 * time.
 */
type Case = [UserRole, Service, boolean];
const CASES: Case[] = ROLES.flatMap(
    role => SERVICES.flatMap(
        service => [false, true].map(arriving => [role, service, arriving] as Case),
    ),
);

/** Only the combinations that can actually occur. An arriving manager cannot exist. */
const REAL: Case[] = CASES.filter(([role, , arriving]) => !(arriving && role === 'manager'));

describe('every nav item is a tab that belongs where it is shown', () => {
    it.each(REAL)('%s in %s, arriving=%s', (role, service, arriving) => {
        for (const item of getNavItems(role, service, arriving)) {
            expect(
                tabBelongsTo(item.id, service, role, arriving),
                `${role}/${service}/arriving=${arriving}: nav offers "${item.label}" `
                + `(${item.id}) but tabBelongsTo refuses it`,
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

    it.each(REAL)('%s in %s, arriving=%s', (role, service, arriving) => {
        const navIds = getNavItems(role, service, arriving).map(item => item.id);
        for (const tab of SERVICE_SCOPED) {
            if (!tabBelongsTo(tab, service, role, arriving)) continue;
            // A student is allowed 'arrivals' in sabha by the service test above and has
            // no nav item for it, which is correct: the board is gated on the driver
            // role in firestore.rules, so offering it would be a screen of refusals.
            if (tab === 'arrivals' && service === 'sabha' && role === 'student') continue;
            expect(
                navIds,
                `${role}/${service}/arriving=${arriving}: tabBelongsTo allows "${tab}" `
                + 'but no nav item points at it',
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
    it.each(REAL)('%s in %s, arriving=%s', (role, service, arriving) => {
        const home = serviceHome(service, role, arriving);
        expect(
            tabBelongsTo(home, service, role, arriving),
            `${role}/${service}/arriving=${arriving}: home is ${home}`,
        ).toBe(true);
        expect(getNavItems(role, service, arriving).map(i => i.id)).toContain(home);
    });
});

describe('everybody who should reach the board can, and nobody else is offered it', () => {
    /**
     * THIS BLOCK ASSERTED "exactly one service per role" AND THAT WAS WRONG.
     *
     * It was my own tidiness rather than a property of the design, and the fix that made
     * `arriving` the airport discriminator broke it — correctly. A manager wearing the
     * Sarthi hat now reaches the board from BOTH services: from sabha because the hat
     * says they are working as a Sarthi, and from Airport Seva because the switch is
     * granted by their recorded role. Two doors to the same screen, both meant.
     *
     * What actually matters is narrower and does not change: everybody who should have
     * the board has at least one route to it, and a Bhulku is never handed one, because
     * `firestore.rules` gates the board on the driver role and would refuse every query.
     */
    const doors = (role: UserRole, arriving: boolean) => ({
        sabha: tabBelongsTo('arrivals', 'sabha', role, arriving)
            && getNavItems(role, 'sabha', arriving).some(i => i.id === 'arrivals'),
        airport: tabBelongsTo('arrivals', 'airport', role, arriving)
            && getNavItems(role, 'airport', arriving).some(i => i.id === 'arrivals'),
    });

    it('a Sarthi has a door, and it is the sabha one', () => {
        // If this ever flips, a plain Sarthi loses the board entirely: nothing offers
        // them a service switch, so an airport-only board would be unreachable.
        expect(doors('driver', false).sabha).toBe(true);
    });

    it('a manager has a door, and it is the airport one', () => {
        const d = doors('manager', false);
        expect(d.airport).toBe(true);
        expect(d.sabha).toBe(false);
    });

    /**
     * WHICH COMBINATIONS A PLAIN BHULKU OR SARTHI CAN ACTUALLY BE IN — and this is where
     * two of my own expectations were wrong, so it is spelled out.
     *
     * `resolveService` puts you in Airport Seva only if you are arriving, OR if you
     * switched — and it honours a switch only for somebody `canSwitchService` allows,
     * which reads the RECORDED role. So:
     *
     *   (student, airport, arriving=false)  a MANAGER in the Bhulku hat. Reachable, and
     *                                       they correctly get the board.
     *   (driver,  sabha,   arriving=true)   NOT reachable: arriving forces airport.
     *
     * Asserting "a student gets no board in airport" would therefore have been asserting
     * that a manager loses the board by changing hats.
     */
    it('a plain Bhulku is offered no door anywhere they can actually be', () => {
        // Sabha is the whole of their app, and arriving puts them on their own request.
        expect(doors('student', false).sabha).toBe(false);
        expect(doors('student', true)).toEqual({ sabha: false, airport: false });
    });

    it('an arriving Sarthi is offered no door — they are a traveller today', () => {
        // Only the airport half is checked: `arriving` forces the service, so an arriving
        // Sarthi is never in sabha for the sabha half to matter.
        expect(doors('driver', true).airport).toBe(false);
    });

    it('a manager keeps the board through every hat, because they are still the manager', () => {
        // The switch is granted by the recorded role, so changing the displayed hat must
        // not take the oversight surface away.
        expect(doors('driver', false).airport).toBe(true);
        expect(doors('student', false).airport).toBe(true);
    });
});

describe("a manager's Airport Seva is not the traveller's", () => {
    it('offers the board, not a form that would file their own pickup', () => {
        // The defect this replaced: a manager switching to Airport Seva got the
        // newcomer's live request form, plus an "I am in the USA now" button that wrote
        // `isArriving: false` where it was already false and so did nothing at all.
        const ids = getNavItems('manager', 'airport', false).map(i => i.id);
        expect(ids).toEqual(['arrivals', 'profile']);
        expect(ids).not.toContain('airport-request');
    });

    it('opens on the board', () => {
        expect(serviceHome('airport', 'manager', false)).toBe('arrivals');
    });

    it("and a traveller's still opens on their own pickup", () => {
        expect(serviceHome('airport', 'student', true)).toBe('airport-request');
        expect(getNavItems('student', 'airport', true).map(i => i.id))
            .toEqual(['airport-request', 'profile']);
    });
});

/**
 * THE ROLESWITCHER HAT — the hole the pair-only version of this test could not see.
 *
 * `getNavItems` reads the ACTIVE role, and a manager can wear the Sarthi hat. But
 * `canSwitchService` reads the RECORDED role, so their service switch stays live while
 * they do. With `role === 'manager'` as the airport discriminator, that combination —
 * `role: 'driver'` in Airport Seva — fell to the traveller branch and served a manager
 * the newcomer's live request form. Exactly the defect that moving the board into this
 * service was meant to remove, reintroduced through a door nobody looked at.
 *
 * `arriving` closes it: there are only two ways into Airport Seva, and `resolveService`
 * only honours a switch for somebody `canSwitchService` allows. So "not arriving" means
 * "here on purpose, to oversee", whatever hat is on.
 */
describe('a manager wearing the Sarthi hat', () => {
    it('gets the BOARD in Airport Seva, not a form that files their own pickup', () => {
        const ids = getNavItems('driver', 'airport', false).map(i => i.id);
        expect(ids).toEqual(['arrivals', 'profile']);
        expect(ids).not.toContain('airport-request');
    });

    it('opens on the board there', () => {
        expect(serviceHome('airport', 'driver', false)).toBe('arrivals');
    });

    it('still gets Arrivals in the sabha dock, because that hat IS a Sarthi', () => {
        // Not a bug and not the same question: the hat says which app they meant to be
        // working in, and a Sarthi claims trips from sabha.
        expect(getNavItems('driver', 'sabha', false).map(i => i.id))
            .toEqual(['home', 'arrivals', 'history', 'profile']);
    });

    it('and an actually-arriving Bhulku still gets their own form', () => {
        // The other direction: `arriving` must not hand the board to a traveller, whose
        // every query on it firestore.rules would refuse.
        expect(getNavItems('student', 'airport', true).map(i => i.id))
            .toEqual(['airport-request', 'profile']);
        expect(getNavItems('driver', 'airport', true).map(i => i.id))
            .toEqual(['airport-request', 'profile']);
    });
});
