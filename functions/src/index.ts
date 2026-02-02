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
export { startRide } from './http/startRide';
export { completeRide } from './http/completeRide';
export { releaseAssignment } from './http/releaseAssignment';
export { driverDoneForToday } from './http/driverDoneForToday';

// Student Functions
export { studentReadyToLeave } from './http/studentReadyToLeave';

// Manager Functions
export { manualAssignStudent } from './http/manualAssignStudent';
export { addCarToFleet, removeCarFromFleet } from './http/fleetManagement';
export { generateEventCSV } from './http/generateEventCSV';
