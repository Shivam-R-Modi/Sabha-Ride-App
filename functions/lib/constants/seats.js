"use strict";
/**
 * How many seats one ride request may ask for.
 *
 * Until now a request WAS a seat: one `rides` document meant one person, and
 * every capacity check counted documents. A family of four got a driver with
 * room for one.
 *
 * `seatsRequested` is optional on the document and **absent means one**. That is
 * deliberate and it is the whole migration: every historical ride, and every
 * ride created by a client that has not shipped yet, keeps behaving exactly as
 * it does today. Nothing needs backfilling, so there is no window in which a
 * half-stamped collection quietly reports the wrong number of seats.
 *
 * MAX_SEATS is a sanity bound on what a rider may type, not a fleet limit — a
 * group larger than any vehicle is a normal case here (see utils/seats.ts) and
 * is served across several cars.
 *
 * Client mirror lives at src/constants/seats.ts. Separate tsconfigs, no shared
 * path, so the two files must hold the same values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SEATS = exports.MAX_SEATS = exports.MIN_SEATS = void 0;
exports.seatsOf = seatsOf;
exports.MIN_SEATS = 1;
exports.MAX_SEATS = 8;
exports.DEFAULT_SEATS = 1;
/**
 * The seat count for a ride document, tolerating every shape a stored ride can
 * have: absent (every ride written before this release), null, a string from a
 * hand-edited console row, or a non-integer.
 *
 * Read this rather than `ride.seatsRequested ?? 1` at each call site — the
 * default is load-bearing and a single site that forgets it silently under-books
 * a family.
 */
function seatsOf(ride) {
    const raw = Number(ride === null || ride === void 0 ? void 0 : ride.seatsRequested);
    if (!Number.isFinite(raw))
        return exports.DEFAULT_SEATS;
    const whole = Math.floor(raw);
    if (whole < exports.MIN_SEATS)
        return exports.DEFAULT_SEATS;
    return Math.min(whole, exports.MAX_SEATS);
}
//# sourceMappingURL=seats.js.map