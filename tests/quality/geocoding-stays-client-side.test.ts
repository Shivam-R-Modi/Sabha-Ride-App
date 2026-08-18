/**
 * Geocoding must not drift back to the server.
 *
 * There was a `geocodeAddress` Cloud Function, and it returned 500 for every call
 * it ever received:
 *
 *     REQUEST_DENIED – API keys with referer restrictions cannot be used
 *                      with this API.
 *
 * `GOOGLE_MAPS_API_KEY` in `functions/.env` is HTTP-referer-restricted. Referer
 * restrictions are a BROWSER mechanism — a server sends no referer — so such a key
 * can never work server-to-server. Nobody noticed for months because the only
 * caller was a fallback for someone typing an address instead of picking a
 * suggestion, and its failure path correctly said "please select an address from
 * the suggestions".
 *
 * The fix was to stop needing a server key: the browser key already geocodes, and
 * that was verified against production. This test exists because the obvious
 * "fix" for the next person who wants server-side geocoding is to add a second,
 * unrestricted key — a credential to store, rotate and leak — and that decision
 * should be deliberate rather than accidental.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

describe('geocoding lives in the browser', () => {
    it('no Cloud Function calls the Geocoding web service', () => {
        // The endpoint a referer-restricted key cannot use.
        const offenders = walk(path.join(ROOT, 'functions/src'))
            .filter(f => /maps\.googleapis\.com\/maps\/api\/geocode/.test(readFileSync(f, 'utf8')))
            .map(f => path.relative(ROOT, f));

        expect(
            offenders,
            `A server-side geocode needs an unrestricted or IP-restricted key — a ` +
            `second credential. The browser key already works: see ` +
            `geocodeAddressInBrowser in hooks/useGooglePlaces.ts. If you genuinely ` +
            `need this server-side, add the key deliberately and update this test:\n` +
            `  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });

    it('no function READS a server Maps key any more', () => {
        // If nothing reads it, it can be dropped from functions/.env — and a
        // credential that is not stored cannot leak.
        //
        // Matches `process.env.` rather than the bare name, because the name is
        // written out in index.ts explaining why the function was deleted. Same
        // trap as naming a Tailwind class in a comment and having it re-emitted:
        // a substring search does not know prose from code.
        const readers = walk(path.join(ROOT, 'functions/src'))
            .filter(f => /process\.env\.GOOGLE_MAPS_API_KEY/.test(readFileSync(f, 'utf8')))
            .map(f => path.relative(ROOT, f));

        expect(readers, `Still reading a server Maps key:\n  ${readers.join('\n  ')}`).toEqual([]);
    });

    it('the client no longer wraps a geocode callable', () => {
        const src = readFileSync(path.join(ROOT, 'src/utils/cloudFunctions.ts'), 'utf8');
        expect(src).not.toMatch(/callFunction<[^>]*>\('geocodeAddress'/);
    });

    it('the browser geocoder is exported and used', () => {
        // Guards the other direction: a test that only forbids things would pass
        // just as happily if geocoding disappeared altogether.
        const hook = readFileSync(path.join(ROOT, 'hooks/useGooglePlaces.ts'), 'utf8');
        expect(hook).toMatch(/export async function geocodeAddressInBrowser/);
        expect(hook).toMatch(/new google\.maps\.Geocoder\(\)/);

        const callers = walk(path.join(ROOT, 'components'))
            .concat(walk(path.join(ROOT, 'hooks')))
            .filter(f => /geocodeAddressInBrowser/.test(readFileSync(f, 'utf8')));

        // ProfileEditor's typed-address fallback and the manager's admin edit.
        expect(callers.length).toBeGreaterThanOrEqual(2);
    });
});
