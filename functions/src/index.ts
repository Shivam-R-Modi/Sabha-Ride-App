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
// ensureSabhaEvents is gone. It seeded a first gathering and topped the calendar
// up from the recurring pattern; under the rule model there is nothing to
// materialise, so there is nothing for a nightly job to get wrong.
// Its own named function rather than a side effect of another job: a stranded
// fleet is an operational fault, and a named entry in the logs is what makes it
// diagnosable at 19:00 on a Friday.
export { releaseIdleVehicles } from './scheduled/releaseIdleVehicles';
// Same 03:00 slot, same reasoning: requests nobody answered are the rider-side
// equivalent of a stranded car, and they never expired on their own.
export { expireStaleRequests } from './scheduled/expireStaleRequests';
// The manager's recurring pattern — one rule, no horizon. findCurrentEvent
// computes from it directly; this is the control that sets it.
export { updateSabhaRecurrence } from './http/sabhaRecurrence';

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
export { sarthiArrived } from './http/sarthiArrived';
export { nudgeRider } from './http/nudgeRider';
export { managerBroadcast } from './http/managerBroadcast';
export { publishNotice } from './http/publishNotice';
export { deleteNotice } from './http/deleteNotice';
export { expireNotices } from './scheduled/expireNotices';
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
// geocodeAddress was exported here. Deleted 2026-08-18: it returned 500 for every
// call for its whole life, because GOOGLE_MAPS_API_KEY in functions/.env is an
// HTTP-referer-restricted key and referer restrictions are a browser mechanism —
// a server sends no referer, so such a key can never work server-to-server.
//
// Fixing it needed a SECOND, unrestricted key: another credential to store,
// rotate and leak. The browser key already geocodes (verified against production
// against this very address), so the client does it directly now — see
// geocodeAddressInBrowser in hooks/useGooglePlaces.ts. Nothing calls this any
// more, and a deployed endpoint that always fails is a control that cannot work.
//
// GOOGLE_MAPS_API_KEY is no longer read by any function and can be dropped from
// functions/.env.
