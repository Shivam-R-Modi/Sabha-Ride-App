"use strict";
/**
 * Coordinate resolution for user profiles.
 *
 * Home coordinates are written by ProfileSetup as
 * `users/{id}.location.{latitude, longitude}` and read back that way by
 * createRideRequest. But the assignment functions read `{lat, lng}` and
 * normalise both shapes, and some driver records use `homeLocation`. Rather
 * than repeat a `??` chain at each call site and get it subtly wrong in one of
 * them, resolve it in one place.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveHomeCoords = resolveHomeCoords;
const isUsable = (n) => typeof n === 'number' && !Number.isNaN(n);
/**
 * Pull usable home coordinates off a user document, tolerating every shape the
 * codebase writes. Returns null when no usable pair exists — including the
 * 0,0 placeholder, which means "address never geocoded" rather than a point in
 * the Atlantic.
 */
function resolveHomeCoords(user) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const candidates = [
        // What ProfileSetup actually writes, and what createRideRequest reads.
        { lat: (_a = user === null || user === void 0 ? void 0 : user.location) === null || _a === void 0 ? void 0 : _a.latitude, lng: (_b = user === null || user === void 0 ? void 0 : user.location) === null || _b === void 0 ? void 0 : _b.longitude },
        // The shape the assignment functions use internally.
        { lat: (_c = user === null || user === void 0 ? void 0 : user.location) === null || _c === void 0 ? void 0 : _c.lat, lng: (_d = user === null || user === void 0 ? void 0 : user.location) === null || _d === void 0 ? void 0 : _d.lng },
        // Drivers, and some older records.
        { lat: (_e = user === null || user === void 0 ? void 0 : user.homeLocation) === null || _e === void 0 ? void 0 : _e.lat, lng: (_f = user === null || user === void 0 ? void 0 : user.homeLocation) === null || _f === void 0 ? void 0 : _f.lng },
        { lat: (_g = user === null || user === void 0 ? void 0 : user.homeLocation) === null || _g === void 0 ? void 0 : _g.latitude, lng: (_h = user === null || user === void 0 ? void 0 : user.homeLocation) === null || _h === void 0 ? void 0 : _h.longitude },
    ];
    for (const c of candidates) {
        if (!isUsable(c.lat) || !isUsable(c.lng))
            continue;
        if (c.lat === 0 && c.lng === 0)
            continue;
        return { lat: c.lat, lng: c.lng };
    }
    return null;
}
// zonedDateKey used to live here. It now sits in ./time alongside the other
// zone-aware helpers, so there is one place that knows how to read a clock.
//# sourceMappingURL=coords.js.map