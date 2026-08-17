/**
 * The attendance record has to say what people were actually coming to.
 *
 * `weeklyAttendance/{eventId}` exists for one reason: a list of who was coming,
 * with no record of what they were coming to, cannot be reconstructed later. Its
 * header carries the gathering's own times and venue.
 *
 * THE BUG
 * -------
 * The caller asked only whether the eventId had CHANGED. So editing the current
 * gathering's time never reached the header, and `recordEventDetails`'s own
 * comment claimed the opposite — "manager edits to the venue mid-week are picked
 * up". They were not.
 *
 * Measured in production on 2026-08-17, while testing the new rule-based
 * calendar. `weeklyAttendance/2026-08-17` said the sabha started at 4:00 AM; it
 * started at 11:00 PM — nineteen hours out. `2026-08-14` said 3:15 PM for a
 * gathering that ran at 7:45 PM. Two of five headers wrong.
 *
 * `attendanceLocksAt` agreed in both cases, which is why nobody caught it: that
 * one is derived from the DATE, so it stays correct while the times drift.
 *
 * The two directions matter equally. Missing a real change corrupts the record;
 * reporting a change on every tick would write 1,440 times a day for nothing.
 */

import { describe, it, expect } from 'vitest';

// Imported for its pure export only. The module pulls in firebase-functions at
// load, so the pubsub builder is stubbed rather than the whole module mocked.
import { attendanceHeaderChanged } from './updateRideTypeContext';
import type { CurrentEvent } from '../utils/schedule';

const EVENT: CurrentEvent = {
    eventId: '2026-08-17',
    requestsOpenAt: '2026-08-15T04:00:00.000Z',
    startsAt: '2026-08-18T03:00:00.000Z',
    endsAt: '2026-08-18T03:30:00.000Z',
    dropoffOpensAt: '2026-08-18T03:15:00.000Z',
    closesAt: '2026-08-18T04:00:00.000Z',
    attendanceLocksAt: '2026-08-16T22:00:00.000Z',
    venue: null,
};

/** rideContext as published on the previous tick — the same fields, for free. */
const publishedFrom = (event: CurrentEvent) => ({
    eventId: event.eventId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    attendanceLocksAt: event.attendanceLocksAt,
    venue: event.venue ?? null,
});

describe('attendanceHeaderChanged — writes when it must', () => {
    it('the exact production case: the START TIME moved', () => {
        // 4:00 AM published, 11:00 PM actual. This returned false before, so the
        // header kept the 4:00 AM figure for the whole gathering.
        const stale = { ...publishedFrom(EVENT), startsAt: '2026-08-17T08:00:00.000Z' };

        expect(attendanceHeaderChanged(stale, EVENT)).toBe(true);
    });

    it('the end time moved', () => {
        const stale = { ...publishedFrom(EVENT), endsAt: '2026-08-17T08:30:00.000Z' };

        expect(attendanceHeaderChanged(stale, EVENT)).toBe(true);
    });

    it('the gathering itself changed', () => {
        const other = { ...publishedFrom(EVENT), eventId: '2026-08-21' };

        expect(attendanceHeaderChanged(other, EVENT)).toBe(true);
    });

    it('there is nothing published yet', () => {
        expect(attendanceHeaderChanged(undefined, EVENT)).toBe(true);
    });

    it('a venue was added', () => {
        const before = publishedFrom(EVENT);
        const withVenue = { ...EVENT, venue: { lat: 42.3, lng: -71.1, address: 'Hall' } };

        expect(attendanceHeaderChanged(before, withVenue)).toBe(true);
    });

    it('a venue was removed', () => {
        const before = { ...publishedFrom(EVENT), venue: { lat: 42.3, lng: -71.1, address: 'Hall' } };

        expect(attendanceHeaderChanged(before, EVENT)).toBe(true);
    });

    it('the venue MOVED to different coordinates', () => {
        const before = { ...publishedFrom(EVENT), venue: { lat: 42.3, lng: -71.1, address: 'Hall' } };
        const moved = { ...EVENT, venue: { lat: 42.4, lng: -71.2, address: 'Hall' } };

        expect(attendanceHeaderChanged(before, moved)).toBe(true);
    });

    it('catches a change even when attendanceLocksAt still agrees', () => {
        // Exactly why this went unnoticed for days: the lock time is derived from
        // the date, so it stays right while the times drift.
        const stale = { ...publishedFrom(EVENT), startsAt: '2026-08-17T08:00:00.000Z' };

        expect(stale.attendanceLocksAt).toBe(EVENT.attendanceLocksAt);
        expect(attendanceHeaderChanged(stale, EVENT)).toBe(true);
    });
});

describe('attendanceHeaderChanged — silent when nothing moved', () => {
    it('says no when the header already matches', () => {
        // This function runs every minute. Returning true here would be 1,440
        // writes a day to say nothing changed.
        expect(attendanceHeaderChanged(publishedFrom(EVENT), EVENT)).toBe(false);
    });

    it('treats an ABSENT venue and a null venue as the same thing', () => {
        // Both mean "use the default from settings/main". Reading one as a change
        // would make every tick a write.
        const { venue, ...withoutVenue } = publishedFrom(EVENT);

        expect(attendanceHeaderChanged(withoutVenue, EVENT)).toBe(false);
    });

    it('ignores a venue address rewritten without moving', () => {
        // Coordinates are what routing uses. A reformatted address string is not a
        // change worth a write.
        const before = { ...publishedFrom(EVENT), venue: { lat: 42.3, lng: -71.1, address: 'The Hall' } };
        const relabelled = { ...EVENT, venue: { lat: 42.3, lng: -71.1, address: '360 Huntington Ave' } };

        expect(attendanceHeaderChanged(before, relabelled)).toBe(false);
    });

    it('ignores the extra fields rideContext carries', () => {
        // rideContext holds displayText, timeContext, lastUpdated and more. None of
        // them belong to the attendance header, and lastUpdated changes every tick.
        const noisy = {
            ...publishedFrom(EVENT),
            displayText: 'Home → Sabha',
            timeContext: 'Sabha Monday, Aug 17 at 11:00 PM',
            lastUpdated: new Date().toISOString(),
            rideType: 'home-to-sabha',
        };

        expect(attendanceHeaderChanged(noisy, EVENT)).toBe(false);
    });
});
