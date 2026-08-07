"use strict";
// ============================================
// PUSH NOTIFICATION UTILITIES (FCM)
// ============================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotification = sendNotification;
exports.sendMulticastNotification = sendMulticastNotification;
exports.notifyEveryone = notifyEveryone;
exports.notifyStudentDriverAssigned = notifyStudentDriverAssigned;
exports.notifyDriverStudentsAssigned = notifyDriverStudentsAssigned;
exports.notifyStudentRideStarting = notifyStudentRideStarting;
exports.notifyStudentRideCompleted = notifyStudentRideCompleted;
exports.notifyManagerUnassignedStudents = notifyManagerUnassignedStudents;
const admin = __importStar(require("firebase-admin"));
/**
 * Send push notification to a specific user
 */
async function sendNotification(fcmToken, title, body, data) {
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
    }
    catch (error) {
        console.error('Error sending notification:', error);
        // Don't throw - notifications are best-effort
    }
}
/**
 * Send notification to multiple users
 */
async function sendMulticastNotification(fcmTokens, title, body, data) {
    if (fcmTokens.length === 0)
        return;
    try {
        await admin.messaging().sendEachForMulticast({
            tokens: fcmTokens,
            notification: {
                title,
                body,
            },
            data: data || {},
        });
    }
    catch (error) {
        console.error('Error sending multicast notification:', error);
    }
}
/** FCM accepts at most 500 tokens per multicast call. */
const MULTICAST_BATCH_SIZE = 500;
/**
 * Notify every user who has push enabled.
 *
 * Used when a ride window opens, which is congregation-wide news rather than
 * something aimed at one person.
 *
 * Only reaches accounts with an fcmToken — that is, people who granted
 * notification permission in their browser. Everyone else sees the change on
 * their dashboard, which is live either way.
 *
 * This reads the whole users collection. Fine for one congregation; when the
 * platform is multi-city (roadmap phase 8) this should become an FCM topic per
 * location so it does not scale with total membership.
 */
async function notifyEveryone(title, body, data) {
    try {
        const snapshot = await admin.firestore().collection('users').get();
        const tokens = snapshot.docs
            .map(doc => { var _a; return (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.fcmToken; })
            .filter((token) => typeof token === 'string' && token.length > 0);
        if (tokens.length === 0) {
            console.log('[notifyEveryone] No push tokens registered — nothing sent');
            return;
        }
        for (let i = 0; i < tokens.length; i += MULTICAST_BATCH_SIZE) {
            await sendMulticastNotification(tokens.slice(i, i + MULTICAST_BATCH_SIZE), title, body, data);
        }
        console.log(`[notifyEveryone] Sent "${title}" to ${tokens.length} devices`);
    }
    catch (error) {
        // Best-effort, like every other notification here. A push failure must
        // not stop the ride window from opening.
        console.error('[notifyEveryone] Error:', error);
    }
}
/**
 * Notify student when driver is assigned
 */
async function notifyStudentDriverAssigned(fcmToken, driverName, carModel, carColor) {
    await sendNotification(fcmToken, '🚗 Driver Assigned ✓', `${driverName} will pick you up in a ${carColor} ${carModel}`, { type: 'driver_assigned' });
}
/**
 * Notify driver when students are assigned
 */
async function notifyDriverStudentsAssigned(fcmToken, studentCount) {
    await sendNotification(fcmToken, '👥 Students Assigned', `You have been assigned ${studentCount} student${studentCount > 1 ? 's' : ''}`, { type: 'students_assigned' });
}
/**
 * Notify student when ride is starting
 */
async function notifyStudentRideStarting(fcmToken, destination) {
    await sendNotification(fcmToken, '🚀 Ride Starting', `Your ride to ${destination} is starting`, { type: 'ride_starting' });
}
/**
 * Notify student when ride is completed
 */
async function notifyStudentRideCompleted(fcmToken, destination) {
    const isHome = destination.toLowerCase().includes('home');
    await sendNotification(fcmToken, isHome ? '🏠 Home Safe!' : '🙏 Arrived at Sabha!', isHome ? 'You have arrived home safely' : 'Enjoy the Sabha!', { type: 'ride_completed' });
}
/**
 * Notify manager about unassigned students
 */
async function notifyManagerUnassignedStudents(fcmToken, count) {
    await sendNotification(fcmToken, '⚠️ Unassigned Students', `${count} student${count > 1 ? 's' : ''} need manual assignment`, { type: 'unassigned_students' });
}
//# sourceMappingURL=notifications.js.map