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

/** Does the document record this role outright? Authority question. */
export function hasRecordedRole(profile: RoleBearing | null | undefined, role: UserRole): boolean {
    return recordedRoles(profile).includes(role);
}

/** May this person act as this role? Capability question — hierarchy applies. */
export function hasGrantedRole(profile: RoleBearing | null | undefined, role: UserRole): boolean {
    return grantedRoles(profile).includes(role);
}
