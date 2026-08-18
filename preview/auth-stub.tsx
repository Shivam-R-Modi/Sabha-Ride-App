// Just enough of AuthContext for the shell preview: a profile with several roles,
// so the RoleSwitcher renders rather than returning null.
import React from 'react';

export const useAuth = () => ({
    currentUser: { uid: 'preview_1', email: 'preview@example.com' },
    userProfile: {
        id: 'preview_1', name: 'Tonny Stark', email: 'preview@example.com',
        roles: ['manager', 'driver', 'student'], accountStatus: 'approved',
        avatarUrl: 'https://ui-avatars.com/api/?name=Tonny+Stark&background=FF6B35&color=fff',
    },
    activeRole: 'manager',
    setActiveRole: () => {},
    getAvailableRoles: () => ['manager', 'driver', 'student'],
    logout: () => {},
    refreshProfile: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
