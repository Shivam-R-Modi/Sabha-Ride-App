
import { initializeApp, getApps, getApp } from '@firebase/app';
import { getAuth, GoogleAuthProvider } from '@firebase/auth';
import { getFirestore } from '@firebase/firestore';

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

export default app;
