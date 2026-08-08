"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_ORDER = void 0;
exports.recordedRoles = recordedRoles;
exports.grantedRoles = grantedRoles;
exports.hasRecordedRole = hasRecordedRole;
exports.hasGrantedRole = hasGrantedRole;
/** Ranked most to least privileged. */
exports.ROLE_ORDER = ['manager', 'driver', 'student'];
/** What each recorded role lets a person act as. Downward only. */
const IMPLIES = {
    manager: ['manager', 'driver', 'student'],
    driver: ['driver', 'student'],
    student: ['student'],
};
function isRole(value) {
    return value === 'manager' || value === 'driver' || value === 'student';
}
/** Roles the document literally records, deduplicated and ranked. */
function recordedRoles(profile) {
    if (!profile)
        return [];
    const found = new Set();
    if (isRole(profile.role))
        found.add(profile.role);
    if (isRole(profile.registeredRole))
        found.add(profile.registeredRole);
    if (Array.isArray(profile.roles)) {
        profile.roles.forEach(r => { if (isRole(r))
            found.add(r); });
    }
    return exports.ROLE_ORDER.filter(r => found.has(r));
}
/** Everything the person may act as, hierarchy expanded and ranked. */
function grantedRoles(profile) {
    const granted = new Set();
    recordedRoles(profile).forEach(r => IMPLIES[r].forEach(g => granted.add(g)));
    return exports.ROLE_ORDER.filter(r => granted.has(r));
}
/** Does the document record this role outright? Authority question. */
function hasRecordedRole(profile, role) {
    return recordedRoles(profile).includes(role);
}
/** May this person act as this role? Capability question — hierarchy applies. */
function hasGrantedRole(profile, role) {
    return grantedRoles(profile).includes(role);
}
//# sourceMappingURL=roles.js.map