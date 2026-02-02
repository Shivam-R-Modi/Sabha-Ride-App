/**
 * Authentication Hook
 * Provides easy access to authentication state and methods
 */

import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import type { UserRole } from '../types';

export function useAuth() {
    const {
        currentUser,
        userProfile,
        isLoading,
        isAuthenticated,
        error,
        initializeAuth,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        refreshProfile,
        updateUserProfile,
        switchRole,
        clearError,
    } = useAuthStore();

    // Initialize auth listener on mount
    useEffect(() => {
        const unsubscribe = initializeAuth();
        return unsubscribe;
    }, [initializeAuth]);

    // Check if user has a specific role
    const hasRole = (role: UserRole): boolean => {
        return userProfile?.roles.includes(role) || false;
    };

    // Get available roles for the user
    const getAvailableRoles = (): UserRole[] => {
        return userProfile?.roles || [];
    };

    // Check if user is approved
    const isApproved = (): boolean => {
        return userProfile?.accountStatus === 'approved';
    };

    // Check if user is pending approval
    const isPending = (): boolean => {
        return userProfile?.accountStatus === 'pending';
    };

    return {
        // State
        currentUser,
        userProfile,
        isLoading,
        isAuthenticated,
        error,

        // Computed
        hasRole,
        getAvailableRoles,
        isApproved,
        isPending,
        activeRole: userProfile?.activeRole,

        // Actions
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        refreshProfile,
        updateUserProfile,
        switchRole,
        clearError,
    };
}
