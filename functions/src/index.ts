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
// Its own function rather than a side effect inside ensureSabhaEvents: a stranded
// fleet is an operational fault, and a named entry in the logs is what makes it
// diagnosable at 19:00 on a Friday.
export { releaseIdleVehicles } from './scheduled/releaseIdleVehicles';
// Same 03:00 slot, same reasoning: requests nobody answered are the rider-side
// equivalent of a stranded car, and they never expired on their own.
export { expireStaleRequests } from './scheduled/expireStaleRequests';

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
export { deleteSabhaEvent } from './http/deleteSabhaEvent';
// Single-use, expiring invites. verifyManagerCode was exported here and is gone:
// one shared, never-expiring code that any approved manager could read back in
// plaintext. It shipped alongside these for one release so no cached bundle would
// call a callable that had vanished, then was removed once a real invite had been
// minted and redeemed end to end.
export { createManagerInvite, redeemManagerInvite } from './http/managerInvites';
export { adminDeleteUser } from './http/adminDeleteUser';
// The fleet's escape hatch. A car held by a driver who stopped without
// finishing could previously be freed by nobody but that driver.
export { managerReleaseVehicle } from './http/managerReleaseVehicle';

// Utility Functions
export { geocodeAddress } from './http/geocodeAddress';
