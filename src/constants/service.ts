/**
 * Which of the two services a person gets, and where it opens.
 *
 * DERIVED, NOT CHOSEN. This file used to serve a launcher that asked everybody which
 * service they wanted, remembered the answer in localStorage, and gave every account a
 * switch. That was wrong in both directions: a student who has lived here two years got
 * an Airport tab they will never use, and somebody still in India got offered lifts to a
 * sabha they cannot attend.
 *
 * So there is no launcher and no remembered choice. Who you are decides:
 *
 *   arriving       Airport Seva only — one screen, their own pickup.
 *   manager        Sabha Seva, plus a switch to Airport Seva, where they get the
 *                  ARRIVALS BOARD. Not the newcomer's request form: see below.
 *   everybody else Sabha Seva only. A Sarthi additionally gets the Arrivals TAB, which
 *                  is a destination in the app they already use rather than a service
 *                  they switch to.
 *
 * WHY THE BOARD IS IN TWO DIFFERENT PLACES, which looks inconsistent and is not.
 *
 * A Sarthi has no service switch — so if the board lived only in Airport Seva they
 * could never reach it. It has to be a sabha tab for them. A MANAGER is the one role
 * that holds both services, so "consistent with the Sarthi" is the wrong thing to
 * optimise for: for them Airport Seva should contain the airport work.
 *
 * The first version gave a manager the same Airport Seva a traveller gets, and that
 * was wrong twice over — a live form that would file a real pickup request for the
 * manager themselves, and an "I am in the USA now" button that wrote `isArriving:
 * false` on a profile where it was already false and therefore did nothing at all.
 * A control that fires and visibly does nothing is this codebase's signature defect.
 *
 * NOT MIRRORED SERVER-SIDE, deliberately. Nothing on the server reads `isArriving` —
 * `updateAirportPickup` only ever clears it — so there is no second copy to drift and
 * no parity test to write. Compare src/utils/arrival.ts, which IS mirrored because both
 * sides decide transitions from it.
 */

import type { Service, TabView, UserRole } from '../../types';
import { hasRecordedRole } from '../roles';

/** Anything with the shape this module needs. Keeps it testable without a full profile. */
interface Arrivable {
    isArriving?: boolean;
    role?: UserRole;
    registeredRole?: UserRole;
    roles?: UserRole[];
    accountStatus?: string;
}

/**
 * They have not landed yet.
 *
 * ABSENT MEANS ALREADY HERE. That default is the whole migration — every account that
 * predates the field keeps the app it had — and it is why this is read through a helper
 * rather than `profile?.isArriving` at each call site, the same rule `seatsOf` and the
 * `rideType` default carry.
 */
export function arrivingMember(profile: Arrivable | null | undefined): boolean {
    return profile?.isArriving === true;
}

/**
 * Only a manager may hold two services, so only a manager may override.
 *
 * `hasRecordedRole`, not `hasGrantedRole`: manager is the top of the hierarchy, and
 * reading the granted set here would hand the override to every Sarthi. Same asymmetry,
 * and same reason, as `isApprovedManagerData` in functions/src/utils/authz.ts.
 */
export function canSwitchService(profile: Arrivable | null | undefined): boolean {
    if (!profile) return false;
    return profile.accountStatus === 'approved' && hasRecordedRole(profile, 'manager');
}

/**
 * The service to render.
 *
 * `override` is the manager's momentary switch and is ignored for anybody else — the UI
 * does not offer it to them, and this makes that structural rather than a promise.
 *
 * An arriving traveller cannot be overridden INTO sabha: they have no home address and
 * no pickup point, so the sabha side has nothing to show them. They leave that state by
 * arriving, not by switching.
 */
export function resolveService(
    profile: Arrivable | null | undefined,
    override: Service | null = null,
): Service {
    if (arrivingMember(profile)) return 'airport';
    if (override && canSwitchService(profile)) return override;
    return 'sabha';
}

/**
 * Airport Seva is TWO different surfaces, chosen by role.
 *
 * A traveller books their own pickup. A manager oversees everybody's. `profile` is in
 * both, because it is the same screen either way and neither of them should be thrown
 * out of the service to change their own name.
 *
 * ROLE IS A SAFE DISCRIMINATOR HERE, and that is worth stating because it would not
 * be if an "arriving manager" could exist. `isArriving: true` is written in exactly
 * ONE place — the arriving branch of RoleSelection — and that branch always writes
 * `role: 'student'`. So there is no path by which a manager is also arriving, and no
 * case where this picks the oversight surface for somebody who is actually flying in.
 * `tests/components/RoleSelection.test.tsx` pins that pairing.
 */
const AIRPORT_TRAVELLER_TABS: TabView[] = ['airport-request', 'profile'];
const AIRPORT_OVERSIGHT_TABS: TabView[] = ['arrivals', 'profile'];

function airportTabs(role: UserRole): TabView[] {
    return role === 'manager' ? AIRPORT_OVERSIGHT_TABS : AIRPORT_TRAVELLER_TABS;
}

/**
 * Where a service opens.
 *
 * This is what keeps one shared `TabView` union safe: whenever the service changes,
 * `currentTab` is sent here. So a sabha `switch (currentTab)` can never be handed an
 * airport value, and the mobile dock always has an item that matches instead of showing
 * nothing selected until the first tap.
 *
 * The first tab of the list, not a separate constant, so the home screen cannot drift
 * away from being reachable in its own service.
 */
export function serviceHome(service: Service, role: UserRole): TabView {
    return service === 'airport' ? airportTabs(role)[0] : 'home';
}

/**
 * Is this tab reachable in this service?
 *
 * STATED AS AN INVARIANT, not as a transition. The first version of this reset the tab
 * when the service *changed*, which looked equivalent and was not: an arriving traveller
 * whose profile is already loaded on first render never sees a change, so `currentTab`
 * stayed at its `'home'` default. Nothing crashed — AirportShell falls through to the
 * traveller view — but the mobile dock highlights `currentTab === item.id` and no airport
 * item is called 'home', so it lit nothing at all. That is the exact defect the reset was
 * written to prevent, surviving inside the fix for it.
 *
 * Asking "does the tab belong here" is true on the first render and on every later one,
 * whether the service changed because a manager tapped the switch or because the server
 * cleared `isArriving` when their pickup completed.
 */
export function tabBelongsTo(tab: TabView, service: Service, role: UserRole): boolean {
    if (service === 'airport') return airportTabs(role).includes(tab);

    // Sabha. Stated as "which tabs do NOT belong" because the sabha list is long and
    // role-dependent, and duplicating it here would be a second copy of
    // `getNavItems`. `tests/quality/nav-tab-parity.test.ts` compares the two for every
    // role and service pair, so this cannot drift away from the nav it must match.
    if (tab === 'airport-request') return false;
    // The board is a sabha destination for a Sarthi, who has no switch, and an AIRPORT
    // destination for a manager, who does. So for a manager it does not belong here.
    if (tab === 'arrivals') return role !== 'manager';
    return true;
}

export const SERVICE_LABEL: Record<Service, string> = {
    sabha: 'Sabha Seva',
    airport: 'Airport Seva',
};
