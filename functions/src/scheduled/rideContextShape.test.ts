/**
 * The shape of `system/rideContext`, now that it describes more than one hall.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the first one: **with exactly one hall the
 * published document is identical to what it published before.** Every day until a
 * manager adds a second hall, that is the whole behaviour of this change, and it is the
 * only guarantee that makes the plumbing safe to deploy ahead of the feature.
 *
 * It is worth stating as a value comparison because this document is the single source
 * for whether rides are open, for every client and four server callers. A field that
 * moved, changed meaning or quietly went missing would not throw anywhere — the readers
 * are all `?.`-chained, so an absent field resolves to "no sabha scheduled" and the app
 * simply stops working, politely.
 *
 * `updateRideTypeContext` had NO test file before this. `attendanceHeader.test.ts`
 * covers one exported helper from it and nothing else, which is why the builder was
 * extracted as a pure function rather than tested through a Firestore stub.
 */

import { describe, it, expect } from 'vitest';
import { buildRideContextDoc, hallContexts, type HallContext } from './updateRideTypeContext';
import { buildCurrentEvent, resolveScheduleWindow } from '../utils/schedule';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';

const ZONE = 'America/New_York';
const DATE = '2026-08-07';
const NOW = new Date('2026-08-07T23:30:00Z'); // 7:30 PM Boston, sabha in progress

const HUNTINGTON = { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' };
const SOMERVILLE = { lat: 42.387, lng: -71.099, address: '5 Elm Street' };

const SCHEDULED = {
    date: DATE, startTime: '19:00', endTime: '22:00', venue: null, agenda: 'Kirtan',
};

/** Exactly what the pre-change code wrote, rebuilt here so the comparison is real. */
function singleHallShape(now: Date) {
    const event = buildCurrentEvent(DATE, '19:00', '22:00', ZONE, {
        venue: HUNTINGTON, agenda: 'Kirtan', requestsOpenTime: '10:00',
    });
    const window = resolveScheduleWindow(now, event, ZONE);
    return {
        ...window,
        ...event,
        calendarStatus: 'ok',
        overrideUntil: null,
        lastUpdated: now.toISOString(),
    };
}

const founding = (over: Partial<HallContext> = {}): HallContext => {
    const event = buildCurrentEvent(DATE, '19:00', '22:00', ZONE, {
        venue: HUNTINGTON, agenda: 'Kirtan', requestsOpenTime: '10:00',
    });
    return {
        locationId: FOUNDING_LOCATION_ID,
        event,
        window: resolveScheduleWindow(NOW, event, ZONE),
        ...over,
    };
};

describe('with one hall, nothing changed', () => {
    it('publishes the single-hall shape at the top level, field for field', () => {
        const doc = buildRideContextDoc([founding()], NOW);
        const before = singleHallShape(NOW);

        for (const key of Object.keys(before)) {
            expect(doc[key], key).toEqual((before as Record<string, unknown>)[key]);
        }
    });

    it('adds only byLocation and locationIds', () => {
        const doc = buildRideContextDoc([founding()], NOW);
        const added = Object.keys(doc).filter(k => !(k in singleHallShape(NOW)));
        expect(added.sort()).toEqual(['byLocation', 'locationIds']);
    });

    it('keeps the founding hall on the bare date, so attendance history is not re-keyed', () => {
        const doc = buildRideContextDoc([founding()], NOW);
        expect(doc.eventId).toBe(DATE);
    });

    it('describes that one hall in byLocation as well', () => {
        const doc = buildRideContextDoc([founding()], NOW);
        const by = doc.byLocation as Record<string, Record<string, unknown>>;
        expect(Object.keys(by)).toEqual([FOUNDING_LOCATION_ID]);
        expect(by[FOUNDING_LOCATION_ID].rideType).toBe(doc.rideType);
        expect(by[FOUNDING_LOCATION_ID].eventId).toBe(doc.eventId);
    });
});

describe('with nothing scheduled', () => {
    it('says so rather than leaving fields undefined', () => {
        const hall: HallContext = {
            locationId: FOUNDING_LOCATION_ID,
            event: null,
            window: resolveScheduleWindow(NOW, null, ZONE),
        };
        const doc = buildRideContextDoc([hall], NOW);

        expect(doc.eventId).toBeNull();
        expect(doc.calendarStatus).toBe('no-scheduled-event');
        expect(doc.rideType).toBeNull();
    });

    it('publishes an empty hall list rather than throwing, if there are somehow none', () => {
        // `locationsOrFoundingFallback` should make this unreachable. If it is ever
        // reached, a document that says "no halls" is diagnosable; a crashed scheduler
        // leaves the last tick's window frozen in place, which is not.
        const doc = buildRideContextDoc([], NOW);
        expect(doc.locationIds).toEqual([]);
        expect(doc.byLocation).toEqual({});
        expect(doc.calendarStatus).toBe('no-scheduled-event');
    });
});

describe('with two halls', () => {
    const somerville = (): HallContext => {
        const event = buildCurrentEvent(DATE, '19:00', '22:00', ZONE, {
            venue: SOMERVILLE, agenda: 'Kirtan', requestsOpenTime: '10:00',
            eventId: `${DATE}__somerville`, locationId: 'somerville',
        });
        return {
            locationId: 'somerville',
            event,
            window: resolveScheduleWindow(NOW, event, ZONE),
        };
    };

    it('gives each hall its own key and its own venue', () => {
        const doc = buildRideContextDoc([founding(), somerville()], NOW);
        const by = doc.byLocation as Record<string, Record<string, unknown>>;

        expect(by[FOUNDING_LOCATION_ID].eventId).toBe(DATE);
        expect(by.somerville.eventId).toBe(`${DATE}__somerville`);
        expect(by[FOUNDING_LOCATION_ID].venue).toEqual(HUNTINGTON);
        expect(by.somerville.venue).toEqual(SOMERVILLE);
    });

    it('lists both, so a client can tell "my hall is closed" from "my hall is missing"', () => {
        // Without the list, an absent byLocation key is indistinguishable from a closed
        // window — the exact ambiguity calendarStatus was invented to remove.
        const doc = buildRideContextDoc([founding(), somerville()], NOW);
        expect(doc.locationIds).toEqual([FOUNDING_LOCATION_ID, 'somerville']);
    });

    it('aggregates the FOUNDING hall at the top level, for clients that cannot read byLocation', () => {
        const doc = buildRideContextDoc([somerville(), founding()], NOW);
        // Order in the input must not decide it — the founding hall is chosen by id.
        expect(doc.eventId).toBe(DATE);
        expect(doc.venue).toEqual(HUNTINGTON);
    });

    it('falls back to the first hall when the founding one is not open', () => {
        const doc = buildRideContextDoc([somerville()], NOW);
        expect(doc.eventId).toBe(`${DATE}__somerville`);
    });

    it('aggregates CONSERVATIVELY — a stale client sees closed rather than a window it cannot serve', () => {
        /**
         * The alternative was "the widest window across halls". A months-old bundle
         * reading `rideType: 'home-to-sabha'` because SOMERVILLE is open would let a
         * rider file a request for a hall it cannot even name. Reading "closed" while
         * another hall is open merely makes them wait and update the app.
         */
        // 6 PM Boston, inside the pickup window — NOW is 7:30 PM, when sabha is in
        // progress and BOTH halls are legitimately closed, so it could not tell the
        // conservative aggregate from the widest one.
        const open = new Date('2026-08-07T22:00:00Z');
        const somervilleEvent = buildCurrentEvent(DATE, '19:00', '22:00', ZONE, {
            venue: SOMERVILLE, agenda: 'Kirtan', requestsOpenTime: '10:00',
            eventId: `${DATE}__somerville`, locationId: 'somerville',
        });
        const openSomerville: HallContext = {
            locationId: 'somerville',
            event: somervilleEvent,
            window: resolveScheduleWindow(open, somervilleEvent, ZONE),
        };
        const closedFounding: HallContext = {
            locationId: FOUNDING_LOCATION_ID,
            event: null,
            window: resolveScheduleWindow(open, null, ZONE),
        };

        // Guard the fixture: if Somerville were not actually open, this case would
        // pass by accident and prove nothing.
        expect(openSomerville.window.rideType).toBe('home-to-sabha');

        const doc = buildRideContextDoc([closedFounding, openSomerville], open);
        expect(doc.rideType).toBeNull();
        expect((doc.byLocation as Record<string, Record<string, unknown>>).somerville.rideType)
            .toBe('home-to-sabha');
    });
});

describe('building one gathering per hall', () => {
    const halls = [
        { id: FOUNDING_LOCATION_ID, venue: HUNTINGTON },
        { id: 'somerville', venue: SOMERVILLE },
    ];

    it('shares the date and the times, and differs only in the venue', () => {
        // The owner's model: both halls the same evening at the same time. Per-hall
        // times are the rare case and arrive later.
        const [a, b] = hallContexts(SCHEDULED, halls, NOW, ZONE, '10:00');

        expect(a.event!.startsAt).toBe(b.event!.startsAt);
        expect(a.event!.endsAt).toBe(b.event!.endsAt);
        expect(a.event!.requestsOpenAt).toBe(b.event!.requestsOpenAt);
        expect(a.event!.venue).toEqual(HUNTINGTON);
        expect(b.event!.venue).toEqual(SOMERVILLE);
    });

    it('RESOLVES THE VENUE THROUGH THE HALL when the gathering has no override', () => {
        /**
         * A real change in the published document, and worth pinning rather than
         * discovering. Production had `venue: null` on `system/rideContext`, because
         * the recurring sabha carries no per-event override — clients fell through to
         * `settings/main` themselves.
         *
         * The precedence is now `event.venue → locations/{id}.venue →
         * settings/main`, so the hall's own venue is published instead of null. The
         * address a rider sees is unchanged today because the seed script COPIED it
         * from `settings/main`; what changes is that the hall is now the authority, so
         * a manager moving one hall no longer needs the global default to follow.
         */
        const [a] = hallContexts(SCHEDULED, halls, NOW, ZONE, '10:00');
        expect(SCHEDULED.venue).toBeNull();
        expect(a.event!.venue).toEqual(HUNTINGTON);
    });

    it('lets the gathering own override beat the hall standing venue', () => {
        // The existing precedence, one link longer: event venue → hall → settings/main.
        const oneOff = { ...SCHEDULED, venue: { lat: 42.5, lng: -71.2, address: 'Church Hall' } };
        const [a, b] = hallContexts(oneOff, halls, NOW, ZONE, '10:00');

        expect(a.event!.venue!.address).toBe('Church Hall');
        expect(b.event!.venue!.address).toBe('Church Hall');
    });

    it('KEYS the founding hall on the bare date and everyone else with a suffix', () => {
        /**
         * The migration, asserted where it is actually decided. There is a test above
         * that `buildRideContextDoc` publishes a bare date, but it builds its fixture
         * by hand — so it passed happily while `hallContexts` suffixed every hall
         * including the founding one. Found by mutation.
         *
         * If the founding hall were suffixed, every `events`, `weeklyAttendance` and
         * `statistics` document already written would be filed under a key nothing
         * looks up any more: reads return empty, nothing errors, and a manager sees an
         * evening with no attendance and no history.
         */
        const [a, b] = hallContexts(SCHEDULED, halls, NOW, ZONE, '10:00');
        expect(a.event!.eventId).toBe(DATE);
        expect(b.event!.eventId).toBe(`${DATE}__somerville`);
    });

    it('stamps the hall on the gathering, so a ride can be traced back to it', () => {
        const [a, b] = hallContexts(SCHEDULED, halls, NOW, ZONE, '10:00');
        expect(a.event!.locationId).toBe(FOUNDING_LOCATION_ID);
        expect(b.event!.locationId).toBe('somerville');
    });

    it('closes every hall when nothing is scheduled, rather than some of them', () => {
        const contexts = hallContexts(null, halls, NOW, ZONE, '10:00');
        expect(contexts.map(c => c.event)).toEqual([null, null]);
        expect(contexts.every(c => c.window.rideType === null)).toBe(true);
    });
});
