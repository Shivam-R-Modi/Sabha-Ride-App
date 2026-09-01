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
 *   can drive      Sabha Seva, plus a switch to Airport Seva, which is where the
 *                  ARRIVALS BOARD lives. Sarthis and managers alike.
 *   everybody else Sabha Seva only, with no switch and no board.
 *
 * THE BOARD IS IN AIRPORT SEVA AND NOWHERE ELSE. It took three passes to get here and
 * the two wrong answers are worth keeping, because both looked reasonable.
 *
 * FIRST it was a sabha tab for Sarthis and managers both, on the reasoning that
 * claiming a trip is one more thing somebody who already lives here does. That gave a
 * manager an Airport Seva containing the TRAVELLER's screen — a live form that would
 * file the manager their own pickup, and an "I am in the USA now" button that wrote
 * `isArriving: false` where it was already false and so did nothing at all.
 *
 * SECOND it moved to Airport Seva for managers only, leaving it a sabha tab for
 * Sarthis, because a Sarthi had no switch and would otherwise lose the board entirely.
 * That put one screen in different services for different roles, which is what the
 * owner then asked about — correctly.
 *
 * NOW: anybody who can claim a trip can switch service, so the board can live in one
 * place. `hasGrantedRole('driver')` is exactly the right predicate — it is true for a
 * Sarthi and for a manager, false for a Bhulku, and it is the same capability the
 * board's own Firestore rules gate on. Reaching the board and being allowed to use it
 * are now the same question, which is why there is no longer a role that can see it
 * and no role that is stranded without it.
 *
 * NOT MIRRORED SERVER-SIDE, deliberately. Nothing on the server reads `isArriving` —
 * `updateAirportPickup` only ever clears it — so there is no second copy to drift and
 * no parity test to write. Compare src/utils/arrival.ts, which IS mirrored because both
 * sides decide transitions from it.
 */

import type { Service, TabView, UserRole } from '../../types';
import { hasGrantedRole } from '../roles';

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
 * Anybody who can claim an airport trip may hold two services.
 *
 * `hasGrantedRole('driver')`, and the GRANTED set is deliberate here where it would be
 * wrong elsewhere. This is a CAPABILITY question — "could this person drive somebody
 * home from the airport" — not a question of authority, so the expanded hierarchy is
 * the right thing to read: a manager's grants include `driver`, so one predicate covers
 * both. Contrast `isApprovedManagerData` on the server, which asks about authority and
 * therefore must read the recorded role.
 *
 * It used to be `hasRecordedRole(profile, 'manager')`, when the board was a sabha tab
 * for Sarthis and only managers switched. Once the board moved into Airport Seva for
 * good, that predicate would have left every Sarthi unable to reach the one screen the
 * service exists for.
 *
 * A Bhulku's grants are `['student']`, so they still get no switch — which was the
 * whole point of removing the launcher. Nothing here gives anybody data they could not
 * already reach: `firestore.rules` gates the board on the driver role independently, so
 * a switch is a route, not a permission.
 */
export function canSwitchService(profile: Arrivable | null | undefined): boolean {
    if (!profile) return false;
    return profile.accountStatus === 'approved' && hasGrantedRole(profile, 'driver');
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
 * CHOSEN BY `arriving`, NOT BY ROLE — and the first version got this wrong, so the
 * reasoning is written down.
 *
 * Role looked like the obvious discriminator: at the time only a manager could switch
 * here, so manager meant oversight. But the role every nav reads is the ACTIVE one, and the
 * RoleSwitcher lets a manager wear the Sarthi hat. `canSwitchService` reads the
 * RECORDED role, so the service switch stays available while they do — and with role
 * as the discriminator, a manager viewing as a Sarthi who switched to Airport Seva got
 * `['airport-request', 'profile']`: the traveller's live request form, which is the
 * exact defect moving the board here was meant to remove.
 *
 * `arriving` has no such gap. There are only two ways to be in Airport Seva — you have
 * not landed yet, or you switched — and `resolveService` will only honour a switch for
 * somebody `canSwitchService` allows. So "not arriving" is precisely "here on purpose,
 * to oversee", whatever hat they have on.
 */
const AIRPORT_TRAVELLER_TABS: TabView[] = ['airport-request', 'profile'];
const AIRPORT_OVERSIGHT_TABS: TabView[] = ['arrivals', 'profile'];

/**
 * `role` IS BACK, and the reason is different from the one it left with.
 *
 * It used to be here to answer "does the board live in sabha or in airport for this
 * person", which stopped being a question once the board got one home — so it was
 * removed as dead weight, correctly.
 *
 * What brought it back is `notifications`: a manager configures which messages the app
 * sends, and a Sarthi does not. That is a genuine per-role difference in WHICH TABS
 * EXIST, not in where one tab lives, and it cannot be answered without knowing who is
 * asking. The alternative — letting every Sarthi navigate to a screen whose callable
 * refuses them — is the dead control this codebase keeps deleting.
 *
 * THE ACTIVE ROLE, not the recorded one, which matches every other manager destination:
 * a manager wearing the Sarthi hat already loses People, Setup, Fleet and Records, and
 * losing Notifications with them is the point of the hat.
 *
 * `arrivals` STAYS FIRST whatever the role, because `serviceHome` takes the first entry
 * — so the home screen cannot drift as this list grows.
 */
export function airportTabs(arriving: boolean, role: UserRole = 'student'): TabView[] {
    if (arriving) return AIRPORT_TRAVELLER_TABS;
    return role === 'manager'
        ? ['arrivals', 'notifications', 'profile']
        : AIRPORT_OVERSIGHT_TABS;
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
export function serviceHome(
    service: Service, arriving: boolean, role: UserRole = 'student',
): TabView {
    return service === 'airport' ? airportTabs(arriving, role)[0] : 'home';
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
/**
 * `role` CAME BACK WITH `notifications` — see the note on `airportTabs`. It was removed
 * when the board got one home and there was nothing left for it to decide; a tab that
 * only managers have is something it must decide.
 */
export function tabBelongsTo(
    tab: TabView, service: Service, arriving: boolean, role: UserRole = 'student',
): boolean {
    if (service === 'airport') return airportTabs(arriving, role).includes(tab);

    // Sabha. Stated as "which tabs do NOT belong" because the sabha list is long and
    // role-dependent, and duplicating it here would be a second copy of
    // `getNavItems`. `tests/quality/nav-tab-parity.test.ts` compares the two for every
    // role and service pair, so this cannot drift away from the nav it must match.
    if (tab === 'airport-request') return false;
    // The board is an AIRPORT destination for everybody now, so it never belongs in
    // sabha — for any role, in any hat. That is what lets one screen have one home.
    if (tab === 'arrivals') return false;
    // Managers only, in either service. A Sarthi who reached it would find a screen
    // whose every save the callable refuses.
    if (tab === 'notifications') return role === 'manager';
    return true;
}

export const SERVICE_LABEL: Record<Service, string> = {
    sabha: 'Sabha Seva',
    airport: 'Airport Seva',
};
