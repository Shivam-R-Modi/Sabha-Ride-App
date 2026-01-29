
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from '@firebase/auth';
import { doc, getDoc } from '@firebase/firestore';
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

  const fetchProfile = async (uid: string) => {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const profile = { id: uid, ...docSnap.data() } as User | Driver;
        setUserProfile(profile);
        // Set activeRole to the user's role (or registeredRole if available)
        const registeredRole = profile.registeredRole || profile.role;
        setActiveRoleState(profile.role || null);
      } else {
        setUserProfile(null);
        setActiveRoleState(null);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await fetchProfile(user.uid);
      } else {
        setUserProfile(null);
        setActiveRoleState(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const refreshProfile = async () => {
    if (currentUser) {
      await fetchProfile(currentUser.uid);
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
