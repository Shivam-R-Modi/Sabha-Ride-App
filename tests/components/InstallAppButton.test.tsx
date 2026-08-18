/**
 * The permanent way back to installing.
 *
 * The banner asks once and then stays quiet, which leaves no route back — and
 * on iOS there is no browser-provided prompt to fall back on, so "ask once"
 * would otherwise mean "ask once, ever". This entry sits in Profile, the one
 * destination all three roles share.
 *
 * Two things are asserted hardest:
 *
 *   - it renders NOTHING where installing is impossible. A permanent
 *     "Install app" row on a browser that cannot install is a dead control,
 *     which is the defect class this repo keeps deleting.
 *   - pressing it actually brings the dismissed banner back. It did not, in the
 *     first draft: `dismissed` was component state, so the entry wrote the
 *     storage key and the banner — a separate hook caller — never re-read it.
 *     Wired up, silently inert.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InstallAppButton } from '../../components/shared/InstallAppButton';
import { PWAPrompt } from '../../components/PWAPrompt';
import { NavigationProvider } from '../../contexts/NavigationContext';
import { resetInstallState } from '../../src/utils/pwaInstall';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';

const REAL_UA = window.navigator.userAgent;
const REAL_MATCH_MEDIA = window.matchMedia;

const onDevice = (userAgent: string) =>
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });

const alreadyInstalled = () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('standalone') })) as any;
};

/** Hands over a replayable prompt, the way Chrome does. */
const offerInstall = (prompt = vi.fn().mockResolvedValue(undefined)) => {
    act(() => {
        const event: any = new Event('beforeinstallprompt');
        event.prompt = prompt;
        event.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(event);
    });
    return prompt;
};

const banner = () => document.querySelector('.fixed.bottom-safe-nav') as HTMLElement | null;

beforeEach(() => {
    window.localStorage.clear();
    resetInstallState();
    onDevice(REAL_UA);
    window.matchMedia = REAL_MATCH_MEDIA;
});

describe('InstallAppButton — never a control that cannot work', () => {
    it('renders nothing on a browser with no route to install', () => {
        // jsdom's user-agent: not iOS, and no prompt was offered.
        const { container } = render(<InstallAppButton />);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the app is already installed', () => {
        onDevice(IPHONE);
        alreadyInstalled();

        const { container } = render(<InstallAppButton />);

        expect(container).toBeEmptyDOMElement();
    });

    it('offers the steps on an iPhone, where no event ever arrives', () => {
        onDevice(IPHONE);

        render(<InstallAppButton />);

        expect(screen.getByRole('button', { name: /Add to Home Screen/i })).toBeInTheDocument();
    });

    it('offers a one-tap install where the browser handed a prompt over', () => {
        render(<InstallAppButton />);
        const prompt = offerInstall();

        const entry = screen.getByRole('button', { name: /Install app/i });
        act(() => { entry.click(); });

        expect(prompt).toHaveBeenCalled();
    });

    it('disappears once the prompt is spent, rather than failing on a second press', () => {
        // Chrome rejects a second prompt() on the same event.
        render(<InstallAppButton />);
        offerInstall();

        act(() => { screen.getByRole('button', { name: /Install app/i }).click(); });

        expect(screen.queryByRole('button', { name: /Install app/i })).toBeNull();
    });

    it('hides its label when the sidebar is collapsed, keeping a hover title', () => {
        onDevice(IPHONE);

        render(<InstallAppButton variant="sidebar" collapsed />);

        const entry = screen.getByRole('button');
        expect(entry).toHaveAttribute('title', 'Add to Home Screen');
        expect(entry.textContent).toBe('');
    });
});

describe('InstallAppButton — bringing the banner back', () => {
    const renderBoth = () => render(
        <NavigationProvider>
            <InstallAppButton />
            <PWAPrompt />
        </NavigationProvider>
    );

    it('re-opens a banner the user dismissed', () => {
        onDevice(IPHONE);
        renderBoth();

        act(() => { screen.getByLabelText('Dismiss').click(); });
        expect(banner()).toBeNull();

        act(() => { screen.getByRole('button', { name: /Add to Home Screen/i }).click(); });

        // The assertion the first draft failed: two separate `usePwaInstall`
        // callers have to agree about the dismissal.
        expect(banner()).not.toBeNull();
    });

    it('clears the remembered dismissal, so it survives a remount', () => {
        onDevice(IPHONE);
        const view = renderBoth();

        act(() => { screen.getByLabelText('Dismiss').click(); });
        act(() => { screen.getByRole('button', { name: /Add to Home Screen/i }).click(); });
        view.unmount();
        renderBoth();

        expect(banner()).not.toBeNull();
    });
});
