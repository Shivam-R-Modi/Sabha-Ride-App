/**
 * The install matrix — because the bug this replaces was invisible.
 *
 * `components/PWAPrompt.tsx` offered installation only in response to
 * `beforeinstallprompt`. WebKit never fires it, and WebKit is the only engine
 * allowed on iOS, so the banner rendered `null` on every iPhone and iPad, for
 * every user, permanently. Nothing failed; nothing appeared.
 *
 * So the checks that matter here are the ones with a NEGATIVE expectation:
 * 'manual' for iOS (there IS something to say), and 'none' for a real Mac
 * (there is not, and inventing a home screen for it would be the same class of
 * defect pointing the other way).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    INSTALL_DISMISSED_KEY,
    hasInstallPrompt,
    installAvailability,
    installSteps,
    isIosLike,
    isStandalone,
    readInstallDismissed,
    resetInstallState,
    runInstallPrompt,
    subscribeToInstallState,
    watchInstallPrompt,
    wasInstalledThisSession,
    writeInstallDismissed,
} from '../../src/utils/pwaInstall';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/122.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36';

/** A window with nothing installed, running the given browser. */
const win = (userAgent: string, maxTouchPoints = 0, standalone?: boolean) => ({
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent, maxTouchPoints, standalone },
});

/** Captures listeners so a test can fire the events itself. */
const fakeWindow = () => {
    const handlers: Record<string, ((event: any) => void)[]> = {};
    return {
        addEventListener(type: string, listener: (event: any) => void) {
            (handlers[type] ??= []).push(listener);
        },
        fire(type: string, event: any = {}) {
            for (const listener of handlers[type] ?? []) listener(event);
        },
        count: (type: string) => (handlers[type] ?? []).length,
    };
};

const chromePromptEvent = (outcome: 'accepted' | 'dismissed' = 'accepted') => ({
    preventDefault: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
});

beforeEach(() => {
    resetInstallState();
    window.localStorage.clear();
});

describe('isStandalone', () => {
    it('believes the display-mode query', () => {
        expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
    });

    it('believes iOS’s own flag, which older Safari sets instead', () => {
        expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true);
    });

    it('is false in a browser tab', () => {
        expect(isStandalone(win(IPHONE))).toBe(false);
    });

    it('treats an unanswerable query as "not installed" rather than throwing', () => {
        expect(isStandalone({ matchMedia: () => { throw new Error('SecurityError'); } })).toBe(false);
    });
});

describe('isIosLike', () => {
    it('recognises an iPhone', () => {
        expect(isIosLike(IPHONE)).toBe(true);
    });

    it('recognises an iPad pretending to be a Mac, by its touch points', () => {
        // iPadOS 13+ sends a desktop UA. Without the touch check it would be
        // told there is no way to install, which is wrong.
        expect(isIosLike(IPAD_AS_MAC, 5)).toBe(true);
    });

    it('does NOT mistake a real Mac for one', () => {
        // The consequence of getting this wrong is a laptop being told to look
        // for a Share icon it does not have.
        expect(isIosLike(MAC, 0)).toBe(false);
    });

    it('is false for Android, which gets the real prompt instead', () => {
        expect(isIosLike(ANDROID)).toBe(false);
    });
});

describe('installAvailability', () => {
    it('offers the manual steps on iOS, where no event ever arrives', () => {
        // The whole point: hasPrompt is false forever on this platform.
        expect(installAvailability(win(IPHONE), false)).toBe('manual');
    });

    it('offers the manual steps to an iPad sending a Mac user-agent', () => {
        expect(installAvailability(win(IPAD_AS_MAC, 5), false)).toBe('manual');
    });

    it('offers a one-tap prompt when the browser handed one over', () => {
        expect(installAvailability(win(ANDROID), true)).toBe('prompt');
    });

    it('offers nothing at all on a browser with neither route', () => {
        // Desktop Chrome before the criteria are met, desktop Firefox, a real
        // Mac. Rendering an Install control here is the dead-button defect.
        expect(installAvailability(win(MAC), false)).toBe('none');
    });

    it('says "installed" once running from the home screen, prompt or not', () => {
        const installed = { matchMedia: () => ({ matches: true }), navigator: { userAgent: IPHONE } };
        expect(installAvailability(installed, false)).toBe('installed');
        expect(installAvailability(installed, true)).toBe('installed');
    });

    it('prefers a real prompt over written instructions', () => {
        // Ordering assertion: a tap beats a paragraph if both are somehow live.
        expect(installAvailability(win(IPHONE), true)).toBe('prompt');
    });
});

describe('installSteps', () => {
    it('sends Safari users to the bottom toolbar', () => {
        expect(installSteps(IPHONE)[0]).toMatch(/bottom/i);
    });

    it('sends Chrome-for-iOS users to the address bar instead', () => {
        // Same engine, different chrome. Naming the wrong end of the screen is
        // how a two-step instruction gets abandoned.
        expect(installSteps(IPHONE_CHROME)[0]).toMatch(/address bar/i);
        expect(installSteps(IPHONE_CHROME)[0]).not.toMatch(/bottom/i);
    });

    it('always ends at Add to Home Screen', () => {
        for (const ua of [IPHONE, IPHONE_CHROME]) {
            const steps = installSteps(ua);
            expect(steps).toHaveLength(2);
            expect(steps[1]).toMatch(/Add to Home Screen/i);
        }
    });
});

describe('remembered dismissal', () => {
    it('round-trips', () => {
        expect(readInstallDismissed()).toBe(false);
        writeInstallDismissed(true);
        expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('true');
        expect(readInstallDismissed()).toBe(true);
    });

    it('clears, so the Profile entry can bring the banner back', () => {
        writeInstallDismissed(true);
        writeInstallDismissed(false);
        expect(readInstallDismissed()).toBe(false);
    });

    it('never throws when storage is forbidden', () => {
        // Lockdown Mode and sandboxed iframes. A banner preference must not be
        // able to take the app down.
        const hostile = {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('SecurityError'); },
            removeItem: () => { throw new Error('SecurityError'); },
        };
        expect(() => writeInstallDismissed(true, hostile)).not.toThrow();
        expect(readInstallDismissed(hostile)).toBe(false);
    });
});

describe('capturing the browser’s prompt', () => {
    it('keeps the event and suppresses Chrome’s own infobar', () => {
        const w = fakeWindow();
        watchInstallPrompt(w);
        const event = chromePromptEvent();

        w.fire('beforeinstallprompt', event);

        expect(hasInstallPrompt()).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('notifies subscribers, so a component mounted earlier re-renders', () => {
        const w = fakeWindow();
        watchInstallPrompt(w);
        const seen = vi.fn();
        subscribeToInstallState(seen);

        w.fire('beforeinstallprompt', chromePromptEvent());

        expect(seen).toHaveBeenCalled();
    });

    it('registers once however many callers ask', () => {
        // index.tsx calls it early and the hook calls it on mount. Two
        // listeners would both stash the event and double-notify.
        const w = fakeWindow();
        watchInstallPrompt(w);
        watchInstallPrompt(w);

        expect(w.count('beforeinstallprompt')).toBe(1);
    });

    it('reports the outcome and spends the event', async () => {
        const w = fakeWindow();
        watchInstallPrompt(w);
        w.fire('beforeinstallprompt', chromePromptEvent('accepted'));

        await expect(runInstallPrompt()).resolves.toBe('accepted');

        // Chrome rejects a second prompt() on the same event, so the button has
        // to disappear rather than silently do nothing on a second press.
        expect(hasInstallPrompt()).toBe(false);
        await expect(runInstallPrompt()).resolves.toBe('unavailable');
    });

    it('says so when there is nothing to replay', async () => {
        await expect(runInstallPrompt()).resolves.toBe('unavailable');
    });

    it('survives a prompt the browser refuses', async () => {
        const w = fakeWindow();
        watchInstallPrompt(w);
        w.fire('beforeinstallprompt', {
            preventDefault: vi.fn(),
            prompt: vi.fn().mockRejectedValue(new Error('not allowed')),
            userChoice: Promise.resolve({ outcome: 'accepted' }),
        });

        await expect(runInstallPrompt()).resolves.toBe('unavailable');
    });

    it('stops offering once the install completes', () => {
        // The installing tab does not itself become standalone, so without this
        // the banner would keep offering what was just done.
        const w = fakeWindow();
        watchInstallPrompt(w);
        w.fire('beforeinstallprompt', chromePromptEvent());

        w.fire('appinstalled');

        expect(wasInstalledThisSession()).toBe(true);
        expect(hasInstallPrompt()).toBe(false);
    });
});
