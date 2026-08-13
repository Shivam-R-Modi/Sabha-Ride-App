/**
 * Day / night theme resolution.
 *
 * Kept as pure functions with the DOM passed in, so the rules can be tested
 * without rendering anything — and so `index.html`'s pre-paint script and the
 * React context cannot drift apart, because both apply the same constants.
 *
 * Three choices, not two. The brief asked for a manual switch and manual is the
 * default position, but a phone that flips to dark at sunset otherwise spends
 * every evening fighting an app that has been pinned to light. 'system' is the
 * escape hatch; it is not the default.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Where the choice is remembered. Read by index.html before React exists. */
export const THEME_STORAGE_KEY = 'sabha-theme';

/** The attribute theme.css keys off. */
export const THEME_ATTRIBUTE = 'data-theme';

export const DEFAULT_PREFERENCE: ThemePreference = 'light';

/** Browser chrome colour, so the notch and status bar match the app. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
    light: '#FAF9F6',
    dark: '#1A1612',
};

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The stored choice, or the default.
 *
 * Never throws. localStorage access is a SecurityError in a sandboxed iframe and
 * in Safari's Lockdown Mode, and a theme preference is not worth taking the app
 * down for — an unreadable preference is just an absent one.
 */
export function readStoredPreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
    try {
        const store = storage ?? globalThis.localStorage;
        const raw = store?.getItem(THEME_STORAGE_KEY);
        return isThemePreference(raw) ? raw : DEFAULT_PREFERENCE;
    } catch {
        return DEFAULT_PREFERENCE;
    }
}

export function writeStoredPreference(
    preference: ThemePreference,
    storage?: Pick<Storage, 'setItem'>,
): void {
    try {
        const store = storage ?? globalThis.localStorage;
        store?.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // Same reasoning as the read: the switch must still work for this
        // session even when it cannot be remembered for the next one.
    }
}

/** What the OS is asking for. Defaults to light where it cannot be asked. */
export function systemTheme(win?: Pick<Window, 'matchMedia'>): ResolvedTheme {
    const target = win ?? (typeof window === 'undefined' ? undefined : window);
    try {
        return target?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    } catch {
        return 'light';
    }
}

/** A preference plus the OS state becomes exactly one of two themes. */
export function resolveTheme(
    preference: ThemePreference,
    win?: Pick<Window, 'matchMedia'>,
): ResolvedTheme {
    return preference === 'system' ? systemTheme(win) : preference;
}

/**
 * Put the resolved theme on the document.
 *
 * Sets the attribute theme.css keys off, and keeps `<meta name="theme-color">`
 * in step — without that second part the iOS status bar and the Android task
 * switcher stay cream while the app is dark, which looks like a rendering bug.
 */
export function applyTheme(theme: ResolvedTheme, doc?: Document): void {
    const target = doc ?? (typeof document === 'undefined' ? undefined : document);
    if (!target) return;

    target.documentElement.setAttribute(THEME_ATTRIBUTE, theme);

    const meta = target.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}
