// ============================================
// SABHA RIDE SEVA - FIREBASE CLOUD FUNCTIONS
// ============================================

import * as admin from 'firebase-admin';

// Initialize Firebase Admin
admin.initializeApp();

// ============================================
// SCHEDULED FUNCTIONS
// ============================================

export { updateRideTypeContext, manuallyUpdateRideContext } from './scheduled/updateRideTypeContext';

// ============================================
// HTTP CALLABLE FUNCTIONS
// ============================================

// Driver Functions
export { assignStudentsToDriver } from './http/assignStudentsToDriver';
export { globalAssignDriver } from './http/globalAssignDriver';
export { startRide } from './http/startRide';
export { completeRide } from './http/completeRide';
export { releaseAssignment } from './http/releaseAssignment';
export { driverDoneForToday } from './http/driverDoneForToday';

// Student Functions
export { studentReadyToLeave } from './http/studentReadyToLeave';

// Manager Functions
export { manualAssignStudent } from './http/manualAssignStudent';
export { generateEventCSV } from './http/generateEventCSV';
export { verifyManagerCode } from './http/verifyManagerCode';

// Utility Functions
export { geocodeAddress } from './http/geocodeAddress';
