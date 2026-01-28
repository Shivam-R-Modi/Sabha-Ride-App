
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from '@firebase/auth';
import { doc, getDoc } from '@firebase/firestore';
import { auth, db } from '../firebase/config';
import { User, Driver } from '../types';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: User | Driver | null;
  loading: boolean;
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

  const fetchProfile = async (uid: string) => {
    try {
        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            setUserProfile({ id: uid, ...docSnap.data() } as User | Driver);
        } else {
            setUserProfile(null);
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
  };

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, loading, refreshProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
