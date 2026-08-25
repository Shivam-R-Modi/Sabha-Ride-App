// Just enough of AuthContext for the shell preview: a profile with several roles,
// so the RoleSwitcher renders rather than returning null.
//
// The profile is LIVE, the way the real one is. `AuthContext` holds an onSnapshot
// on the user document, so anything a screen writes there comes back to it
// through the profile — and a stub returning a frozen object shows a write
// starting and never landing, which makes a preview unable to tell working code
// from broken.
import React from 'react';

const BASE = {
    id: 'preview_1', name: 'Tonny Stark', email: 'preview@example.com',
    roles: ['manager', 'driver', 'student'], accountStatus: 'approved',
    avatarUrl: 'https://ui-avatars.com/api/?name=Tonny+Stark&background=FF6B35&color=fff',
} as Record<string, unknown>;

/** Applies a dotted field path, which is how a component writes one nested field. */
function applyWrite(profile: Record<string, unknown>, data: Record<string, unknown>) {
    const next = { ...profile };
    for (const [key, value] of Object.entries(data)) {
        const [head, tail] = key.split('.');
        if (tail === undefined) { next[head] = value; continue; }
        const branch = { ...((next[head] as Record<string, unknown>) ?? {}) };
        if (value === '__DELETE__') delete branch[tail];
        else branch[tail] = value;
        next[head] = branch;
    }
    return next;
}

export const useAuth = () => {
    const [userProfile, setUserProfile] = React.useState(BASE);

    React.useEffect(() => {
        const onWrite = (event: Event) => {
            const detail = (event as CustomEvent).detail as Record<string, unknown>;
            setUserProfile(current => applyWrite(current, detail));
        };
        window.addEventListener('preview:userWrite', onWrite);
        return () => window.removeEventListener('preview:userWrite', onWrite);
    }, []);

    return {
        currentUser: { uid: 'preview_1', email: 'preview@example.com' },
        userProfile,
        activeRole: 'manager',
        setActiveRole: () => {},
        getAvailableRoles: () => ['manager', 'driver', 'student'],
        logout: () => {},
        refreshProfile: () => {},
        // Added 2026-08-25 with the signup step. RoleSelection calls it on the manager
        // path, and a stub missing it throws rather than rendering.
        refreshClaims: async () => {},
    };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
