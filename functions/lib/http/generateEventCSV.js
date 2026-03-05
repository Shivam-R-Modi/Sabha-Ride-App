"use strict";
// ============================================
// HTTP FUNCTION: generateEventCSV
// Generates CSV export for manager with all ride requests
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
exports.generateEventCSV = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * HTTP Callable: Generate CSV export for an event
 * Input: { eventDate: string } (YYYY-MM-DD format)
 * Output: { csvContent: string }
 */
exports.generateEventCSV = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { eventDate } = data || {};
    // Use today's date if no date provided
    const targetDate = eventDate || new Date().toISOString().split('T')[0];
    const db = admin.firestore();
    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const user = userDoc.data();
        // Check for both 'roles' array and 'role' string
        const isManager = ((_b = (_a = user === null || user === void 0 ? void 0 : user.roles) === null || _a === void 0 ? void 0 : _a.includes) === null || _b === void 0 ? void 0 : _b.call(_a, 'manager')) || (user === null || user === void 0 ? void 0 : user.role) === 'manager';
        if (!isManager) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can export data');
        }
        const rows = [];
        // Header
        rows.push('Student Name,Phone,Pickup Address,Status,Request Date');
        // Get all ride requests - query without filters first to avoid index issues
        const allRides = await db.collection('rides').get();
        const pendingRequests = [];
        const completedPickups = new Map();
        const completedDropoffs = new Map();
        for (const doc of allRides.docs) {
            const ride = doc.data();
            // Check if this is a pending request
            if (ride.status === 'requested') {
                pendingRequests.push(Object.assign({ id: doc.id }, ride));
            }
        }
        // Get statistics for completed rides
        const statsDoc = await db.collection('statistics').doc(targetDate).get();
        if (statsDoc.exists && statsDoc.data()) {
            const stats = statsDoc.data();
            (((_c = stats === null || stats === void 0 ? void 0 : stats.pickup) === null || _c === void 0 ? void 0 : _c.students) || []).forEach((s) => {
                completedPickups.set(s.id, s);
            });
            (((_d = stats === null || stats === void 0 ? void 0 : stats.dropoff) === null || _d === void 0 ? void 0 : _d.students) || []).forEach((s) => {
                completedDropoffs.set(s.id, s);
            });
        }
        // Add pending requests to CSV
        if (pendingRequests.length > 0) {
            for (const request of pendingRequests) {
                rows.push([
                    escapeCsvField(request.studentName || 'Unknown'),
                    escapeCsvField(request.studentPhone || request.phone || ''),
                    escapeCsvField(request.pickupAddress || ''),
                    'Pending Request',
                    escapeCsvField(request.createdAt ? new Date(request.createdAt).toLocaleDateString() : targetDate)
                ].join(','));
            }
        }
        // Add completed rides from statistics
        const allStudentIds = new Set([...completedPickups.keys(), ...completedDropoffs.keys()]);
        for (const studentId of allStudentIds) {
            const pickup = completedPickups.get(studentId);
            const dropoff = completedDropoffs.get(studentId);
            let eventType = 'Both';
            if (pickup && !dropoff)
                eventType = 'Pickup Only';
            else if (!pickup && dropoff)
                eventType = 'Drop-off Only';
            rows.push([
                escapeCsvField((pickup === null || pickup === void 0 ? void 0 : pickup.name) || (dropoff === null || dropoff === void 0 ? void 0 : dropoff.name) || 'Unknown'),
                escapeCsvField((pickup === null || pickup === void 0 ? void 0 : pickup.phone) || ''),
                escapeCsvField((pickup === null || pickup === void 0 ? void 0 : pickup.address) || (dropoff === null || dropoff === void 0 ? void 0 : dropoff.address) || ''),
                eventType,
                targetDate
            ].join(','));
        }
        const csvContent = rows.join('\n');
        return {
            success: true,
            eventDate: targetDate,
            csvContent,
            summary: {
                totalStudents: rows.length - 1, // Subtract header row
                pendingRequests: pendingRequests.length,
                completedRides: allStudentIds.size
            }
        };
    }
    catch (error) {
        console.error('Error generating CSV:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to generate CSV: ' + error.message);
    }
});
/**
 * Escape a field for CSV format
 * Wraps in quotes if contains comma, newline, or quote
 */
function escapeCsvField(field) {
    if (!field)
        return '';
    // If field contains comma, newline, or quote, wrap in quotes
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
        // Double up any quotes
        const escaped = field.replace(/"/g, '""');
        return `"${escaped}"`;
    }
    return field;
}
//# sourceMappingURL=generateEventCSV.js.map