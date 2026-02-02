import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase/config';
import type { User, UserRole, AccountStatus } from '../types';

interface AuthState {
    // State
    currentUser: FirebaseUser | null;
    userProfile: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    error: string | null;

    // Actions
    initializeAuth: () => () => void;
    loginWithEmail: (email: string, password: string) => Promise<void>;
    registerWithEmail: (email: string, password: string, name: string, role: UserRole) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    updateUserProfile: (updates: Partial<User>) => Promise<void>;
    switchRole: (role: UserRole) => Promise<void>;
    clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            // Initial State
            currentUser: null,
            userProfile: null,
            isLoading: true,
            isAuthenticated: false,
            error: null,

            // Initialize Auth Listener
            initializeAuth: () => {
                const unsubscribe = onAuthStateChanged(auth, async (user) => {
                    set({ currentUser: user, isLoading: true });

                    if (user) {
                        try {
                            const userDoc = await getDoc(doc(db, 'users', user.uid));
                            if (userDoc.exists()) {
                                const profile = { id: user.uid, ...userDoc.data() } as User;
                                set({
                                    userProfile: profile,
                                    isAuthenticated: true,
                                    isLoading: false
                                });
                            } else {
                                // User authenticated but no profile yet
                                set({
                                    userProfile: null,
                                    isAuthenticated: true,
                                    isLoading: false
                                });
                            }
                        } catch (error) {
                            console.error('Error fetching profile:', error);
                            set({
                                error: 'Failed to load user profile',
                                isLoading: false
                            });
                        }
                    } else {
                        set({
                            userProfile: null,
                            isAuthenticated: false,
                            isLoading: false
                        });
                    }
                });

                return unsubscribe;
            },

            // Email/Password Login
            loginWithEmail: async (email: string, password: string) => {
                set({ isLoading: true, error: null });
                try {
                    await signInWithEmailAndPassword(auth, email, password);
                } catch (error: any) {
                    console.error('Login error:', error);
                    let errorMessage = 'Login failed';

                    switch (error.code) {
                        case 'auth/invalid-email':
                            errorMessage = 'Invalid email address';
                            break;
                        case 'auth/user-not-found':
                        case 'auth/wrong-password':
                        case 'auth/invalid-credential':
                            errorMessage = 'Invalid email or password';
                            break;
                        case 'auth/user-disabled':
                            errorMessage = 'Account has been disabled';
                            break;
                        case 'auth/too-many-requests':
                            errorMessage = 'Too many failed attempts. Please try again later';
                            break;
                    }

                    set({ error: errorMessage, isLoading: false });
                    throw error;
                }
            },

            // Email/Password Registration
            registerWithEmail: async (email: string, password: string, name: string, role: UserRole) => {
                set({ isLoading: true, error: null });
                try {
                    const { user } = await createUserWithEmailAndPassword(auth, email, password);

                    // Determine initial account status
                    const accountStatus: AccountStatus = role === 'student' ? 'approved' : 'pending';

                    // Create user profile
                    const userData: Omit<User, 'id'> = {
                        email,
                        name,
                        roles: [role],
                        activeRole: role,
                        accountStatus,
                        avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
                        createdAt: new Date().toISOString(),
                    };

                    await setDoc(doc(db, 'users', user.uid), userData);

                    // Create role-specific record
                    if (role === 'student') {
                        await setDoc(doc(db, 'students', user.uid), {
                            id: user.uid,
                            userId: user.uid,
                            name,
                            location: { lat: 0, lng: 0, address: '' },
                            status: 'waiting_for_pickup',
                            currentRideId: null,
                            pickupRequested: false,
                            dropoffRequested: false,
                        });
                    } else if (role === 'driver') {
                        await setDoc(doc(db, 'drivers', user.uid), {
                            id: user.uid,
                            userId: user.uid,
                            name,
                            currentCarId: null,
                            currentLocation: null,
                            homeLocation: null,
                            status: 'offline',
                            activeRideId: null,
                            ridesCompletedToday: 0,
                            totalStudentsToday: 0,
                            totalDistanceToday: 0,
                        });
                    }

                } catch (error: any) {
                    console.error('Registration error:', error);
                    let errorMessage = 'Registration failed';

                    switch (error.code) {
                        case 'auth/email-already-in-use':
                            errorMessage = 'Email is already registered';
                            break;
                        case 'auth/invalid-email':
                            errorMessage = 'Invalid email address';
                            break;
                        case 'auth/weak-password':
                            errorMessage = 'Password should be at least 6 characters';
                            break;
                    }

                    set({ error: errorMessage, isLoading: false });
                    throw error;
                }
            },

            // Google Login
            loginWithGoogle: async () => {
                set({ isLoading: true, error: null });
                try {
                    await signInWithPopup(auth, googleProvider);
                } catch (error: any) {
                    console.error('Google login error:', error);
                    let errorMessage = 'Google sign-in failed';

                    switch (error.code) {
                        case 'auth/popup-closed-by-user':
                            errorMessage = 'Sign-in cancelled';
                            break;
                        case 'auth/popup-blocked':
                            errorMessage = 'Popup blocked. Please allow popups for this site';
                            break;
                        case 'auth/unauthorized-domain':
                            errorMessage = 'Domain not authorized. Please contact support';
                            break;
                    }

                    set({ error: errorMessage, isLoading: false });
                    throw error;
                }
            },

            // Logout
            logout: async () => {
                set({ isLoading: true });
                try {
                    await signOut(auth);
                    set({
                        currentUser: null,
                        userProfile: null,
                        isAuthenticated: false,
                        isLoading: false
                    });
                } catch (error) {
                    console.error('Logout error:', error);
                    set({ isLoading: false });
                    throw error;
                }
            },

            // Refresh Profile
            refreshProfile: async () => {
                const { currentUser } = get();
                if (!currentUser) return;

                try {
                    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
                    if (userDoc.exists()) {
                        const profile = { id: currentUser.uid, ...userDoc.data() } as User;
                        set({ userProfile: profile });
                    }
                } catch (error) {
                    console.error('Error refreshing profile:', error);
                }
            },

            // Update User Profile
            updateUserProfile: async (updates: Partial<User>) => {
                const { currentUser } = get();
                if (!currentUser) throw new Error('Not authenticated');

                try {
                    await updateDoc(doc(db, 'users', currentUser.uid), {
                        ...updates,
                        lastActive: new Date().toISOString(),
                    });

                    // Refresh profile
                    await get().refreshProfile();
                } catch (error) {
                    console.error('Error updating profile:', error);
                    throw error;
                }
            },

            // Switch Active Role
            switchRole: async (role: UserRole) => {
                const { userProfile, currentUser } = get();
                if (!userProfile || !currentUser) throw new Error('Not authenticated');

                // Check if user has this role
                if (!userProfile.roles.includes(role)) {
                    throw new Error('User does not have this role');
                }

                try {
                    await updateDoc(doc(db, 'users', currentUser.uid), {
                        activeRole: role,
                        lastActive: new Date().toISOString(),
                    });

                    await get().refreshProfile();
                } catch (error) {
                    console.error('Error switching role:', error);
                    throw error;
                }
            },

            // Clear Error
            clearError: () => set({ error: null }),
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({
                // Only persist non-sensitive data
                isAuthenticated: state.isAuthenticated
            }),
        }
    )
);
