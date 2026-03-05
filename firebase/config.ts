import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase (Singleton pattern to prevent re-initialization errors)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Export Auth and Firestore instances
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Firestore with persistent cache (replaces deprecated enableIndexedDbPersistence)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Export app instance
export { app };

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

// Default Sabha Location — used as fallback only.
// The live location is stored in Firestore `settings/main` and managed
// by managers via the LocationSettings UI.
export const SABHA_LOCATION = {
  lat: 42.339925,
  lng: -71.088182,
  address: "360 Huntington Ave, Boston, MA 02115"
};

// Default export
export default app;
