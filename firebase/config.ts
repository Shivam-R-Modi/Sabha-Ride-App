import { initializeApp, getApps, getApp } from '@firebase/app';
import { getAuth, GoogleAuthProvider } from '@firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from '@firebase/firestore';
import { getMessaging, isSupported } from '@firebase/messaging';

// Configuration for project 'sabha-ride-app'
const firebaseConfig = {
  apiKey: "AIzaSyDPRqBKGWRupAk_ZbuRN5o6KkSr8oEDEMA",
  authDomain: "sabha-ride-app.firebaseapp.com",
  projectId: "sabha-ride-app",
  storageBucket: "sabha-ride-app.firebasestorage.app",
  messagingSenderId: "546868683884",
  appId: "1:546868683884:web:94155f9896d47f04a0e449",
  measurementId: "G-Q3C2PC3WYZ"
};

// Initialize Firebase (Singleton pattern to prevent re-initialization errors)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Export Auth and Firestore instances
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

// Initialize Messaging (with support check)
export const initializeMessaging = async () => {
  try {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
    console.log('Firebase Messaging not supported in this environment');
    return null;
  } catch (error) {
    console.error('Error initializing messaging:', error);
    return null;
  }
};

// Enable offline persistence for Firestore
export const enableOfflinePersistence = async () => {
  try {
    await enableIndexedDbPersistence(db);
    console.log('Firestore offline persistence enabled');
  } catch (error: any) {
    if (error.code === 'failed-precondition') {
      console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time');
    } else if (error.code === 'unimplemented') {
      console.warn('Browser does not support offline persistence');
    }
  }
};

// Sabha Location Constants (BAPS Shri Swaminarayan Mandir, Edison)
export const SABHA_LOCATION = {
  lat: 40.5186,
  lng: -74.3491,
  address: "BAPS Shri Swaminarayan Mandir, 1120 Edison Glen Terrace, Edison, NJ 08837"
};

// Default export
export default app;
