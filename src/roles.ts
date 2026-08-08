/**
 * One reading of "what is this person allowed to be".
 *
 * A user document carries FOUR role fields and the code disagreed about which
 * one is authoritative:
 *
 *   role            queried by useUsers (driver picker) and ManagerReports
 *   registeredRole  never queried, but AuthContext decided the role switcher from it alone
 *   roles[]         queried by both pending-approval queues
 *   activeRole      queried by globalAssignDriver to build the dispatch pool
 *
 * Two distinctions matter, and conflating them is what caused the bugs:
 *
 * 1. **Recorded vs granted.** `recordedRoles` is what the document literally
 *    says. `grantedRoles` expands the hierarchy the app has always implied — a
 *    manager may act as a driver or a student. Expansion only ever runs
 *    DOWNWARD; being a driver never makes anyone a manager.
 *
 * 2. **`activeRole` is not a role.** It records which hat someone is wearing in
 *    the UI, not what they may do. It is deliberately excluded from both
 *    functions here. Treating it as authority is why manualAssignStudent was
 *    weaker than the rules, and querying the dispatch pool on it is why that
 *    pool matches nobody: firestore.rules lists activeRole in
 *    touchesPrivilegeFields(), so a user cannot write it, so the RoleSwitcher
 *    only ever changes React state and the stored value stays frozen at signup.
 *
 * Mirrored in functions/src/utils/roles.ts — separate tsconfigs, no shared path.
 * The two tables must stay identical.
 */

import type { UserRole } from '../types';

/** Ranked most to least privileged. Also the display order of the role switcher. */
export const ROLE_ORDER: UserRole[] = ['manager', 'driver', 'student'];

/** What each recorded role lets a person act as. Downward only. */
const IMPLIES: Record<UserRole, UserRole[]> = {
    manager: ['manager', 'driver', 'student'],
    driver: ['driver', 'student'],
    student: ['student'],
};

/** The shape these functions read. Loose on purpose — callers pass raw documents. */
export interface RoleBearing {
    role?: unknown;
    registeredRole?: unknown;
    roles?: unknown;
    accountStatus?: unknown;
    /**
     * Declared so real documents type-check, and never read. Listing it makes the
     * omission visible: the next person sees a field that exists and is
     * deliberately ignored, rather than one that was forgotten.
     */
    activeRole?: unknown;
}

function isRole(value: unknown): value is UserRole {
    return value === 'manager' || value === 'driver' || value === 'student';
}

/**
 * Roles the document literally records, deduplicated and ranked.
 *
 * Use this for authority questions ("is this a manager?"). Never expanded, so a
 * manager is not reported as a driver here.
 */
export function recordedRoles(profile: RoleBearing | null | undefined): UserRole[] {
    if (!profile) return [];

    const found = new Set<UserRole>();
    if (isRole(profile.role)) found.add(profile.role);
    if (isRole(profile.registeredRole)) found.add(profile.registeredRole);
    if (Array.isArray(profile.roles)) {
        profile.roles.forEach(r => { if (isRole(r)) found.add(r); });
    }

    return ROLE_ORDER.filter(r => found.has(r));
}

/**
 * Everything the person may act as, hierarchy expanded and ranked.
 *
 * This is what the role switcher offers. It reproduces the old
 * `getAvailableRoles()` output exactly for every document shape in production
 * (verified: no user has disagreeing role fields), while also handling the case
 * that returned an empty list before — a document recording the role only in
 * `roles[]`, which the old code, reading `registeredRole || role`, missed.
 */
export function grantedRoles(profile: RoleBearing | null | undefined): UserRole[] {
    const granted = new Set<UserRole>();
    recordedRoles(profile).forEach(r => IMPLIES[r].forEach(g => granted.add(g)));
    return ROLE_ORDER.filter(r => granted.has(r));
}

/** Does the document record this role outright? Authority question. */
export function hasRecordedRole(profile: RoleBearing | null | undefined, role: UserRole): boolean {
    return recordedRoles(profile).includes(role);
}

/** May this person act as this role? Capability question — hierarchy applies. */
export function hasGrantedRole(profile: RoleBearing | null | undefined, role: UserRole): boolean {
    return grantedRoles(profile).includes(role);
}

/**
 * The authority test, matching isManager() in firestore.rules and
 * assertApprovedManager in functions/src/utils/authz.ts.
 *
 * Recorded, not granted: nothing below manager may imply it.
 */
export function isApprovedManager(profile: RoleBearing | null | undefined): boolean {
    return profile?.accountStatus === 'approved' && hasRecordedRole(profile, 'manager');
}
