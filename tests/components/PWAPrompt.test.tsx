/**
 * The install banner must clear the sidebar, not slide under it.
 *
 * PWAPrompt is `fixed` and is rendered in App.tsx OUTSIDE ResponsiveLayout, so
 * it inherits none of the layout's `lg:pl-20` / `lg:pl-60` sidebar padding. With
 * a plain `left-4` it sat at the viewport edge while the sidebar — also fixed,
 * and on a higher stacking rung — drew over its first 240px. The heading and the
 * start of the description were simply invisible.
 *
 * The offsets are the sidebar's own widths plus the 1rem gutter:
 *
 *     collapsed  w-20 (5rem)  + 1rem = left-24 (6rem)
 *     expanded   w-60 (15rem) + 1rem = left-64 (16rem)
 *
 * These assert the class rather than a measured box, because jsdom has no
 * layout. The arithmetic above is what makes the class correct, so a test that
 * checks the geometry is asserted here in the comment and verified in a browser.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PWAPrompt } from '../../components/PWAPrompt';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';

/** Fires the event the browser uses to offer installation. */
const offerInstall = () => act(() => {
    const e: any = new Event('beforeinstallprompt');
    e.prompt = vi.fn();
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
});

/** Lets a test drive sidebar / focus state from inside the provider. */
const Controls: React.FC = () => {
    const { toggleSidebar, setFocusMode } = useNavigation();
    return (
        <>
            <button onClick={toggleSidebar}>toggle-sidebar</button>
            <button onClick={() => setFocusMode(true)}>enter-focus</button>
        </>
    );
};

const banner = () => document.querySelector('.fixed.bottom-safe-nav') as HTMLElement | null;

const renderPrompt = () => render(
    <NavigationProvider>
        <Controls />
        <PWAPrompt />
    </NavigationProvider>
);

beforeEach(() => {
    window.localStorage.clear();
});

describe('PWAPrompt — clearing the sidebar', () => {
    it('shows nothing until the browser offers an install', () => {
        renderPrompt();
        expect(banner()).toBeNull();
    });

    it('appears once the browser offers one', () => {
        renderPrompt();
        offerInstall();
        expect(screen.getByText('Install App')).toBeInTheDocument();
    });

    it('clears the expanded sidebar on desktop', () => {
        // 15rem sidebar + 1rem gutter.
        renderPrompt();
        offerInstall();

        expect(banner()!.className).toMatch(/\blg:left-64\b/);
    });

    it('clears the collapsed sidebar on desktop', () => {
        renderPrompt();
        offerInstall();

        act(() => { screen.getByText('toggle-sidebar').click(); });

        // 5rem sidebar + 1rem gutter.
        expect(banner()!.className).toMatch(/\blg:left-24\b/);
        expect(banner()!.className).not.toMatch(/\blg:left-64\b/);
    });

    it('keeps the plain gutter on mobile, where there is no sidebar', () => {
        // The sidebar is `hidden lg:flex`, so below lg the banner should span the
        // full width. The unprefixed left-4 must survive alongside the lg: one.
        renderPrompt();
        offerInstall();

        expect(banner()!.className).toMatch(/(^|\s)left-4(\s|$)/);
    });

    it('spans full width again in focus mode, where the sidebar is hidden', () => {
        // A run screen owns the viewport at every width, so offsetting for a
        // sidebar that is not rendered would leave a 240px gap.
        renderPrompt();
        offerInstall();

        act(() => { screen.getByText('enter-focus').click(); });

        expect(banner()!.className).not.toMatch(/\blg:left-24\b/);
        expect(banner()!.className).not.toMatch(/\blg:left-64\b/);
        expect(banner()!.className).toMatch(/(^|\s)left-4(\s|$)/);
    });

    it('still pins to the right edge', () => {
        renderPrompt();
        offerInstall();

        expect(banner()!.className).toMatch(/\bright-4\b/);
    });
});
