/**
 * The home screen icon.
 *
 * Reported from an iPhone: a white border around the app icon. Three things were
 * wrong with the source art, and only the first is the one people expect:
 *
 *   1. A **77px light surround baked into the pixels** — 12% of a 640px canvas.
 *      Not transparency being composited on white, which is the usual cause;
 *      these files had no alpha at all. The border was simply painted in.
 *   2. The artwork had **its own rounded corners** inside that surround. iOS
 *      applies its own corner mask, so even after cropping to the plate the two
 *      radii disagree and leak light pixels at the corners.
 *   3. `icon-512x512.png` was **actually 640x640**, so the manifest was
 *      declaring a size the file did not have.
 *
 * The fix composites the mark onto a flat field, so every icon now bleeds to its
 * own edge with a single colour on the border.
 *
 * These assertions read the PNG header directly rather than decoding the image,
 * because decoding would mean a new dependency for a check this cheap. That
 * covers (3) exactly, and covers (1) at the level that matters for iOS: an
 * icon with an alpha channel is one iOS can composite onto white.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const ICONS = path.join(ROOT, 'public/icons');

/** Width, height and colour type, straight out of the IHDR chunk. */
function pngHeader(file: string): { width: number; height: number; colourType: number } {
    const buf = readFileSync(path.join(ICONS, file));
    const signature = buf.subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') throw new Error(`${file} is not a PNG`);
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        colourType: buf.readUInt8(25),
    };
}

/** PNG colour types that carry an alpha channel. */
const WITH_ALPHA = new Set([4, 6]);

/** Every icon, and the size it is declared as. */
const DECLARED: Array<[file: string, size: number]> = [
    ['icon-180x180.png', 180],
    ['icon-192x192.png', 192],
    ['icon-512x512.png', 512],
    ['icon-maskable-512x512.png', 512],
];

describe('app icons', () => {
    for (const [file, size] of DECLARED) {
        it(`${file} exists and really is ${size}x${size}`, () => {
            // icon-512x512.png used to be 640x640 while the manifest said 512.
            expect(existsSync(path.join(ICONS, file)), `${file} is missing`).toBe(true);

            const { width, height } = pngHeader(file);
            expect({ width, height }).toEqual({ width: size, height: size });
        });

        it(`${file} is opaque, so iOS has no transparency to paint white`, () => {
            expect(WITH_ALPHA.has(pngHeader(file).colourType), `${file} carries an alpha channel`).toBe(false);
        });
    }

    it('the apple-touch-icon points at the 180 that iOS asks for', () => {
        const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const match = html.match(/rel="apple-touch-icon"[^>]*href="\/icons\/([^"]+)"/);

        expect(match, 'no apple-touch-icon link in index.html').not.toBeNull();
        expect(match![1]).toBe('icon-180x180.png');
    });

    it('the maskable icon is a separate file from the plain one', () => {
        // They cannot be the same image: a maskable icon may be cropped to a
        // circle, so its mark has to sit well inside the tile, while the plain
        // icon should bleed to the edge. One file cannot do both.
        const config = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
        const maskable = config.match(/src: '\/icons\/([^']+)',\s*\n\s*sizes: '512x512',\s*\n\s*type: 'image\/png',\s*\n\s*purpose: 'maskable'/);

        expect(maskable, 'no maskable icon declared').not.toBeNull();
        expect(maskable![1]).toBe('icon-maskable-512x512.png');
    });

    it('every icon the manifest names actually exists', () => {
        const config = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
        const named = [...config.matchAll(/src: '\/icons\/([^']+)'/g)].map(m => m[1]!);

        expect(named.length, 'the manifest parse found nothing — this test would pass vacuously')
            .toBeGreaterThanOrEqual(3);
        for (const file of named) {
            expect(existsSync(path.join(ICONS, file)), `manifest names a missing icon: ${file}`).toBe(true);
        }
    });
});
