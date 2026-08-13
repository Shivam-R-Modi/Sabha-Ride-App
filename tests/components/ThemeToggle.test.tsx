/**
 * The day / night control.
 *
 * The failure mode worth guarding here is the one this codebase keeps having
 * to remove: a control that moves and does nothing. So every assertion checks
 * an EFFECT — the attribute on <html>, the value in storage, the meta colour —
 * rather than merely that the button changed appearance.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ThemeToggle } from '../../components/shared/ThemeToggle';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from '../../src/utils/theme';

const theme = () => document.documentElement.getAttribute(THEME_ATTRIBUTE);
const stored = () => window.localStorage.getItem(THEME_STORAGE_KEY);

/** jsdom has no matchMedia; the setup file stubs a light one. Override per test. */
const mockSystem = (prefersDark: boolean) => {
    window.matchMedia = ((query: string) => ({
        matches: prefersDark && query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
};

const renderToggle = () => render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.head.innerHTML = '<meta name="theme-color" content="#FAF9F6">';
    mockSystem(false);
});

describe('ThemeToggle — the control', () => {
    it('offers day, night and follow-the-device', () => {
        renderToggle();
        expect(screen.getByRole('radio', { name: /day/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /night/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /auto/i })).toBeInTheDocument();
    });

    it('is a radiogroup, so arrow keys work and the choice is announced', () => {
        renderToggle();
        expect(screen.getByRole('radiogroup', { name: /appearance/i })).toBeInTheDocument();
    });

    it('starts on day, which is the documented default', () => {
        renderToggle();
        expect(screen.getByRole('radio', { name: /day/i })).toBeChecked();
    });

    it('shows the stored choice on load rather than resetting it', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        renderToggle();
        expect(screen.getByRole('radio', { name: /night/i })).toBeChecked();
    });
});

describe('ThemeToggle — it actually does something', () => {
    it('darkens the document when night is chosen', async () => {
        const user = userEvent.setup();
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /night/i }));

        await waitFor(() => expect(theme()).toBe('dark'));
    });

    it('goes back to light', async () => {
        const user = userEvent.setup();
        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /day/i }));

        await waitFor(() => expect(theme()).toBe('light'));
    });

    it('remembers the choice for next launch', async () => {
        const user = userEvent.setup();
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /night/i }));

        expect(stored()).toBe('dark');
    });

    it('updates the browser chrome colour too', async () => {
        const user = userEvent.setup();
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /night/i }));

        await waitFor(() =>
            expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
                .toBe('#1A1612'));
    });
});

describe('ThemeToggle — follow the device', () => {
    it('goes dark when the device is dark', async () => {
        const user = userEvent.setup();
        mockSystem(true);
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /auto/i }));

        await waitFor(() => expect(theme()).toBe('dark'));
    });

    it('goes light when the device is light', async () => {
        const user = userEvent.setup();
        mockSystem(false);
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /auto/i }));

        await waitFor(() => expect(theme()).toBe('light'));
    });

    it('stores the preference as "system", not as what it resolved to', async () => {
        const user = userEvent.setup();
        mockSystem(true);
        renderToggle();

        await user.click(screen.getByRole('radio', { name: /auto/i }));

        // Storing 'dark' here would pin the app to dark and stop it following
        // the device at sunrise — the option would work once, then stop.
        expect(stored()).toBe('system');
    });

    it('stops following the device once an explicit choice is made', async () => {
        const user = userEvent.setup();
        // Already on Auto, on a dark device — so the app is currently dark.
        mockSystem(true);
        window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
        renderToggle();
        await waitFor(() => expect(theme()).toBe('dark'));

        await user.click(screen.getByRole('radio', { name: /day/i }));

        // Overrides the dark device rather than deferring to it.
        await waitFor(() => expect(theme()).toBe('light'));
        expect(stored()).toBe('light');
    });
});

describe('ThemeToggle — keyboard', () => {
    it('is reachable by tab, so the control is not mouse-only', async () => {
        const user = userEvent.setup();
        renderToggle();

        await user.tab();

        // sr-only, not display:none — a hidden input leaves the tab order and
        // the accessibility tree entirely.
        expect(screen.getByRole('radio', { name: /day/i })).toHaveFocus();
    });

    it('moves between choices with the arrow keys', async () => {
        const user = userEvent.setup();
        renderToggle();

        await user.tab();
        await user.keyboard('{ArrowRight}');

        await waitFor(() => expect(theme()).toBe('dark'));
    });
});
