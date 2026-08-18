/**
 * "Add to Home Screen", for two browsers that disagree about whose job it is.
 *
 * Chrome fires `beforeinstallprompt` and hands over an event you may replay
 * later, so installing is one tap. Safari fires nothing at all and expects the
 * user to find Share -> Add to Home Screen unaided. WebKit is the only engine
 * on iOS, so Chrome for iPhone behaves like Safari here, not like Chrome.
 *
 * That is why `components/PWAPrompt.tsx` showed nothing whatsoever on an
 * iPhone: it listened for an event that platform never sends. The button was
 * wired to a handler that could not run.
 *
 * Two decisions live here so the banner and the Profile entry cannot disagree
 * about whether installing is possible:
 *
 *   - `installAvailability` is the single verdict. It returns 'none' rather
 *     than guessing, and callers render nothing for 'none' — a visible
 *     "Install" that cannot install is the failure mode this repo keeps
 *     deleting.
 *   - the prompt event is captured at MODULE scope, not in a hook. Chrome fires
 *     it once and early, often before React has mounted, and there is no way to
 *     ask for it again. A listener added on mount can miss it outright.
 *
 * The predicates take the window and user-agent as arguments so the matrix is
 * testable without a browser, exactly as `theme.ts` does.
 */

/** What, if anything, we can offer this browser. */
export type InstallAvailability =
    /** Already running from the home screen. Never nag. */
    | 'installed'
    /** Chrome handed us a prompt to replay: one tap. */
    | 'prompt'
    /** iOS. Possible, but only the user can do it, so show the steps. */
    | 'manual'
    /** No supported route. Show no control at all. */
    | 'none';

/** The non-standard event Chrome fires. Typed here; no lib.dom definition exists. */
export interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Where a dismissal is remembered, so the banner asks at most once. */
export const INSTALL_DISMISSED_KEY = 'sabha-install-dismissed';

interface NavigatorLike {
    userAgent?: string;
    maxTouchPoints?: number;
    /** iOS's pre-standard flag; still the only reliable signal on older Safari. */
    standalone?: boolean;
}

interface WindowLike {
    matchMedia?: (query: string) => { matches: boolean };
    navigator?: NavigatorLike;
}

interface EventTargetLike {
    addEventListener: (type: string, listener: (event: any) => void) => void;
}

/** True when the app is already running as an installed app. */
export function isStandalone(win?: WindowLike): boolean {
    try {
        if (win?.matchMedia?.('(display-mode: standalone)')?.matches) return true;
        // Checked second and separately: Safari did not report display-mode for
        // home screen apps until recently, and the versions that did not are
        // still in use. `navigator.standalone` has been there the whole time.
        return win?.navigator?.standalone === true;
    } catch {
        // matchMedia throws on a malformed query in some engines. An
        // unanswerable question is the same as "not installed" here.
        return false;
    }
}

/**
 * True for devices where Add to Home Screen exists but must be done by hand.
 *
 * iPadOS 13+ sends a desktop Mac user-agent, so the UA alone reports an iPad as
 * a Mac. Touch points are what separate them, and the distinction matters:
 * a real Mac has no home screen to add to, so it must NOT be told to look for
 * one.
 */
export function isIosLike(userAgent: string, maxTouchPoints = 0): boolean {
    if (/iphone|ipod|ipad/i.test(userAgent)) return true;
    return /macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/**
 * The one verdict both the banner and the Profile entry read.
 *
 * Order is deliberate. Installed wins over everything, so an installed app
 * never advertises installing. A live Chrome prompt beats the manual steps,
 * because a tap beats a paragraph.
 */
export function installAvailability(win: WindowLike | undefined, hasPrompt: boolean): InstallAvailability {
    if (isStandalone(win)) return 'installed';
    if (hasPrompt) return 'prompt';
    const nav = win?.navigator;
    if (isIosLike(nav?.userAgent ?? '', nav?.maxTouchPoints ?? 0)) return 'manual';
    return 'none';
}

/**
 * The two taps, worded for the browser actually in use.
 *
 * Safari puts Share in the bottom toolbar; Chrome and Edge for iOS put it in
 * the address bar. Sending someone to the wrong end of the screen is how these
 * instructions get abandoned, so the first step names the right place.
 */
export function installSteps(userAgent: string): string[] {
    const share = /crios/i.test(userAgent) ? 'Tap the Share icon in Chrome’s address bar'
        : /edgios/i.test(userAgent) ? 'Tap the Share icon in Edge’s address bar'
            : /fxios/i.test(userAgent) ? 'Tap the menu button, then Share'
                : 'Tap the Share icon in the bar at the bottom';
    return [share, 'Choose “Add to Home Screen”, then Add'];
}

// ── Remembered dismissal ────────────────────────────────────────────────────
// Same never-throw contract as theme.ts: localStorage is a SecurityError in a
// sandboxed iframe and in Lockdown Mode, and this is a banner preference.

export function readInstallDismissed(storage?: Pick<Storage, 'getItem'>): boolean {
    try {
        const store = storage ?? globalThis.localStorage;
        return store?.getItem(INSTALL_DISMISSED_KEY) === 'true';
    } catch {
        return false;
    }
}

export function writeInstallDismissed(dismissed: boolean, storage?: Pick<Storage, 'setItem' | 'removeItem'>): void {
    try {
        const store = storage ?? globalThis.localStorage;
        if (dismissed) store?.setItem(INSTALL_DISMISSED_KEY, 'true');
        else store?.removeItem(INSTALL_DISMISSED_KEY);
    } catch {
        // The banner still behaves correctly for this session; it just forgets.
    }
}

// ── Module-scope capture ────────────────────────────────────────────────────

let deferredPrompt: InstallPromptEvent | null = null;
let installedThisSession = false;
let watching = false;
/** `null` until first read, so a test can clear storage and start over. */
let dismissed: boolean | null = null;
const listeners = new Set<() => void>();

const notify = () => { for (const listener of [...listeners]) listener(); };

/**
 * Start listening. Call once, as early as possible — see the header.
 *
 * Idempotent, because both `index.tsx` (early, to catch the event) and
 * `usePwaInstall` (on mount, so tests and late mounts still work) call it. The
 * window listeners are deliberately never removed: they are module-lifetime,
 * and the event they wait for may arrive at any point in the page's life.
 */
export function watchInstallPrompt(win: EventTargetLike | undefined): void {
    if (watching || !win) return;
    watching = true;
    win.addEventListener('beforeinstallprompt', (event: InstallPromptEvent) => {
        // Suppresses Chrome's own mini-infobar so there is one prompt, ours.
        event.preventDefault?.();
        deferredPrompt = event;
        notify();
    });
    win.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        installedThisSession = true;
        notify();
    });
}

/** Subscribe to capture/consumption of the prompt. Returns an unsubscriber. */
export function subscribeToInstallState(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function hasInstallPrompt(): boolean { return deferredPrompt !== null; }

/**
 * True once Chrome reports the install finished.
 *
 * Needed because the tab that triggers an install does NOT become standalone,
 * so `isStandalone` keeps saying no and the banner would otherwise sit there
 * offering to do what was just done.
 */
export function wasInstalledThisSession(): boolean { return installedThisSession; }

/**
 * Replay Chrome's prompt. Resolves to what the user chose.
 *
 * The event is single-use — Chrome rejects a second `prompt()` on the same one
 * — so it is dropped before being shown, and `hasInstallPrompt` goes false.
 * That is what removes the button rather than leaving it to fail silently on a
 * second press.
 */
export async function runInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const event = deferredPrompt;
    if (!event) return 'unavailable';
    deferredPrompt = null;
    notify();
    try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        return outcome;
    } catch {
        return 'unavailable';
    }
}

/**
 * Whether the user has waved the banner away.
 *
 * Module state, not component state, and this is the whole reason: the banner
 * and the Profile entry are separate `usePwaInstall` callers. With a `useState`
 * each, pressing "Add to Home Screen" in Profile would write the storage key
 * and notify nobody — the banner's own copy of `dismissed` was read once at
 * mount and would never look again. The entry would appear wired and do
 * nothing, which is the exact defect this feature exists to remove.
 */
export function isInstallDismissed(): boolean {
    if (dismissed === null) dismissed = readInstallDismissed();
    return dismissed;
}

export function setInstallDismissed(value: boolean): void {
    dismissed = value;
    writeInstallDismissed(value);
    notify();
}

/** Test seam: forget the captured event, the listeners, and the watch guard. */
export function resetInstallState(): void {
    deferredPrompt = null;
    installedThisSession = false;
    watching = false;
    dismissed = null;
    listeners.clear();
}
