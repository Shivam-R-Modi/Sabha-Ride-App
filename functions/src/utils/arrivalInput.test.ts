/**
 * Validating an airport-pickup payload.
 *
 * The four assertions here that are worth more than the rest:
 *
 *  - **a 22:00 landing at BOS and a 22:00 landing at ORD are an hour apart.** That
 *    is the entire reason creation is a callable rather than a client write.
 *  - **`2026-02-30` is refused.** The regex accepts it and `Date.UTC` rolls it over
 *    to March without complaint, so a regex alone turns a typo into a card sitting
 *    on the board under the wrong month with nothing reporting a problem.
 *  - **"WhatsApp is on my other number" with no other number is refused.** Otherwise
 *    the Sarthi's card renders a button that opens WhatsApp with nobody in it —
 *    which is this repo's signature defect, a control that looks wired up and does
 *    nothing.
 *  - **`compact` strips undefined.** The Admin SDK is not configured with
 *    `ignoreUndefinedProperties`, so one undefined value makes the whole write
 *    throw — and the fake Firestore in these tests accepts it happily, so without
 *    this the failure only ever appears in production.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { HttpsError: FakeHttpsError } };
});

import { compact, parseFlight, parsePerson, parseTrip, retainUntilFor } from './arrivalInput';

const ZONE = 'America/New_York';
const NOW = new Date('2026-09-01T12:00:00Z');

const flight = (over: Record<string, unknown> = {}) => parseFlight({
    arrivalDate: '2026-09-20',
    arrivalTime: '22:00',
    airportCode: 'BOS',
    ...over,
}, ZONE, NOW);

const person = (over: Record<string, unknown> = {}) => parsePerson({
    fullName: 'Ramesh Patel',
    dateOfBirth: '2007-04-11',
    email: 'ramesh@example.com',
    phone: '+16175550123',
    whatsappOn: 'primary',
    ...over,
}, NOW);

const trip = (over: Record<string, unknown> = {}) => parseTrip({
    partySize: 1,
    largeBags: 2,
    cabinBags: 1,
    dropoffAddress: '360 Huntington Ave, Boston',
    dropoffLat: 42.3399,
    dropoffLng: -71.0881,
    ...over,
});

describe('the arrival time is local to the AIRPORT', () => {
    it('reads the same wall-clock time an hour apart at BOS and ORD', () => {
        const bos = flight({ airportCode: 'BOS' }).arrivalAt;
        const ord = flight({ airportCode: 'ORD' }).arrivalAt;

        expect(new Date(ord).getTime() - new Date(bos).getTime()).toBe(60 * 60 * 1000);
    });

    it('22:00 at BOS in September is 02:00 UTC the next day', () => {
        // Eastern Daylight Time, UTC-4. Getting this wrong by the DST offset is how
        // drop-off rides broke every Friday.
        expect(flight().arrivalAt).toBe('2026-09-21T02:00:00.000Z');
    });

    it('honours daylight saving rather than a fixed offset', () => {
        // Same wall clock, one in EDT and one in EST — five hours apart in UTC, not
        // four. A hardcoded -4 would put the January arrival an hour early.
        const summer = parseFlight(
            { arrivalDate: '2027-07-15', arrivalTime: '13:00', airportCode: 'BOS' }, ZONE, NOW);
        const winter = parseFlight(
            { arrivalDate: '2027-01-15', arrivalTime: '13:00', airportCode: 'BOS' }, ZONE, NOW);

        expect(summer.arrivalAt).toBe('2027-07-15T17:00:00.000Z');
        expect(winter.arrivalAt).toBe('2027-01-15T18:00:00.000Z');
    });

    it('keeps the strings the traveller typed, untouched, for display', () => {
        const parsed = flight();
        expect(parsed.arrivalDate).toBe('2026-09-20');
        expect(parsed.arrivalTime).toBe('22:00');
    });
});

describe('a date that would roll over silently', () => {
    it('refuses 30 February', () => {
        expect(() => flight({ arrivalDate: '2027-02-30' })).toThrow(/not a real date/i);
    });

    it('refuses a thirteenth month', () => {
        expect(() => flight({ arrivalDate: '2026-13-01' })).toThrow(/not a real date/i);
    });

    it('refuses a shape that is not YYYY-MM-DD at all', () => {
        expect(() => flight({ arrivalDate: '20 Sep 2026' })).toThrow(/YYYY-MM-DD/);
    });

    it('refuses an hour that does not exist', () => {
        expect(() => flight({ arrivalTime: '25:00' })).toThrow(/not a real time/i);
        expect(() => flight({ arrivalTime: '12:60' })).toThrow(/not a real time/i);
    });

    it('accepts 29 February in a leap year', () => {
        expect(flight({ arrivalDate: '2028-02-29' }).arrivalDate).toBe('2028-02-29');
    });
});

describe('when the flight is', () => {
    it('refuses an arrival that has already happened', () => {
        // A card for a plane that landed last week is noise on the board and a Sarthi
        // could claim it.
        expect(() => flight({ arrivalDate: '2026-08-01' })).toThrow(/already passed/i);
    });

    it('refuses a mistyped year decades out', () => {
        expect(() => flight({ arrivalDate: '2126-09-20' })).toThrow(/too far ahead/i);
    });
});

describe('the airport code', () => {
    it('uppercases and trims what was typed', () => {
        expect(flight({ airportCode: ' bos ' }).airportCode).toBe('BOS');
    });

    it('refuses anything that is not three letters', () => {
        expect(() => flight({ airportCode: 'BOSTON' })).toThrow(/three letters/i);
        expect(() => flight({ airportCode: 'B0S' })).toThrow(/three letters/i);
        expect(() => flight({ airportCode: '' })).toThrow(/three letters/i);
    });

    it('accepts a well-formed code the table has never heard of', () => {
        // The table is a zone lookup, not an allow-list.
        expect(flight({ airportCode: 'AMD' }).airportCode).toBe('AMD');
    });
});

describe('the trip details', () => {
    it('refuses the 0,0 placeholder that means "never geocoded"', () => {
        // Letting it through puts a card on the board that no Sarthi can navigate to.
        expect(() => trip({ dropoffLat: 0, dropoffLng: 0 })).toThrow(/no location yet/i);
    });

    it('refuses a missing coordinate rather than defaulting one', () => {
        expect(() => trip({ dropoffLat: undefined })).toThrow(/address suggestions/i);
    });

    it('refuses a coordinate that is not on Earth', () => {
        expect(() => trip({ dropoffLat: 91 })).toThrow(/not on Earth/i);
    });

    it('refuses a party of zero and a party of thirty', () => {
        expect(() => trip({ partySize: 0 })).toThrow(/between 1 and 8/i);
        expect(() => trip({ partySize: 30 })).toThrow(/between 1 and 8/i);
    });

    it('refuses half a suitcase', () => {
        expect(() => trip({ largeBags: 1.5 })).toThrow(/whole number/i);
    });

    it('allows no bags at all', () => {
        expect(trip({ largeBags: 0, cabinBags: 0 }).largeBags).toBe(0);
    });

    it('refuses an unrecognised direction instead of defaulting it', () => {
        // A silent default here would file a departure as an arrival.
        expect(() => trip({ direction: 'roundtrip' })).toThrow(/arrival or departure/i);
    });

    it('defaults to arrival when nothing is said, because that is the only UI today', () => {
        expect(trip().direction).toBe('arrival');
    });

    it('turns an empty optional into undefined rather than an empty string', () => {
        // So `compact` can drop it and the document has no blank fields to render.
        expect(trip({ notes: '   ' }).notes).toBeUndefined();
    });

    it('caps the notes', () => {
        expect(() => trip({ notes: 'x'.repeat(1001) })).toThrow(/under 1000/i);
    });
});

describe('the traveller', () => {
    it('refuses "WhatsApp is on my other number" with no other number', () => {
        // The dead-control guard. Without it the card renders a WhatsApp button that
        // opens with nobody in it.
        expect(() => person({ whatsappOn: 'alt' })).toThrow(/did not give one/i);
    });

    it('accepts the alternate number when one is actually given', () => {
        const parsed = person({ whatsappOn: 'alt', altPhone: '+919876543210' });
        expect(parsed.whatsappOn).toBe('alt');
        expect(parsed.altPhone).toBe('+919876543210');
    });

    it('refuses half a family contact, in either direction', () => {
        // A name with no number is a promise of reassurance the app cannot keep.
        expect(() => person({ familyContact: { name: 'Ba' } })).toThrow(/both a name and a phone/i);
        expect(() => person({ familyContact: { phone: '+91987' } })).toThrow(/both a name and a phone/i);
    });

    it('leaves familyContact null when none was given, rather than an empty object', () => {
        expect(person().familyContact).toBeNull();
    });

    it('keeps a complete family contact', () => {
        const parsed = person({
            familyContact: {
                name: 'Bhavna Patel', relationship: 'Mother',
                phone: '+919876543210', hasWhatsapp: true, preferredLanguage: 'Gujarati',
            },
        });
        expect(parsed.familyContact).toEqual({
            name: 'Bhavna Patel', relationship: 'Mother',
            phone: '+919876543210', hasWhatsapp: true, preferredLanguage: 'Gujarati',
        });
    });

    it('refuses a birth date in the future', () => {
        expect(() => person({ dateOfBirth: '2030-01-01' })).toThrow(/in the future/i);
    });

    it('refuses a birth year that is obviously a typo', () => {
        expect(() => person({ dateOfBirth: '1802-01-01' })).toThrow(/check the year/i);
    });

    it('refuses an unrecognised whatsappOn instead of falling back to none', () => {
        expect(() => person({ whatsappOn: 'telegram' })).toThrow(/primary, alt or none/i);
    });

    it('requires a name, an email and a phone', () => {
        expect(() => person({ fullName: ' ' })).toThrow(/full name is required/i);
        expect(() => person({ email: '' })).toThrow(/email address is required/i);
        expect(() => person({ phone: null })).toThrow(/phone number is required/i);
    });
});

describe('compact', () => {
    it('drops undefined and keeps null, false and zero', () => {
        // null is a real Firestore value and the app uses it to mean "cleared".
        // Dropping it would leave a stale claimedByName on a released trip.
        expect(compact({
            a: undefined, b: null, c: false, d: 0, e: '',
        })).toEqual({ b: null, c: false, d: 0, e: '' });
    });
});

describe('retention', () => {
    it('is computed from the trip, not from today, and is well past it', () => {
        const until = retainUntilFor('2026-09-21T02:00:00.000Z');
        expect(until.startsWith('2033-09-21')).toBe(true);
    });
});
