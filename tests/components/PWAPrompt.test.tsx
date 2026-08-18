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
import { resetInstallState } from '../../src/utils/pwaInstall';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/122.0 Mobile/15E148 Safari/604.1';

const REAL_UA = window.navigator.userAgent;
const REAL_MATCH_MEDIA = window.matchMedia;

/** Pretend this tab is running on the given device. */
const onDevice = (userAgent: string) =>
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });

/** Pretend the app is already running from the home screen. */
const alreadyInstalled = () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('standalone') })) as any;
};

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
    // The captured prompt and the dismissal flag are module state, deliberately
    // — see src/utils/pwaInstall.ts. Without this reset these tests would pass
    // only in their current order.
    resetInstallState();
    onDevice(REAL_UA);
    window.matchMedia = REAL_MATCH_MEDIA;
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

describe('PWAPrompt — iOS, where the install event never arrives', () => {
    /**
     * The defect being guarded: this banner used to render `null` on every
     * iPhone, because it waited for `beforeinstallprompt` and WebKit does not
     * send it. No error, no fallback, nothing on screen — and every iOS browser
     * is WebKit, so "use Chrome instead" was not a workaround either.
     */

    it('shows the hand-written steps with no install event at all', () => {
        onDevice(IPHONE_SAFARI);
        renderPrompt();

        expect(screen.getByText('Add to Home Screen')).toBeInTheDocument();
        expect(screen.getByText(/Tap the Share icon in the bar at the bottom/i)).toBeInTheDocument();
        expect(screen.getByText(/Choose .Add to Home Screen., then Add/i)).toBeInTheDocument();
    });

    it('sends Chrome-for-iOS to the address bar, not the bottom bar', () => {
        onDevice(IPHONE_CHROME);
        renderPrompt();

        // Anchored on "Chrome's" — the banner's own subtitle also says
        // "address bar", so the loose match found two nodes.
        expect(screen.getByText(/Tap the Share icon in Chrome/i)).toBeInTheDocument();
        expect(screen.queryByText(/bar at the bottom/i)).toBeNull();
    });

    it('offers no Install button, because nothing here can install', () => {
        // A button wired to a handler that cannot work is the failure mode this
        // whole change exists to remove. Absence is the correct behaviour.
        onDevice(IPHONE_SAFARI);
        renderPrompt();

        expect(screen.queryByText('Install')).toBeNull();
    });

    it('stays away once dismissed, across a remount', () => {
        onDevice(IPHONE_SAFARI);
        const first = renderPrompt();
        act(() => { screen.getByLabelText('Dismiss').click(); });
        expect(banner()).toBeNull();

        first.unmount();
        renderPrompt();

        expect(banner()).toBeNull();
    });

    it('shows nothing when already running from the home screen', () => {
        // Nagging someone to install the app they are using it inside.
        onDevice(IPHONE_SAFARI);
        alreadyInstalled();
        renderPrompt();

        expect(banner()).toBeNull();
    });

    it('shows nothing on a desktop browser with no route to install', () => {
        // jsdom's own user-agent: not iOS, and no prompt event fired.
        renderPrompt();

        expect(banner()).toBeNull();
    });
});
