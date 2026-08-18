/**
 * Noticing that a new version has shipped, and reloading only when told to.
 *
 * THE FAILURE THIS EXISTS FOR
 * ---------------------------
 * The app was built with `registerType: 'autoUpdate'`, whose generated
 * `registerSW.js` is one line: `navigator.serviceWorker.register('/sw.js')`.
 * It handles updates in no way at all. A new worker would install and claim
 * clients, but a page that was ALREADY OPEN carried on running the JavaScript it
 * had downloaded, and nothing anywhere said so.
 *
 * On 2026-08-17 that cost an hour: a dark-mode fix was live in production, was
 * confirmed present in the served bundle, and still was not what the browser was
 * running. The real cost is on phones — this is an installed PWA, so a driver can
 * keep a tab alive for weeks and run a stale client against current rules and
 * Cloud Functions.
 *
 * THE SHAPE OF THE FIX
 * --------------------
 * `skipWaiting` is off, so a new worker parks in `waiting` instead of taking
 * over. That is the signal. We surface it and let the USER choose the moment,
 * because a driver halfway through a carload must not have the page reload under
 * them — but they must be told it is stale.
 *
 * Written against small structural interfaces rather than `ServiceWorker*` types
 * so the logic is testable without a browser. The rules below are the whole of
 * the behaviour and each one is a real trap.
 */

/** Just enough of a `ServiceWorker` for our purposes. */
export interface WorkerLike {
    state: string;
    postMessage(message: unknown): void;
    addEventListener(type: 'statechange', listener: () => void): void;
    removeEventListener?(type: 'statechange', listener: () => void): void;
}

/** Just enough of a `ServiceWorkerRegistration`. */
export interface RegistrationLike {
    waiting: WorkerLike | null;
    installing: WorkerLike | null;
    addEventListener(type: 'updatefound', listener: () => void): void;
    update(): Promise<unknown>;
}

/**
 * How often to ask the server whether a new worker exists.
 *
 * Without this the browser only checks on navigation, and an installed PWA that
 * is never closed may not navigate for days. It is a conditional request for one
 * small file, so the cost is negligible; 15 minutes means a release published
 * during a sabha is offered before the evening ends.
 */
export const UPDATE_POLL_MS = 15 * 60 * 1000;

/**
 * Is there a new version genuinely waiting?
 *
 * `hasController` is the part people get wrong. On a FIRST EVER visit the worker
 * also passes through `waiting` — there is nothing to update from, and prompting
 * "a new version is available" to someone who just opened the app for the first
 * time is nonsense. A controller only exists when a previous worker is already
 * driving the page, so its presence is what distinguishes "update" from
 * "initial install".
 */
export function updateIsWaiting(
    registration: Pick<RegistrationLike, 'waiting'> | null,
    hasController: boolean,
): boolean {
    return !!registration?.waiting && hasController;
}

/**
 * Tell the waiting worker to take over.
 *
 * The message type is not ours to choose — Workbox's generated `sw.js` listens
 * for exactly `{ type: 'SKIP_WAITING' }`. Anything else is silently ignored,
 * which would leave a Reload button that does nothing: precisely the dead-control
 * failure this project keeps designing against.
 *
 * Returns whether a worker was actually asked, so a caller can avoid promising a
 * reload that will never arrive.
 */
export function applyUpdate(registration: Pick<RegistrationLike, 'waiting'> | null): boolean {
    const waiting = registration?.waiting;
    if (!waiting) return false;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
}

/**
 * Watch one registration and call back when an update is ready.
 *
 * Three separate paths reach the same callback, and all three are needed:
 *
 *   1. Already waiting when we start. The worker may have installed during a
 *      previous visit, or before this component mounted. Checking only for
 *      future events would miss it, and the banner would never appear.
 *   2. `updatefound` → the new worker reaches `installed`. NOT `activated`:
 *      with skipWaiting off it will never activate on its own, so waiting for
 *      that is waiting forever.
 *   3. The poll, which is what makes 1 and 2 fire at all on a page that never
 *      navigates.
 *
 * Returns a cleanup function; callers in React must use it or the interval
 * outlives the component.
 */
export function watchForUpdate(
    registration: RegistrationLike,
    hasController: () => boolean,
    onUpdateReady: () => void,
    schedule: (fn: () => void, ms: number) => number | { valueOf(): number } = setInterval as never,
    cancel: (handle: never) => void = clearInterval as never,
): () => void {
    let done = false;
    const announce = () => {
        // Once is enough: the banner does not become more true if told twice, and
        // a repeated callback would restart any animation on every poll.
        if (done) return;
        done = true;
        onUpdateReady();
    };

    if (updateIsWaiting(registration, hasController())) announce();

    registration.addEventListener('updatefound', () => {
        const incoming = registration.installing;
        if (!incoming) return;
        const check = () => {
            if (incoming.state === 'installed' && hasController()) announce();
        };
        check();
        incoming.addEventListener('statechange', check);
    });

    const handle = schedule(() => { void registration.update(); }, UPDATE_POLL_MS) as never;
    return () => cancel(handle);
}
