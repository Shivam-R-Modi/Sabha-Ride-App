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

/**
 * THE DESTINATION IS OPTIONAL, AND USED NOT TO BE.
 *
 * Three tests here replace three that asserted the opposite — that an address was
 * required and had to carry coordinates. That was wrong for the person Airport Seva
 * exists for: somebody filing from Ahmedabad a month before they fly frequently has
 * no US address yet, and refusing the request meant they could not ask at all.
 *
 * What survives is the rule that a COORDINATE PAIR is only ever stored when it is
 * real, because `updateAirportPickup` copies it onto the traveller's profile on
 * completion and `resolveHomeCoords` would hand 0,0 to a Sarthi as a pickup point.
 */
describe('the destination, which may not be known yet', () => {
    it('accepts a request with no address at all', () => {
        const parsed = trip({
            dropoffAddress: undefined, dropoffLat: undefined, dropoffLng: undefined,
        });
        // Absent, not '' and not 0 — so `compact` drops all three and the document has
        // no blank destination for a card to render as an empty row.
        expect(parsed.dropoffAddress).toBeUndefined();
        expect(parsed.dropoffLat).toBeUndefined();
        expect(parsed.dropoffLng).toBeUndefined();
    });

    it('treats whitespace as no address', () => {
        expect(trip({ dropoffAddress: '   ' }).dropoffAddress).toBeUndefined();
    });

    it('accepts free text with NO coordinates, and stores no coordinates', () => {
        // Somebody who knows the name of their dorm but could not make the
        // autocomplete offer it. A Sarthi can read it; nothing navigates from it.
        const parsed = trip({
            dropoffAddress: 'Northeastern, International Village',
            dropoffLat: undefined,
            dropoffLng: undefined,
        });
        expect(parsed.dropoffAddress).toBe('Northeastern, International Village');
        expect(parsed.dropoffLat).toBeUndefined();
    });

    it('still refuses to store the 0,0 placeholder as a location', () => {
        // The address is kept, the fake location is not. Seeding 0,0 onto a profile
        // would put a Sarthi in the Atlantic every Friday afterwards.
        const parsed = trip({ dropoffLat: 0, dropoffLng: 0 });
        expect(parsed.dropoffAddress).toBe('360 Huntington Ave, Boston');
        expect(parsed.dropoffLat).toBeUndefined();
        expect(parsed.dropoffLng).toBeUndefined();
    });

    it('drops a location whose address was left blank', () => {
        // A pair with nothing to label it is unreadable on a card, so it goes with it.
        const parsed = trip({ dropoffAddress: '', dropoffLat: 42.34, dropoffLng: -71.09 });
        expect(parsed.dropoffLat).toBeUndefined();
    });

    it('keeps a real pair when the address came from the suggestions', () => {
        const parsed = trip();
        expect(parsed.dropoffLat).toBe(42.3399);
        expect(parsed.dropoffLng).toBe(-71.0881);
    });

    it('still refuses a coordinate that is not on Earth', () => {
        // An out-of-range value is a typo worth reporting, not something to ignore —
        // the difference between "no location given" and "a wrong one given".
        expect(() => trip({ dropoffLat: 91 })).toThrow(/not on Earth/i);
    });

    it('caps the address length', () => {
        expect(() => trip({ dropoffAddress: 'x'.repeat(301) })).toThrow(/under 300/i);
    });
});

describe('the trip details', () => {

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

/**
 * PHONE NUMBERS ARE CHECKED BY DIGIT COUNT.
 *
 * The client checks the exact count for the country the person picked — 10 for the US
 * and India, 9 for Australia — because `phoneUtils.ts` knows which one they chose.
 * The server is handed a formatted string with no reliable country attached, so it
 * enforces the E.164 envelope instead: at least 8 digits, at most 15. Guessing a
 * country here in order to be stricter would refuse real numbers from anywhere nobody
 * has added to SUPPORTED_COUNTRIES yet.
 *
 * The numbers already in production are E.164 India numbers of 12 digits, and the
 * first case below is the one that keeps them valid.
 */
describe('the phone numbers', () => {
    it('accepts the E.164 shape already stored in production', () => {
        expect(person({ phone: '+919902040804' }).phone).toBe('+919902040804');
    });

    it('counts digits rather than matching a shape, so punctuation is free', () => {
        // The same number typed by three people. A regex over the whole string would
        // refuse two of them.
        for (const typed of ['+91 98765 43210', '(617) 555-0123', '+1-617-555-0123']) {
            expect(person({ phone: typed }).phone).toBe(typed);
        }
    });

    it('does NOT rewrite what was given', () => {
        // Normalising server-side would mean guessing a country code for a number
        // typed without one, turning a reachable local number into an unreachable
        // foreign one. The stored string is what a Sarthi taps to call.
        expect(person({ phone: '(617) 555-0123' }).phone).toBe('(617) 555-0123');
    });

    it('refuses a number too short to dial', () => {
        expect(() => person({ phone: '12345' })).toThrow(/between 8 and 15 digits/i);
    });

    it('refuses a number longer than E.164 allows', () => {
        expect(() => person({ phone: '+1234567890123456' })).toThrow(/between 8 and 15 digits/i);
    });

    it('refuses a number that is all punctuation', () => {
        // Zero digits. Reported as a digit problem, not silently accepted as text.
        expect(() => person({ phone: '+++ --- ()' })).toThrow(/between 8 and 15 digits/i);
    });

    it('still refuses a missing primary number, before counting anything', () => {
        expect(() => person({ phone: '' })).toThrow(/required/i);
    });

    it('checks the other number too, when one is given', () => {
        expect(() => person({ altPhone: '123' })).toThrow(/between 8 and 15 digits/i);
    });

    it('leaves a blank other number alone rather than failing it as zero digits', () => {
        expect(person({ altPhone: '  ' }).altPhone).toBeUndefined();
    });

    it('checks the family contact number', () => {
        expect(() => person({
            familyContact: { name: 'Rajesh', phone: '99', hasWhatsapp: true },
        })).toThrow(/between 8 and 15 digits/i);
    });

    it('names the family number in its own message, so it is clear which field', () => {
        expect(() => person({
            familyContact: { name: 'Rajesh', phone: '99', hasWhatsapp: true },
        })).toThrow(/family contact/i);
    });

    it('accepts no family contact at all without a phone complaint', () => {
        expect(person().familyContact).toBeNull();
    });
});

describe('the fields that were removed', () => {
    it('does not store a referrer, even when one is sent', () => {
        // "Somebody here who knows you" was dropped at the owner's request. Nothing
        // read it but the CSV export, and that column went with it.
        expect(person({ referredByName: 'Vidhyut' })).not.toHaveProperty('referredByName');
    });

    it('does not store a special-needs note, even when one is sent', () => {
        // "Anything we should know" was the second of two free-text catch-alls on the
        // same form; `notes` still covers an infant or a wheelchair.
        expect(trip({ specialNeeds: 'wheelchair' })).not.toHaveProperty('specialNeeds');
    });

    it('still keeps the notes field, which is what now carries that', () => {
        expect(trip({ notes: 'travelling with an infant' }).notes)
            .toBe('travelling with an infant');
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
