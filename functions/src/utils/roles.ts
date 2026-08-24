/**
 * Server mirror of src/roles.ts. Separate tsconfigs, no shared path, so the two
 * files must hold identical tables — see that file for the full rationale.
 *
 * The two distinctions that matter:
 *   - recordedRoles = what the document says. Authority questions use this.
 *   - grantedRoles  = hierarchy expanded (manager may act as driver or student).
 *     Capability questions use this. Expansion runs DOWNWARD only.
 *   - activeRole is excluded from both. It is a UI preference, not a role, and a
 *     user cannot even persist it (firestore.rules denies it in
 *     touchesPrivilegeFields), which is why the dispatch pool that queries it
 *     matches nobody.
 */

import { UserRole } from '../types';

/** Ranked most to least privileged. */
export const ROLE_ORDER: UserRole[] = ['manager', 'driver', 'student'];

/** What each recorded role lets a person act as. Downward only. */
const IMPLIES: Record<UserRole, UserRole[]> = {
    manager: ['manager', 'driver', 'student'],
    driver: ['driver', 'student'],
    student: ['student'],
};

export interface RoleBearing {
    role?: unknown;
    registeredRole?: unknown;
    roles?: unknown;
    accountStatus?: unknown;
    /** Declared so real documents type-check, and never read. See src/roles.ts. */
    activeRole?: unknown;
}

function isRole(value: unknown): value is UserRole {
    return value === 'manager' || value === 'driver' || value === 'student';
}

/** Roles the document literally records, deduplicated and ranked. */
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

/** Everything the person may act as, hierarchy expanded and ranked. */
export function grantedRoles(profile: RoleBearing | null | undefined): UserRole[] {
    const granted = new Set<UserRole>();
    recordedRoles(profile).forEach(r => IMPLIES[r].forEach(g => granted.add(g)));
    return ROLE_ORDER.filter(r => granted.has(r));
}

/**
 * The four role fields as they SHOULD look for exactly this role.
 *
 * One place, because a role change has to write all four together and every
 * writer in the app has historically written a different subset — signup wrote
 * the recorded role into `roles[]`, the invite path wrote the granted set, and
 * the Records tab's raw editor wrote whichever single field you clicked.
 *
 * `roles` is the GRANTED set, not `[role]`. `useAvailableDrivers` queries
 * `roles array-contains 'driver'`, so a Sarthi whose array said only `['driver']`
 * would drop out of every rider query, and `['manager']` once made every manager
 * invisible to the driver picker.
 */
export function roleFieldsFor(role: UserRole): {
    role: UserRole;
    registeredRole: UserRole;
    roles: UserRole[];
    activeRole: UserRole;
} {
    return {
        role,
        registeredRole: role,
        roles: grantedRoles({ role }),
        activeRole: role,
    };
}

/**
 * Do all four fields already agree that the person is exactly this?
 *
 * NOT `hasRecordedRole`. That reads the three fields as a UNION, so it cannot
 * tell a healthy Sarthi (`role: 'driver'`, `roles: ['driver','student']`) from the
 * half-write the raw editor could always produce (`role: 'driver'`,
 * `roles: ['student']`) — both report 'driver' among their recorded roles. The
 * difference only shows when the fields are compared one by one, which is what
 * this does.
 *
 * Used for two things that are the same question: whether a role change has any
 * work to do, and whether a record needs repairing.
 */
export function statesRoleConsistently(
    profile: RoleBearing | null | undefined,
    role: UserRole,
): boolean {
    if (!profile) return false;

    const want = roleFieldsFor(role);
    const have = Array.isArray(profile.roles) ? profile.roles : [];

    return profile.role === want.role
        && profile.registeredRole === want.registeredRole
        && profile.activeRole === want.activeRole
        && have.length === want.roles.length
        && want.roles.every(r => have.includes(r));
}

/** Does the document record this role outright? Authority question. */
export function hasRecordedRole(profile: RoleBearing | null | undefined, role: UserRole): boolean {
    return recordedRoles(profile).includes(role);
}

/** May this person act as this role? Capability question — hierarchy applies. */
export function hasGrantedRole(profile: RoleBearing | null | undefined, role: UserRole): boolean {
    return grantedRoles(profile).includes(role);
}
