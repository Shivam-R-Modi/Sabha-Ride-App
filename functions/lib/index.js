"use strict";
// ============================================
// SABHA RIDE SEVA - FIREBASE CLOUD FUNCTIONS
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
exports.managerReleaseVehicle = exports.adminDeleteUser = exports.redeemManagerInvite = exports.createManagerInvite = exports.deleteSabhaEvent = exports.generateEventCSV = exports.manualAssignStudent = exports.studentReadyToLeave = exports.driverDoneForToday = exports.releaseAssignment = exports.completeRide = exports.expireNotices = exports.deleteNotice = exports.publishNotice = exports.managerBroadcast = exports.nudgeRider = exports.sarthiArrived = exports.startRide = exports.globalAssignDriver = exports.updateSabhaRecurrence = exports.expireStaleRequests = exports.releaseIdleVehicles = exports.manuallyUpdateRideContext = exports.updateRideTypeContext = void 0;
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin
admin.initializeApp();
// ============================================
// SCHEDULED FUNCTIONS
// ============================================
var updateRideTypeContext_1 = require("./scheduled/updateRideTypeContext");
Object.defineProperty(exports, "updateRideTypeContext", { enumerable: true, get: function () { return updateRideTypeContext_1.updateRideTypeContext; } });
Object.defineProperty(exports, "manuallyUpdateRideContext", { enumerable: true, get: function () { return updateRideTypeContext_1.manuallyUpdateRideContext; } });
// ensureSabhaEvents is gone. It seeded a first gathering and topped the calendar
// up from the recurring pattern; under the rule model there is nothing to
// materialise, so there is nothing for a nightly job to get wrong.
// Its own named function rather than a side effect of another job: a stranded
// fleet is an operational fault, and a named entry in the logs is what makes it
// diagnosable at 19:00 on a Friday.
var releaseIdleVehicles_1 = require("./scheduled/releaseIdleVehicles");
Object.defineProperty(exports, "releaseIdleVehicles", { enumerable: true, get: function () { return releaseIdleVehicles_1.releaseIdleVehicles; } });
// Same 03:00 slot, same reasoning: requests nobody answered are the rider-side
// equivalent of a stranded car, and they never expired on their own.
var expireStaleRequests_1 = require("./scheduled/expireStaleRequests");
Object.defineProperty(exports, "expireStaleRequests", { enumerable: true, get: function () { return expireStaleRequests_1.expireStaleRequests; } });
// The manager's recurring pattern — one rule, no horizon. findCurrentEvent
// computes from it directly; this is the control that sets it.
var sabhaRecurrence_1 = require("./http/sabhaRecurrence");
Object.defineProperty(exports, "updateSabhaRecurrence", { enumerable: true, get: function () { return sabhaRecurrence_1.updateSabhaRecurrence; } });
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
var globalAssignDriver_1 = require("./http/globalAssignDriver");
Object.defineProperty(exports, "globalAssignDriver", { enumerable: true, get: function () { return globalAssignDriver_1.globalAssignDriver; } });
var startRide_1 = require("./http/startRide");
Object.defineProperty(exports, "startRide", { enumerable: true, get: function () { return startRide_1.startRide; } });
var sarthiArrived_1 = require("./http/sarthiArrived");
Object.defineProperty(exports, "sarthiArrived", { enumerable: true, get: function () { return sarthiArrived_1.sarthiArrived; } });
var nudgeRider_1 = require("./http/nudgeRider");
Object.defineProperty(exports, "nudgeRider", { enumerable: true, get: function () { return nudgeRider_1.nudgeRider; } });
var managerBroadcast_1 = require("./http/managerBroadcast");
Object.defineProperty(exports, "managerBroadcast", { enumerable: true, get: function () { return managerBroadcast_1.managerBroadcast; } });
var publishNotice_1 = require("./http/publishNotice");
Object.defineProperty(exports, "publishNotice", { enumerable: true, get: function () { return publishNotice_1.publishNotice; } });
var deleteNotice_1 = require("./http/deleteNotice");
Object.defineProperty(exports, "deleteNotice", { enumerable: true, get: function () { return deleteNotice_1.deleteNotice; } });
var expireNotices_1 = require("./scheduled/expireNotices");
Object.defineProperty(exports, "expireNotices", { enumerable: true, get: function () { return expireNotices_1.expireNotices; } });
var completeRide_1 = require("./http/completeRide");
Object.defineProperty(exports, "completeRide", { enumerable: true, get: function () { return completeRide_1.completeRide; } });
var releaseAssignment_1 = require("./http/releaseAssignment");
Object.defineProperty(exports, "releaseAssignment", { enumerable: true, get: function () { return releaseAssignment_1.releaseAssignment; } });
var driverDoneForToday_1 = require("./http/driverDoneForToday");
Object.defineProperty(exports, "driverDoneForToday", { enumerable: true, get: function () { return driverDoneForToday_1.driverDoneForToday; } });
// Student Functions
var studentReadyToLeave_1 = require("./http/studentReadyToLeave");
Object.defineProperty(exports, "studentReadyToLeave", { enumerable: true, get: function () { return studentReadyToLeave_1.studentReadyToLeave; } });
// Manager Functions
var manualAssignStudent_1 = require("./http/manualAssignStudent");
Object.defineProperty(exports, "manualAssignStudent", { enumerable: true, get: function () { return manualAssignStudent_1.manualAssignStudent; } });
var generateEventCSV_1 = require("./http/generateEventCSV");
Object.defineProperty(exports, "generateEventCSV", { enumerable: true, get: function () { return generateEventCSV_1.generateEventCSV; } });
var deleteSabhaEvent_1 = require("./http/deleteSabhaEvent");
Object.defineProperty(exports, "deleteSabhaEvent", { enumerable: true, get: function () { return deleteSabhaEvent_1.deleteSabhaEvent; } });
// Single-use, expiring invites. verifyManagerCode was exported here and is gone:
// one shared, never-expiring code that any approved manager could read back in
// plaintext. It shipped alongside these for one release so no cached bundle would
// call a callable that had vanished, then was removed once a real invite had been
// minted and redeemed end to end.
var managerInvites_1 = require("./http/managerInvites");
Object.defineProperty(exports, "createManagerInvite", { enumerable: true, get: function () { return managerInvites_1.createManagerInvite; } });
Object.defineProperty(exports, "redeemManagerInvite", { enumerable: true, get: function () { return managerInvites_1.redeemManagerInvite; } });
var adminDeleteUser_1 = require("./http/adminDeleteUser");
Object.defineProperty(exports, "adminDeleteUser", { enumerable: true, get: function () { return adminDeleteUser_1.adminDeleteUser; } });
// The fleet's escape hatch. A car held by a driver who stopped without
// finishing could previously be freed by nobody but that driver.
var managerReleaseVehicle_1 = require("./http/managerReleaseVehicle");
Object.defineProperty(exports, "managerReleaseVehicle", { enumerable: true, get: function () { return managerReleaseVehicle_1.managerReleaseVehicle; } });
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
//# sourceMappingURL=index.js.map