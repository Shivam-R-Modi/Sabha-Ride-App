/**
 * Notification Utilities for Sabha Ride Seva
 * Handles Firebase Cloud Messaging and browser notifications
 */

import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db, initializeMessaging } from '../firebase/config';

/**
 * Request notification permission and get FCM token
 * @returns FCM token or null if permission denied
 */
export async function requestNotificationPermission(): Promise<string | null> {
    try {
        // Check if browser supports notifications
        if (!('Notification' in window)) {
            console.log('This browser does not support notifications');
            return null;
        }

        // Request permission
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') {
            console.log('Notification permission denied');
            return null;
        }

        // Initialize messaging
        const messaging = await initializeMessaging();
        if (!messaging) {
            console.log('Firebase Messaging not available');
            return null;
        }

        // Get FCM token
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        const token = await getToken(messaging, { vapidKey });

        if (token) {
            // Save token to user profile
            const user = auth.currentUser;
            if (user) {
                await updateDoc(doc(db, 'users', user.uid), {
                    fcmToken: token,
                });
            }
            return token;
        } else {
            console.log('No registration token available');
            return null;
        }
    } catch (error) {
        console.error('Error requesting notification permission:', error);
        return null;
    }
}

/**
 * Setup foreground message handler
 * @param callback Function to call when message received in foreground
 */
export async function setupMessageHandler(
    callback: (payload: { title: string; body: string; data?: Record<string, string> }) => void
): Promise<void> {
    const messaging = await initializeMessaging();
    if (!messaging) return;

    onMessage(messaging, (payload) => {
        console.log('Message received in foreground:', payload);

        callback({
            title: payload.notification?.title || 'New Notification',
            body: payload.notification?.body || '',
            data: payload.data as Record<string, string>,
        });
    });
}

/**
 * Show browser notification
 * @param title Notification title
 * @param body Notification body
 * @param icon Icon URL
 */
export function showBrowserNotification(
    title: string,
    body: string,
    icon: string = '/icon-192x192.png'
): void {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    new Notification(title, {
        body,
        icon,
        badge: '/badge-72x72.png',
        requireInteraction: true,
    });
}

/**
 * Notification types for the app
 */
export type NotificationType =
    | 'DRIVER_ASSIGNED'
    | 'STUDENTS_ASSIGNED'
    | 'RIDE_STARTED'
    | 'RIDE_COMPLETED'
    | 'WAYPOINT_REACHED'
    | 'READY_FOR_PICKUP';

/**
 * Get notification content based on type
 * @param type Notification type
 * @param data Additional data
 * @returns Title and body
 */
export function getNotificationContent(
    type: NotificationType,
    data?: Record<string, string>
): { title: string; body: string } {
    switch (type) {
        case 'DRIVER_ASSIGNED':
            return {
                title: '🚗 Driver Assigned',
                body: `${data?.driverName} will pick you up in a ${data?.carModel}`,
            };

        case 'STUDENTS_ASSIGNED':
            return {
                title: '👥 Students Assigned',
                body: `You have been assigned ${data?.studentCount} students`,
            };

        case 'RIDE_STARTED':
            return {
                title: '🚀 Ride Started',
                body: 'Your ride is now in progress',
            };

        case 'RIDE_COMPLETED':
            return {
                title: '✅ Ride Completed',
                body: 'You have arrived at your destination',
            };

        case 'WAYPOINT_REACHED':
            return {
                title: '📍 Stop Reached',
                body: `Arrived at ${data?.locationName}`,
            };

        case 'READY_FOR_PICKUP':
            return {
                title: '⏰ Ready for Pickup',
                body: 'A student is ready to be picked up',
            };

        default:
            return {
                title: 'Sabha Ride Seva',
                body: 'You have a new notification',
            };
    }
}

/**
 * Check if notifications are supported and permitted
 * @returns Object with support status and permission state
 */
export function checkNotificationStatus(): {
    supported: boolean;
    permission: NotificationPermission;
} {
    if (!('Notification' in window)) {
        return { supported: false, permission: 'denied' };
    }

    return {
        supported: true,
        permission: Notification.permission,
    };
}

/**
 * Subscribe to a topic (for group notifications)
 * Note: This requires backend implementation
 * @param topic Topic name
 */
export async function subscribeToTopic(topic: string): Promise<boolean> {
    // This would typically call a backend endpoint
    // that uses Firebase Admin SDK to subscribe the token to a topic
    console.log(`Subscribing to topic: ${topic}`);
    return true;
}

/**
 * Unsubscribe from a topic
 * @param topic Topic name
 */
export async function unsubscribeFromTopic(topic: string): Promise<boolean> {
    console.log(`Unsubscribing from topic: ${topic}`);
    return true;
}
