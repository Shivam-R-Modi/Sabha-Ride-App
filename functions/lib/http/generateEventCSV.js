"use strict";
// ============================================
// HTTP FUNCTION: generateEventCSV
// Generates CSV export for manager
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
    var _a, _b, _c, _d, _e, _f, _g;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { eventDate } = data;
    if (!eventDate) {
        throw new functions.https.HttpsError('invalid-argument', 'eventDate is required (YYYY-MM-DD format)');
    }
    const db = admin.firestore();
    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const user = userDoc.data();
        if (!((_a = user === null || user === void 0 ? void 0 : user.roles) === null || _a === void 0 ? void 0 : _a.includes('manager'))) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can export data');
        }
        // Get statistics for the event
        const statsDoc = await db.collection('statistics').doc(eventDate).get();
        if (!statsDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'No data found for this date');
        }
        const stats = statsDoc.data();
        // Build CSV content
        const rows = [];
        // Header
        rows.push('Event Date,Event Type,Student Name,Pickup Driver,Pickup Car,Drop-off Driver,Drop-off Car');
        // Collect all student IDs from pickup and dropoff
        const pickupStudents = new Map();
        const dropoffStudents = new Map();
        (((_b = stats === null || stats === void 0 ? void 0 : stats.pickup) === null || _b === void 0 ? void 0 : _b.students) || []).forEach((s) => {
            pickupStudents.set(s.id, {
                name: s.name,
                driverName: s.driverName || '',
                carModel: s.carModel || ''
            });
        });
        (((_c = stats === null || stats === void 0 ? void 0 : stats.dropoff) === null || _c === void 0 ? void 0 : _c.students) || []).forEach((s) => {
            dropoffStudents.set(s.id, {
                name: s.name,
                driverName: s.driverName || '',
                carModel: s.carModel || ''
            });
        });
        // Get all unique student IDs
        const allStudentIds = new Set([...pickupStudents.keys(), ...dropoffStudents.keys()]);
        // Generate rows
        for (const studentId of allStudentIds) {
            const pickup = pickupStudents.get(studentId);
            const dropoff = dropoffStudents.get(studentId);
            let eventType;
            if (pickup && dropoff) {
                eventType = 'Both';
            }
            else if (pickup) {
                eventType = 'Pickup Only';
            }
            else {
                eventType = 'Drop-off Only';
            }
            const studentName = (pickup === null || pickup === void 0 ? void 0 : pickup.name) || (dropoff === null || dropoff === void 0 ? void 0 : dropoff.name) || 'Unknown';
            rows.push([
                eventDate,
                eventType,
                escapeCsvField(studentName),
                escapeCsvField((pickup === null || pickup === void 0 ? void 0 : pickup.driverName) || ''),
                escapeCsvField((pickup === null || pickup === void 0 ? void 0 : pickup.carModel) || ''),
                escapeCsvField((dropoff === null || dropoff === void 0 ? void 0 : dropoff.driverName) || ''),
                escapeCsvField((dropoff === null || dropoff === void 0 ? void 0 : dropoff.carModel) || '')
            ].join(','));
        }
        const csvContent = rows.join('\n');
        return {
            success: true,
            eventDate,
            csvContent,
            summary: {
                totalStudents: allStudentIds.size,
                pickupOnly: ((_d = stats === null || stats === void 0 ? void 0 : stats.pickup) === null || _d === void 0 ? void 0 : _d.totalStudents) || 0,
                dropoffOnly: ((_e = stats === null || stats === void 0 ? void 0 : stats.dropoff) === null || _e === void 0 ? void 0 : _e.totalStudents) || 0,
                both: (((_f = stats === null || stats === void 0 ? void 0 : stats.pickup) === null || _f === void 0 ? void 0 : _f.totalStudents) || 0) + (((_g = stats === null || stats === void 0 ? void 0 : stats.dropoff) === null || _g === void 0 ? void 0 : _g.totalStudents) || 0) - allStudentIds.size
            }
        };
    }
    catch (error) {
        console.error('Error generating CSV:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to generate CSV');
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