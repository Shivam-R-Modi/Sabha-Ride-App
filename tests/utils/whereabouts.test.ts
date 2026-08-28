/**
 * Which service to offer first, from the device timezone.
 *
 * THE ASSERTIONS THAT MATTER are the ones about NOT guessing. This steers somebody's
 * whole app on sign-up, so a wrong confident answer costs more than an honest "cannot
 * tell" — and the obvious implementation, `zone.startsWith('America/')`, is wrong in
 * exactly the direction that hurts: it would tell somebody in Toronto or São Paulo that
 * they are in the USA and hide the airport service from the people it exists for.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { likelyInUsa, deviceTimeZone } from '../../src/utils/whereabouts';

describe('inside the USA', () => {
    it.each([
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Phoenix', 'America/Detroit', 'America/Boise',
    ])('%s', (zone) => {
        expect(likelyInUsa(zone)).toBe(true);
    });

    it.each([
        // A device in Indianapolis reports the SUB-ZONE, not America/New_York. Missing
        // these would send a whole state to the wrong service.
        'America/Indiana/Indianapolis', 'America/Kentucky/Louisville',
        'America/North_Dakota/Center',
    ])('%s — the sub-zone families', (zone) => {
        expect(likelyInUsa(zone)).toBe(true);
    });

    it.each(['America/Anchorage', 'America/Adak', 'Pacific/Honolulu'])(
        '%s — Alaska and Hawaii, which are not "America/" city zones', (zone) => {
            expect(likelyInUsa(zone)).toBe(true);
        });

    it.each(['America/Puerto_Rico', 'Pacific/Guam', 'Pacific/Pago_Pago', 'America/St_Thomas'])(
        '%s — the territories, whose residents are in the USA', (zone) => {
            expect(likelyInUsa(zone)).toBe(true);
        });
});

describe('outside the USA', () => {
    it.each(['Asia/Kolkata', 'Asia/Calcutta', 'Europe/London', 'Africa/Nairobi',
        'Australia/Sydney', 'Asia/Dubai'])('%s', (zone) => {
        expect(likelyInUsa(zone)).toBe(false);
    });

    /**
     * THE ONE THE PREFIX SHORTCUT GETS WRONG. `America/` is a continent, not a country.
     * Toronto and São Paulo starting with it is the reason US_ZONES is an explicit list
     * rather than four characters.
     */
    it.each(['America/Toronto', 'America/Vancouver', 'America/Mexico_City',
        'America/Sao_Paulo', 'America/Bogota', 'America/Halifax'])(
        '%s — in the Americas but NOT the USA', (zone) => {
            expect(likelyInUsa(zone)).toBe(false);
        });
});

describe('when there is no way to tell', () => {
    it.each([undefined, null, '', '   '])('%s is null, not a guess', (zone) => {
        expect(likelyInUsa(zone)).toBeNull();
    });

    it('treats a malformed value as unknown rather than as abroad', () => {
        // No slash, so not an IANA identifier at all. A broken value is not evidence of
        // a location, and the screen shows no claim when this is null.
        expect(likelyInUsa('UTC')).toBeNull();
        expect(likelyInUsa('GMT+5')).toBeNull();
        expect(likelyInUsa('nonsense')).toBeNull();
    });
});

describe('reading the zone off the device', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('returns what Intl reports', () => {
        expect(typeof deviceTimeZone()).toBe('string');
    });

    it('returns undefined rather than throwing when Intl is unusable', () => {
        // Locked-down webviews have been seen to throw here. A sign-up screen must not
        // fail to render over a nicety.
        vi.stubGlobal('Intl', {
            DateTimeFormat: () => ({ resolvedOptions: () => { throw new Error('nope'); } }),
        });
        expect(deviceTimeZone()).toBeUndefined();
    });

    it('returns undefined when Intl reports an empty zone', () => {
        vi.stubGlobal('Intl', {
            DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: '' }) }),
        });
        expect(deviceTimeZone()).toBeUndefined();
    });
});
