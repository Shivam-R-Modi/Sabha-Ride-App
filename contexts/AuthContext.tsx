
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { User, Driver, UserRole } from '../types';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: User | Driver | null;
  loading: boolean;
  activeRole: UserRole | null;
  setActiveRole: (role: UserRole) => void;
  getAvailableRoles: () => UserRole[];
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRoleState] = useState<UserRole | null>(null);
  const activeRoleInitialized = useRef(false);
  const profileUnsubscribeRef = useRef<(() => void) | null>(null);

  // Subscribe to real-time profile updates via onSnapshot
  const subscribeToProfile = (uid: string) => {
    // Clean up any existing listener
    if (profileUnsubscribeRef.current) {
      profileUnsubscribeRef.current();
    }

    const docRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const profile = { id: uid, ...docSnap.data() } as User | Driver;
        setUserProfile(profile);

        // Only set activeRole on initial load, not on subsequent updates
        // This preserves role-switching state
        if (!activeRoleInitialized.current) {
          setActiveRoleState(profile.role || null);
          activeRoleInitialized.current = true;
        }
      } else {
        setUserProfile(null);
        setActiveRoleState(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error listening to profile:", error);
      setLoading(false);
    });

    profileUnsubscribeRef.current = unsubscribe;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        subscribeToProfile(user.uid);
      } else {
        // Clean up profile listener on logout
        if (profileUnsubscribeRef.current) {
          profileUnsubscribeRef.current();
          profileUnsubscribeRef.current = null;
        }
        setUserProfile(null);
        setActiveRoleState(null);
        activeRoleInitialized.current = false;
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (profileUnsubscribeRef.current) {
        profileUnsubscribeRef.current();
      }
    };
  }, []);

  // refreshProfile kept for manual refresh if needed (e.g. after writes)
  const refreshProfile = async () => {
    if (currentUser) {
      try {
        const docRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const profile = { id: currentUser.uid, ...docSnap.data() } as User | Driver;
          setUserProfile(profile);
        }
      } catch (error) {
        console.error("Error refreshing profile:", error);
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUserProfile(null);
    setActiveRoleState(null);
  };

  // Set active role with validation based on registered role hierarchy
  const setActiveRole = (role: UserRole) => {
    const available = getAvailableRoles();
    if (available.includes(role)) {
      setActiveRoleState(role);
    }
  };

  // Get available roles based on the user's registered role
  const getAvailableRoles = (): UserRole[] => {
    if (!userProfile) return [];

    // Use registeredRole if available, otherwise fall back to role
    const registeredRole = userProfile.registeredRole || userProfile.role;

    switch (registeredRole) {
      case 'manager':
        return ['manager', 'driver', 'student'];
      case 'driver':
        return ['driver', 'student'];
      case 'student':
        return ['student'];
      default:
        return [];
    }
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      userProfile,
      loading,
      activeRole,
      setActiveRole,
      getAvailableRoles,
      refreshProfile,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};
