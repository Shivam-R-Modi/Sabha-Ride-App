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
 *   manager        Sabha Seva, plus a switch, so they can see what a newcomer sees.
 *   everybody else Sabha Seva only. A Sarthi additionally gets the Arrivals TAB, which
 *                  is a destination in the app they already use rather than a service
 *                  they switch to.
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
 * Where a service opens.
 *
 * This is what keeps one shared `TabView` union safe: whenever the service changes,
 * `currentTab` is sent here. So a sabha `switch (currentTab)` can never be handed an
 * airport value, and the mobile dock always has an item that matches instead of showing
 * nothing selected until the first tap.
 */
export const SERVICE_HOME: Record<Service, TabView> = {
    sabha: 'home',
    airport: 'airport-request',
};

/**
 * Which tabs belong to which service.
 *
 * `profile` is in both — it is the same screen either way, and a traveller editing their
 * name should not be thrown out of the service to do it.
 */
const AIRPORT_TABS: TabView[] = ['airport-request', 'profile'];

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
export function tabBelongsTo(tab: TabView, service: Service): boolean {
    return service === 'airport' ? AIRPORT_TABS.includes(tab) : tab !== 'airport-request';
}

export const SERVICE_LABEL: Record<Service, string> = {
    sabha: 'Sabha Seva',
    airport: 'Airport Seva',
};
