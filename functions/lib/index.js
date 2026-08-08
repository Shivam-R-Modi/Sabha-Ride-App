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
exports.geocodeAddress = exports.adminDeleteUser = exports.verifyManagerCode = exports.redeemManagerInvite = exports.createManagerInvite = exports.deleteSabhaEvent = exports.generateEventCSV = exports.manualAssignStudent = exports.studentReadyToLeave = exports.driverDoneForToday = exports.releaseAssignment = exports.completeRide = exports.startRide = exports.globalAssignDriver = exports.ensureSabhaEvents = exports.manuallyUpdateRideContext = exports.updateRideTypeContext = void 0;
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin
admin.initializeApp();
// ============================================
// SCHEDULED FUNCTIONS
// ============================================
var updateRideTypeContext_1 = require("./scheduled/updateRideTypeContext");
Object.defineProperty(exports, "updateRideTypeContext", { enumerable: true, get: function () { return updateRideTypeContext_1.updateRideTypeContext; } });
Object.defineProperty(exports, "manuallyUpdateRideContext", { enumerable: true, get: function () { return updateRideTypeContext_1.manuallyUpdateRideContext; } });
Object.defineProperty(exports, "ensureSabhaEvents", { enumerable: true, get: function () { return updateRideTypeContext_1.ensureSabhaEvents; } });
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
// Single-use, expiring invites. These ship ALONGSIDE verifyManagerCode rather
// than replacing it in one step: removing the old callable while a cached bundle
// still calls it turns signup into an opaque "internal" error. It goes in a
// second deploy, once a real invite has been redeemed end to end.
var managerInvites_1 = require("./http/managerInvites");
Object.defineProperty(exports, "createManagerInvite", { enumerable: true, get: function () { return managerInvites_1.createManagerInvite; } });
Object.defineProperty(exports, "redeemManagerInvite", { enumerable: true, get: function () { return managerInvites_1.redeemManagerInvite; } });
var verifyManagerCode_1 = require("./http/verifyManagerCode");
Object.defineProperty(exports, "verifyManagerCode", { enumerable: true, get: function () { return verifyManagerCode_1.verifyManagerCode; } });
var adminDeleteUser_1 = require("./http/adminDeleteUser");
Object.defineProperty(exports, "adminDeleteUser", { enumerable: true, get: function () { return adminDeleteUser_1.adminDeleteUser; } });
// Utility Functions
var geocodeAddress_1 = require("./http/geocodeAddress");
Object.defineProperty(exports, "geocodeAddress", { enumerable: true, get: function () { return geocodeAddress_1.geocodeAddress; } });
//# sourceMappingURL=index.js.map