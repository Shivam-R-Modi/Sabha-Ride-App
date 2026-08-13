/**
 * Day / night theme resolution, and the two places its constants are
 * duplicated out of necessity.
 *
 * The duplication is deliberate and is explained where it happens: the
 * pre-paint script in index.html has to run before the module graph exists, so
 * it cannot import from src/utils/theme.ts. The tests at the bottom of this
 * file are what stop the copies drifting apart — without them, changing the
 * storage key in one place would silently give every user the default theme on
 * first paint and their real theme a moment later, which is the flash the
 * script exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    applyTheme,
    isThemePreference,
    readStoredPreference,
    resolveTheme,
    systemTheme,
    writeStoredPreference,
    DEFAULT_PREFERENCE,
    THEME_ATTRIBUTE,
    THEME_STORAGE_KEY,
} from '../../src/utils/theme';

const ROOT = path.resolve(__dirname, '../..');
const readRoot = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** A localStorage stand-in that throws, as it does in Lockdown Mode. */
const hostileStorage = {
    getItem: () => { throw new Error('The operation is insecure.'); },
    setItem: () => { throw new Error('The operation is insecure.'); },
};

const fakeWindow = (prefersDark: boolean) => ({
    matchMedia: (query: string) => ({ matches: prefersDark && query.includes('dark') }),
} as unknown as Pick<Window, 'matchMedia'>);

describe('isThemePreference', () => {
    it('accepts the three real choices', () => {
        expect(isThemePreference('light')).toBe(true);
        expect(isThemePreference('dark')).toBe(true);
        expect(isThemePreference('system')).toBe(true);
    });

    it('rejects anything else, including near misses', () => {
        for (const junk of ['Dark', 'auto', '', null, undefined, 0, {}]) {
            expect(isThemePreference(junk)).toBe(false);
        }
    });
});

describe('readStoredPreference', () => {
    it('returns what was stored', () => {
        const store = { getItem: () => 'dark' };
        expect(readStoredPreference(store)).toBe('dark');
    });

    it('falls back to the default when nothing is stored', () => {
        expect(readStoredPreference({ getItem: () => null })).toBe(DEFAULT_PREFERENCE);
    });

    it('ignores a corrupted value rather than applying it', () => {
        expect(readStoredPreference({ getItem: () => 'chartreuse' })).toBe(DEFAULT_PREFERENCE);
    });

    it('survives storage that throws', () => {
        // Sandboxed iframes and Safari Lockdown Mode throw on access. A theme
        // preference is not worth taking the app down for.
        expect(() => readStoredPreference(hostileStorage)).not.toThrow();
        expect(readStoredPreference(hostileStorage)).toBe(DEFAULT_PREFERENCE);
    });
});

describe('writeStoredPreference', () => {
    it('writes under the shared key', () => {
        const setItem = vi.fn();
        writeStoredPreference('dark', { setItem });
        expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    });

    it('survives storage that throws, so the switch still works this session', () => {
        expect(() => writeStoredPreference('dark', hostileStorage)).not.toThrow();
    });
});

describe('systemTheme', () => {
    it('reads the OS preference', () => {
        expect(systemTheme(fakeWindow(true))).toBe('dark');
        expect(systemTheme(fakeWindow(false))).toBe('light');
    });

    it('defaults to light where it cannot ask', () => {
        expect(systemTheme({} as Pick<Window, 'matchMedia'>)).toBe('light');
    });
});

describe('resolveTheme', () => {
    it('takes an explicit choice literally, whatever the OS says', () => {
        expect(resolveTheme('light', fakeWindow(true))).toBe('light');
        expect(resolveTheme('dark', fakeWindow(false))).toBe('dark');
    });

    it('defers to the OS only for "system"', () => {
        expect(resolveTheme('system', fakeWindow(true))).toBe('dark');
        expect(resolveTheme('system', fakeWindow(false))).toBe('light');
    });

    it('never returns "system" — callers get one of two real themes', () => {
        for (const pref of ['light', 'dark', 'system'] as const) {
            expect(['light', 'dark']).toContain(resolveTheme(pref, fakeWindow(true)));
        }
    });
});

describe('applyTheme', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute(THEME_ATTRIBUTE);
        document.head.innerHTML = '<meta name="theme-color" content="#FAF9F6">';
    });

    it('puts the theme where the stylesheet can see it', () => {
        applyTheme('dark');
        expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    });

    it('keeps the browser chrome colour in step', () => {
        // Without this the iOS status bar and the Android task switcher stay
        // cream while the app is dark, which reads as a rendering bug.
        applyTheme('dark');
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
            .toBe('#1C1815');

        applyTheme('light');
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
            .toBe('#FAF9F6');
    });

    it('does not throw when there is no theme-color meta to update', () => {
        document.head.innerHTML = '';
        expect(() => applyTheme('dark')).not.toThrow();
        expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    });
});

describe('the pre-paint script in index.html agrees with src/utils/theme.ts', () => {
    // It cannot import them — it runs before the module graph exists. These
    // assertions are the only thing keeping the two copies honest.
    const html = () => readRoot('index.html');

    it('uses the same storage key', () => {
        expect(html()).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    });

    it('sets the same attribute', () => {
        expect(html()).toContain(`setAttribute('${THEME_ATTRIBUTE}'`);
    });

    it('defaults to the same preference', () => {
        expect(html()).toContain(`: '${DEFAULT_PREFERENCE}';`);
    });

    it('uses the same two theme-colors applyTheme does', () => {
        expect(html()).toContain('#1C1815');
        expect(html()).toContain('#FAF9F6');
    });

    it('runs before the app bundle, or it is pointless', () => {
        const source = html();
        expect(source.indexOf('sabha-theme')).toBeLessThan(source.indexOf('src="/index.tsx"'));
    });
});

describe('index.html critical CSS agrees with theme.css', () => {
    // index.html paints the first frame from its own two-value copy of the
    // canvas colours, because theme.css only arrives with the JS bundle. If
    // these drift, a dark launch flashes the wrong colour.
    it('matches the light canvas', () => {
        expect(readRoot('index.html')).toContain('--canvas: 250 249 246');
        expect(readRoot('theme.css')).toContain('--canvas: 250 249 246');
    });

    it('matches the dark canvas', () => {
        expect(readRoot('index.html')).toContain('--canvas: 28 24 21');
        expect(readRoot('theme.css')).toContain('--canvas: 28 24 21');
    });
});

describe('accessibility regressions this phase was supposed to fix', () => {
    it('pinch-zoom is not disabled', () => {
        // WCAG 2.1 AA, 1.4.4 Resize Text. docs/compliance/privacy-and-data.md
        // holds this app to AA.
        const viewport = readRoot('index.html').match(/<meta name="viewport"[^>]*>/)?.[0] ?? '';
        expect(viewport).not.toContain('user-scalable=no');
        expect(viewport).not.toContain('maximum-scale=1');
    });
});
