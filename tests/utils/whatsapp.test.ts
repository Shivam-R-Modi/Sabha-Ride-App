/**
 * The WhatsApp deep link.
 *
 * ONE ASSERTION CARRIES THIS FILE: garbage in gives `null`, not a URL.
 *
 * `https://wa.me/?text=…` with no number is a valid URL. It opens WhatsApp on a blank
 * contact picker, the Sarthi assumes the family was told, and nobody was. A button
 * that looks like it worked and did nothing is this codebase's signature defect, and
 * the whole reason `waLink` exists instead of a template literal at the call site.
 * The card renders no button when this returns null.
 */

import { describe, it, expect } from 'vitest';
import { familyReassuranceMessage, waLink, waNumber } from '../../src/utils/whatsapp';

describe('there is nobody to send to', () => {
    for (const [label, value] of [
        ['an empty string', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['a name typed into the phone field', 'Bhavna Patel'],
        ['too few digits', '+91 987'],
        ['punctuation only', '+()- '],
    ] as Array<[string, string | null | undefined]>) {
        it(`returns null for ${label}`, () => {
            expect(waNumber(value), label).toBeNull();
            expect(waLink(value, 'Jai Swaminarayan'), label).toBeNull();
        });
    }
});

describe('a real number', () => {
    it('strips the plus, because wa.me rejects it', () => {
        expect(waNumber('+919876543210')).toBe('919876543210');
    });

    it('keeps the country code, so a link to India actually reaches India', () => {
        // The whole point of the feature is the family back home. Dropping the code
        // would silently send it to a US number.
        expect(waNumber('+919876543210')).toMatch(/^91/);
    });

    it('accepts a formatted US number the way the phone input writes it', () => {
        expect(waNumber('(617) 555-0123')).toBe('16175550123');
    });

    it('accepts an 11-digit US number with a leading 1', () => {
        expect(waNumber('16175550123')).toBe('16175550123');
    });

    it('builds a link with the message encoded', () => {
        // Apostrophes come through as-is and that is correct — encodeURIComponent
        // leaves them alone because they are legal in a query string. Spaces and
        // newlines are the ones that would break the link, and they are encoded.
        expect(waLink('+919876543210', "I've met Ramesh"))
            .toBe("https://wa.me/919876543210?text=I've%20met%20Ramesh");
    });

    it('encodes the characters that would actually break a URL', () => {
        const link = waLink('+919876543210', 'Ramesh & family — 100% safe\nComing now')!;
        expect(link).toContain('%26');    // &  would start a new query parameter
        expect(link).toContain('%25');    // %  would look like an escape sequence
        expect(link).toContain('%0A');    // newline
        expect(link).not.toMatch(/[ \n]/);
    });

    it('omits the text parameter rather than sending an empty one', () => {
        expect(waLink('+919876543210', '   ')).toBe('https://wa.me/919876543210');
    });
});

describe('the message the family gets', () => {
    const base = {
        sarthiName: 'Kiran',
        travellerName: 'Ramesh',
        airportLabel: 'BOS — Boston Logan',
    };

    it('says who, who they met, and that they are safe', () => {
        const message = familyReassuranceMessage(base);
        expect(message).toContain('Kiran');
        expect(message).toContain('Ramesh');
        expect(message).toContain('BOS');
        expect(message).toMatch(/safe/i);
    });

    it('mentions the destination when there is one, and does not invent one', () => {
        expect(familyReassuranceMessage({ ...base, destination: 'Boston' }))
            .toContain('on our way to Boston');
        expect(familyReassuranceMessage(base)).not.toMatch(/on our way to/);
    });

    it('names no weekday and no clock time', () => {
        // tests/quality/schedule-not-hardcoded.test.ts scans src/ for exactly this,
        // and the family needs to know their child was met, not a timetable.
        const message = familyReassuranceMessage({ ...base, destination: 'Boston' });
        expect(message).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i);
        expect(message).not.toMatch(/\d{1,2}[:.]\d{2}/);
    });

    it('is one paragraph, because some clients truncate at the first newline', () => {
        expect(familyReassuranceMessage({ ...base, destination: 'Boston' })).not.toContain('\n');
    });
});
