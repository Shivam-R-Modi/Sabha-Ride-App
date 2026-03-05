"use strict";
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
exports.getSabhaLocation = getSabhaLocation;
/**
 * Fetch the Sabha location from the Firestore settings document.
 * Falls back to a default if the document doesn't exist or is missing data.
 */
const admin = __importStar(require("firebase-admin"));
const DEFAULT_SABHA_LOCATION = {
    lat: 42.339925,
    lng: -71.088182,
    address: '360 Huntington Ave, Boston, MA 02115',
};
/**
 * Read `settings/main` from Firestore and return the Sabha location.
 * Used by Cloud Functions that need the current venue coordinates.
 */
async function getSabhaLocation() {
    try {
        const db = admin.firestore();
        const snap = await db.collection('settings').doc('main').get();
        if (!snap.exists) {
            console.warn('[getSabhaLocation] settings/main not found — using default');
            return DEFAULT_SABHA_LOCATION;
        }
        const data = snap.data();
        const loc = data === null || data === void 0 ? void 0 : data.sabhaLocation;
        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
            return {
                lat: loc.lat,
                lng: loc.lng,
                address: loc.address || DEFAULT_SABHA_LOCATION.address,
            };
        }
        console.warn('[getSabhaLocation] Invalid sabhaLocation in settings — using default');
        return DEFAULT_SABHA_LOCATION;
    }
    catch (err) {
        console.error('[getSabhaLocation] Error fetching settings:', err);
        return DEFAULT_SABHA_LOCATION;
    }
}
//# sourceMappingURL=settings.js.map