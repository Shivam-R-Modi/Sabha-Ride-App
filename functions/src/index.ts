// ============================================
// SABHA RIDE SEVA - FIREBASE CLOUD FUNCTIONS
// ============================================

import * as admin from 'firebase-admin';

// Initialize Firebase Admin
admin.initializeApp();

// ============================================
// SCHEDULED FUNCTIONS
// ============================================

export { updateRideTypeContext, manuallyUpdateRideContext, ensureSabhaEvents } from './scheduled/updateRideTypeContext';

// ============================================
// HTTP CALLABLE FUNCTIONS
// ============================================

// Driver Functions
//
// assignStudentsToDriver was removed. It was a deployed, callable, live endpoint
// that nothing in the app had ever called: no rate limit, no assignment lock,
// the same "vehicle already taken" guard bug as globalAssignDriver, and the
// unnormalised homeLocation read that produced NaN coordinates. globalAssignDriver
// is the assignment path, and it has all three fixed.
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
export { adminDeleteUser } from './http/adminDeleteUser';

// Utility Functions
export { geocodeAddress } from './http/geocodeAddress';
