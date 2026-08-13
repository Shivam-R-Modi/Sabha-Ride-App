import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    applyTheme,
    readStoredPreference,
    resolveTheme,
    writeStoredPreference,
    type ResolvedTheme,
    type ThemePreference,
} from '../src/utils/theme';

interface ThemeContextValue {
    /** What the user chose: 'light', 'dark' or 'system'. */
    preference: ThemePreference;
    /** What that actually resolves to right now. Never 'system'. */
    theme: ResolvedTheme;
    setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Seeded from storage rather than from a constant, so the value React
    // renders with matches what index.html already painted. Seeding with
    // 'light' and correcting in an effect would flash.
    const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
    const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(readStoredPreference()));

    // Follow the OS, but only while the user has actually asked us to.
    useEffect(() => {
        if (preference !== 'system') return;
        const query = window.matchMedia?.('(prefers-color-scheme: dark)');
        if (!query) return;

        const sync = () => setTheme(resolveTheme('system'));
        sync();

        // Safari below 14 has no addEventListener on MediaQueryList. Falling
        // back keeps the follow-the-OS option working there instead of it
        // silently never firing — a dead control with no visible symptom.
        if (query.addEventListener) {
            query.addEventListener('change', sync);
            return () => query.removeEventListener('change', sync);
        }
        query.addListener(sync);
        return () => query.removeListener(sync);
    }, [preference]);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    const setPreference = useCallback((next: ThemePreference) => {
        setPreferenceState(next);
        setTheme(resolveTheme(next));
        writeStoredPreference(next);
    }, []);

    const value = useMemo(
        () => ({ preference, theme, setPreference }),
        [preference, theme, setPreference],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        // Loud rather than quiet. A silent default here would render a theme
        // switch that moves and does nothing — the exact failure this codebase
        // keeps having to remove.
        throw new Error('useTheme must be used inside a <ThemeProvider>');
    }
    return context;
}
