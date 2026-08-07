/**
 * The founding city and location. Client mirror of
 * functions/src/constants/tenancy.ts — separate tsconfigs, no shared path, so the
 * two files must hold the same values.
 *
 * Written onto every document this app creates, and read by nothing. See the
 * server copy for why stamping runs a release ahead of filtering: a query against
 * an unstamped document returns nothing rather than erroring, so an incomplete
 * backfill is invisible from the client.
 *
 * Never displayed to a user.
 */

export const FOUNDING_CITY_ID = 'boston';
export const FOUNDING_LOCATION_ID = 'boston-huntington';
