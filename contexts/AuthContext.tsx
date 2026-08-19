
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { User, Driver, UserRole } from '../types';
import { grantedRoles } from '../src/roles';
import { readDeviceToken, writeDeviceToken, tokenKey } from '../src/utils/push';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: User | Driver | null;
  loading: boolean;
  activeRole: UserRole | null;
  setActiveRole: (role: UserRole) => void;
  getAvailableRoles: () => UserRole[];
  refreshProfile: () => Promise<void>;
  refreshClaims: () => Promise<void>;
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
  const subscribeToProfile = (uid: string, _authUser?: import('firebase/auth').User | null) => {
    // Clean up any existing listener
    if (profileUnsubscribeRef.current) {
      profileUnsubscribeRef.current();
    }

    const docRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
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
        // Profile document does not exist yet (brand new signup / role not yet selected).
        // Do NOT auto-create a stub profile. Set userProfile to null so App renders RoleSelection.
        setUserProfile(null);
        setActiveRoleState(null);
        setLoading(false);
      }
      if (docSnap.exists()) setLoading(false);
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
        subscribeToProfile(user.uid, user);
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
    if (currentUser) {
      try {
        // Only THIS device's token, and only if there is one. On a shared phone
        // the next person's ride would otherwise be pushed to the person who
        // just signed out.
        //
        // Before signOut, not after: once signed out `isOwner(userId)` is false
        // and the rules deny the write. The legacy single field is cleared too,
        // for a document written before the map existed.
        const token = readDeviceToken();
        await updateDoc(doc(db, 'users', currentUser.uid), {
          ...(token ? { [`fcmTokens.${tokenKey(token)}`]: deleteField() } : {}),
          fcmToken: deleteField(),
        });
        writeDeviceToken(null);
      } catch (err) {
        console.warn('[AuthContext] Could not clear the push token on logout:', err);
      }
    }
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

  /**
   * Force a fresh ID token so a newly granted `mgr` claim takes effect now.
   *
   * Claims are attached when a token is minted, and the SDK refreshes roughly
   * hourly on its own. Someone promoted to manager would otherwise wait that out.
   * Their reads still work in the meantime — firestore.rules falls back to the
   * user document — so this buys speed, not access, and a failure here is
   * therefore not worth surfacing to the user.
   */
  const refreshClaims = async () => {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.getIdToken(true);
    } catch (error) {
      console.error('Could not refresh auth claims:', error);
    }
  };

  /**
   * Which roles the switcher offers.
   *
   * Was a switch on `registeredRole || role` with the hierarchy hardcoded here.
   * Same output for every document shape in production — no user has disagreeing
   * role fields — but it now reads the same table the rest of the app does, and
   * it no longer returns an empty list for a document that records the role only
   * in `roles[]`, which the old lookup missed entirely.
   */
  const getAvailableRoles = (): UserRole[] => grantedRoles(userProfile);

  return (
    <AuthContext.Provider value={{
      currentUser,
      userProfile,
      loading,
      activeRole,
      setActiveRole,
      getAvailableRoles,
      refreshProfile,
      refreshClaims,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};
