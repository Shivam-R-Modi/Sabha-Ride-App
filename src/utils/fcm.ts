// ============================================
// FIREBASE CLOUD MESSAGING (FCM) - PUSH NOTIFICATIONS
// ============================================

import { getMessaging, getToken, onMessage } from 'firebase/messaging';
// Firebase app instance - import from your firebase config
// import { app } from '../firebase/config';
// For now, we'll get the app from getApps()
import { getApps, getApp } from 'firebase/app';

const app = getApps().length > 0 ? getApp() : null;

// Initialize messaging
let messaging: ReturnType<typeof getMessaging> | null = null;

export async function initializeFCM(): Promise<boolean> {
    try {
        // Check if browser supports notifications
        if (!('Notification' in window)) {
            console.log('This browser does not support notifications');
            return false;
        }

        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Notification permission denied');
            return false;
        }

        // Initialize messaging
        messaging = getMessaging(app);

        // Get FCM token
        // Note: VAPID key should be set in your environment variables
        const vapidKey = (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_VAPID_KEY) || undefined;
        const token = await getToken(messaging, {
            vapidKey
        });

        if (token) {
            console.log('FCM Token:', token);
            // Save token to user profile (should be done after login)
            return true;
        } else {
            console.log('No registration token available');
            return false;
        }
    } catch (error) {
        console.error('Error initializing FCM:', error);
        return false;
    }
}

/**
 * Get FCM token for the current user
 */
export async function getFCMToken(): Promise<string | null> {
    try {
        if (!messaging) {
            messaging = getMessaging(app);
        }

        const vapidKey = (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_VAPID_KEY) || undefined;
        const token = await getToken(messaging, {
            vapidKey
        });

        return token;
    } catch (error) {
        console.error('Error getting FCM token:', error);
        return null;
    }
}

/**
 * Listen for foreground messages
 */
export function onForegroundMessage(
    callback: (payload: { notification?: { title?: string; body?: string }; data?: Record<string, string> }) => void
): () => void {
    if (!messaging) {
        messaging = getMessaging(app);
    }

    return onMessage(messaging, (payload) => {
        console.log('Message received in foreground:', payload);
        callback({
            notification: payload.notification,
            data: payload.data as Record<string, string>
        });
    });
}

/**
 * Save FCM token to user profile in Firestore
 * This should be called after user logs in
 */
export async function saveFCMTokenToProfile(
    userId: string,
    saveToFirestore: (userId: string, token: string) => Promise<void>
): Promise<void> {
    const token = await getFCMToken();
    if (token && userId) {
        await saveToFirestore(userId, token);
    }
}

/**
 * Show local notification (for foreground messages)
 */
export function showLocalNotification(
    title: string,
    body: string,
    icon?: string
): void {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body,
            icon: icon || '/icon-192x192.png',
            badge: '/icon-72x72.png',
            tag: 'sabha-ride-notification'
        });
    }
}

/**
 * Handle different notification types
 */
export function handleNotification(
    type: string,
    data: Record<string, string>
): void {
    switch (type) {
        case 'driver_assigned':
            // Student was assigned a driver
            console.log('Driver assigned:', data);
            break;
        case 'students_assigned':
            // Driver was assigned students
            console.log('Students assigned:', data);
            break;
        case 'ride_starting':
            // Ride is starting
            console.log('Ride starting:', data);
            break;
        case 'ride_completed':
            // Ride completed
            console.log('Ride completed:', data);
            break;
        case 'unassigned_students':
            // Manager notification about unassigned students
            console.log('Unassigned students:', data);
            break;
        default:
            console.log('Unknown notification type:', type, data);
    }
}
