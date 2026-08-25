/**
 * A pre-filled WhatsApp message, or nothing at all.
 *
 * WHY A DEEP LINK AND NOT A SERVER-SENT MESSAGE. The family waiting in India needs
 * one thing: word that somebody met the plane. A `wa.me` link the Sarthi taps costs
 * no infrastructure, no provider account and no per-message fee, works to every
 * country `phoneUtils` knows, and puts the message in the Sarthi's own WhatsApp so
 * the family can reply to a person. The alternative is a paid WhatsApp Business or
 * SMS provider, and `docs/STATUS.md` records that this app's push has only ever
 * delivered once, to one phone, on request.
 *
 * `waLink` RETURNS NULL RATHER THAN A BROKEN URL, and callers must render nothing
 * when it does. `https://wa.me/?text=…` with no number opens WhatsApp on a blank
 * contact picker — a button that looks like it worked and told nobody anything. That
 * is this codebase's signature defect, and it is the reason this file exists instead
 * of a template literal at the call site.
 */

import { parsePhoneNumber, validatePhoneNumber } from './phoneUtils';

/**
 * Digits with NO leading `+`, which is what wa.me wants — `wa.me/+91…` is rejected.
 *
 * Routed through the same `parsePhoneNumber`/`validatePhoneNumber` pair the phone
 * input uses, so a number that the form accepted is a number this accepts, and one it
 * refused produces no button rather than a broken link. Returns null for anything
 * that is not a phone number in a country the app knows: empty, a name someone typed
 * into the wrong field, or too few digits.
 */
export function waNumber(phone: string | null | undefined): string | null {
    if (!phone) return null;

    const { country, localDigits } = parsePhoneNumber(String(phone));
    const { isValid, e164 } = validatePhoneNumber(localDigits, country);
    if (!isValid || !e164) return null;

    return e164.replace(/\D/g, '') || null;
}

/**
 * A wa.me URL with the message pre-filled, or null when there is nobody to send to.
 *
 * The message is `encodeURIComponent`-encoded, which matters for the apostrophes and
 * newlines a real sentence contains.
 */
export function waLink(phone: string | null | undefined, message: string): string | null {
    const number = waNumber(phone);
    if (!number) return null;

    const text = message.trim();
    return text
        ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
        : `https://wa.me/${number}`;
}

/**
 * What the Sarthi sends the family once they have the traveller.
 *
 * NO WEEKDAY AND NO CLOCK TIME. `tests/quality/schedule-not-hardcoded.test.ts` scans
 * `src/` for weekday names in user-visible strings, and it is right to: the one thing
 * the family needs is that their child was met, not a timetable.
 *
 * Written as one paragraph rather than several lines because WhatsApp's own preview
 * truncates at the first newline on some clients, and the reassurance is the first
 * sentence.
 */
export function familyReassuranceMessage(input: {
    sarthiName: string;
    travellerName: string;
    airportLabel: string;
    destination?: string;
}): string {
    const { sarthiName, travellerName, airportLabel, destination } = input;
    // `Bhulka Gaadi`, not the old name — tests/quality/vocabulary.test.ts scans
    // src/ for it, and this string is read by a family in another country who has
    // never heard of either. The app name plus 'Sarthi' is what identifies the
    // sender as somebody from the congregation rather than a stranger.
    const heading = `Jai Swaminarayan. I am ${sarthiName}, a Sarthi with Bhulka Gaadi.`;
    const met = `I have met ${travellerName} at ${airportLabel} and they are safe with me.`;
    const going = destination ? ` We are on our way to ${destination}.` : '';

    return `${heading} ${met}${going}`;
}
