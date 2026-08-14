/**
 * The manager's queue and dispatch must agree about who is waiting.
 *
 * `globalAssignDriver` dispatches from a pool scoped to the gathering and the
 * direction on `system/rideContext`. The manager's Waiting tab listed every
 * `requested` ride in the collection.
 *
 * So they disagreed in public. On 2026-08-14 the queue read "Waiting · 4" while
 * a driver tapping Assign Me was told "Nobody is waiting right now" — four
 * riders who had asked for a pickup, sitting there after the window had moved on
 * to drop-off, whom no tap could ever serve. A count a manager cannot act on is
 * worse than no count: it sends them hunting a fault in dispatch.
 *
 * These rules MIRROR `isValidPendingRide` in
 * functions/src/http/globalAssignDriver.ts, minus its GPS checks. The two files
 * cannot import from each other — separate tsconfigs — so this suite states the
 * shared rules explicitly, the same arrangement as src/constants/seats.ts and
 * its functions/ twin.
 */

import { describe, it, expect } from 'vitest';
import { isDispatchable, eventKeyOf, directionOf } from '../../src/utils/ridePool';

const EVENT = '2026-08-14';
/** What hooks/useRides.ts actually writes for a pickup: no rideType at all. */
const PICKUP = { eventDate: EVENT };
/** What studentReadyToLeave writes. */
const DROPOFF = { eventDate: EVENT, rideType: 'sabha-to-home' };

describe('eventKeyOf', () => {
    it('prefers eventId, which the server writes', () => {
        expect(eventKeyOf({ eventId: EVENT, eventDate: '2026-08-09' })).toBe(EVENT);
    });

    it('falls back to eventDate, which the browser writes', () => {
        expect(eventKeyOf({ eventDate: EVENT })).toBe(EVENT);
    });

    it('rejects a malformed key rather than matching on it', () => {
        expect(eventKeyOf({ eventDate: 'next friday' })).toBeNull();
    });

    it('is null when the ride cannot say', () => {
        expect(eventKeyOf({})).toBeNull();
        expect(eventKeyOf(null)).toBeNull();
    });
});

describe('directionOf', () => {
    it('treats an ABSENT rideType as a pickup, because every real one is', () => {
        // Load-bearing, not defensive: a pickup request has never carried the
        // field, so treating absent as "unknown" would hide every genuine one.
        expect(directionOf(PICKUP)).toBe('home-to-sabha');
        expect(directionOf({})).toBe('home-to-sabha');
    });

    it('reads an explicit direction', () => {
        expect(directionOf(DROPOFF)).toBe('sabha-to-home');
        expect(directionOf({ rideType: 'home-to-sabha' })).toBe('home-to-sabha');
    });
});

describe('isDispatchable — agreeing with the server', () => {
    it('counts a pickup during the pickup window', () => {
        expect(isDispatchable(PICKUP, EVENT, 'home-to-sabha')).toBe(true);
    });

    it('does NOT count a pickup during the drop-off window — the reported case', () => {
        expect(isDispatchable(PICKUP, EVENT, 'sabha-to-home')).toBe(false);
    });

    it('counts a drop-off during the drop-off window', () => {
        expect(isDispatchable(DROPOFF, EVENT, 'sabha-to-home')).toBe(true);
    });

    it('does not count a drop-off during the pickup window', () => {
        expect(isDispatchable(DROPOFF, EVENT, 'home-to-sabha')).toBe(false);
    });

    it('does not count a request for a past gathering', () => {
        expect(isDispatchable({ eventDate: '2026-08-09' }, EVENT, 'home-to-sabha')).toBe(false);
    });

    it('does not count a request for a future gathering', () => {
        // Requests open two days ahead, so next week's can already exist.
        expect(isDispatchable({ eventDate: '2026-08-21' }, EVENT, 'home-to-sabha')).toBe(false);
    });

    it('does not count a request with no event key', () => {
        expect(isDispatchable({}, EVENT, 'home-to-sabha')).toBe(false);
    });

    it('counts nothing when no window is published', () => {
        // rideType and eventId are both null when nothing is scheduled. Showing a
        // queue then invites a manager to act on riders no driver can be given.
        expect(isDispatchable(PICKUP, null, null)).toBe(false);
        expect(isDispatchable(PICKUP, EVENT, null)).toBe(false);
        expect(isDispatchable(PICKUP, null, 'home-to-sabha')).toBe(false);
    });

    it('applies both rules, not one or the other', () => {
        // Right direction, wrong gathering.
        expect(isDispatchable(
            { eventDate: '2026-08-09', rideType: 'sabha-to-home' }, EVENT, 'sabha-to-home',
        )).toBe(false);
    });

    it('survives a null ride', () => {
        expect(isDispatchable(null, EVENT, 'home-to-sabha')).toBe(false);
    });
});
