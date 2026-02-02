// ============================================
// PUSH NOTIFICATION UTILITIES (FCM)
// ============================================

import * as admin from 'firebase-admin';

/**
 * Send push notification to a specific user
 */
export async function sendNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
): Promise<void> {
    try {
        await admin.messaging().send({
            token: fcmToken,
            notification: {
                title,
                body,
            },
            data: data || {},
            android: {
                priority: 'high',
                notification: {
                    channelId: 'ride-updates',
                    priority: 'high',
                },
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title,
                            body,
                        },
                        badge: 1,
                        sound: 'default',
                    },
                },
            },
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        // Don't throw - notifications are best-effort
    }
}

/**
 * Send notification to multiple users
 */
export async function sendMulticastNotification(
    fcmTokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>
): Promise<void> {
    if (fcmTokens.length === 0) return;

    try {
        await admin.messaging().sendEachForMulticast({
            tokens: fcmTokens,
            notification: {
                title,
                body,
            },
            data: data || {},
        });
    } catch (error) {
        console.error('Error sending multicast notification:', error);
    }
}

/**
 * Notify student when driver is assigned
 */
export async function notifyStudentDriverAssigned(
    fcmToken: string,
    driverName: string,
    carModel: string,
    carColor: string
): Promise<void> {
    await sendNotification(
        fcmToken,
        '🚗 Driver Assigned ✓',
        `${driverName} will pick you up in a ${carColor} ${carModel}`,
        { type: 'driver_assigned' }
    );
}

/**
 * Notify driver when students are assigned
 */
export async function notifyDriverStudentsAssigned(
    fcmToken: string,
    studentCount: number
): Promise<void> {
    await sendNotification(
        fcmToken,
        '👥 Students Assigned',
        `You have been assigned ${studentCount} student${studentCount > 1 ? 's' : ''}`,
        { type: 'students_assigned' }
    );
}

/**
 * Notify student when ride is starting
 */
export async function notifyStudentRideStarting(
    fcmToken: string,
    destination: string
): Promise<void> {
    await sendNotification(
        fcmToken,
        '🚀 Ride Starting',
        `Your ride to ${destination} is starting`,
        { type: 'ride_starting' }
    );
}

/**
 * Notify student when ride is completed
 */
export async function notifyStudentRideCompleted(
    fcmToken: string,
    destination: string
): Promise<void> {
    const isHome = destination.toLowerCase().includes('home');
    await sendNotification(
        fcmToken,
        isHome ? '🏠 Home Safe!' : '🙏 Arrived at Sabha!',
        isHome ? 'You have arrived home safely' : 'Enjoy the Sabha!',
        { type: 'ride_completed' }
    );
}

/**
 * Notify manager about unassigned students
 */
export async function notifyManagerUnassignedStudents(
    fcmToken: string,
    count: number
): Promise<void> {
    await sendNotification(
        fcmToken,
        '⚠️ Unassigned Students',
        `${count} student${count > 1 ? 's' : ''} need manual assignment`,
        { type: 'unassigned_students' }
    );
}
