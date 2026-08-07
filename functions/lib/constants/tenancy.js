"use strict";
/**
 * The founding city and location.
 *
 * The app serves one congregation at one venue. The roadmap's target is cities as
 * isolation silos with several locations inside each, and every `users`, `rides`
 * and `auditLogs` document carries the pair so that a later release can filter on
 * it. Until then these are written and never read: nothing queries `cityId`, and
 * deliberately so.
 *
 * The reason for stamping ahead of filtering is asymmetric failure. A query with
 * `where('cityId', '==', …)` and no matching index fails loudly. The same query
 * against a document that was never stamped does not fail at all — it correctly
 * returns nothing, and no error handler anywhere will ever run. That is an empty
 * ride list on a Friday night with nothing to diagnose from. So: stamp everything,
 * backfill, prove with a verifier that nothing is unstamped, and only then filter.
 *
 * Renaming either value later means migrating every stamped document, so treat
 * them as permanent identifiers rather than display names. Neither is ever shown
 * to a rider.
 *
 * Mirrored in src/constants/tenancy.ts for the client — separate tsconfigs, no
 * shared path. The two must hold the same values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOUNDING_LOCATION_ID = exports.FOUNDING_CITY_ID = void 0;
exports.FOUNDING_CITY_ID = 'boston';
exports.FOUNDING_LOCATION_ID = 'boston-huntington';
//# sourceMappingURL=tenancy.js.map