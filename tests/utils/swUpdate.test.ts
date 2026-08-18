/**
 * Noticing a new release, without lying to a first-time visitor.
 *
 * The app shipped with `registerType: 'autoUpdate'`, whose generated registrar is
 * a bare `navigator.serviceWorker.register('/sw.js')` — no update handling at
 * all. A new worker installed and claimed clients while an already-open page kept
 * running the code it had; nothing told the user. That cost an hour on 2026-08-17
 * chasing a dark-mode fix that was already live, and on an installed PWA it means
 * a driver can run a stale client against current rules and functions for weeks.
 *
 * Each case below is a trap that would produce either a silent stale client or a
 * dead Reload button.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    UPDATE_POLL_MS, applyUpdate, updateIsWaiting, watchForUpdate,
    type RegistrationLike, type WorkerLike,
} from '../../src/utils/swUpdate';

function worker(state = 'installed'): WorkerLike & { posted: unknown[]; fire: () => void } {
    const listeners: Array<() => void> = [];
    return {
        state,
        posted: [] as unknown[],
        postMessage(m: unknown) { (this.posted as unknown[]).push(m); },
        addEventListener: (_t: 'statechange', l: () => void) => { listeners.push(l); },
        fire: () => listeners.forEach(l => l()),
    };
}

function registration(over: Partial<RegistrationLike> = {}) {
    const found: Array<() => void> = [];
    const reg = {
        waiting: null as WorkerLike | null,
        installing: null as WorkerLike | null,
        addEventListener: (_t: 'updatefound', l: () => void) => { found.push(l); },
        update: vi.fn(async () => undefined),
        ...over,
    };
    return { reg: reg as RegistrationLike & typeof reg, fireUpdateFound: () => found.forEach(l => l()) };
}

describe('updateIsWaiting', () => {
    it('is true when a worker waits and one already controls the page', () => {
        expect(updateIsWaiting({ waiting: worker() }, true)).toBe(true);
    });

    it('is FALSE on a first ever visit, even though a worker is waiting', () => {
        // The trap. A first install also passes through `waiting`. Announcing
        // "a new version is available" to someone who just opened the app for the
        // first time is nonsense — there is no old version to replace.
        expect(updateIsWaiting({ waiting: worker() }, false)).toBe(false);
    });

    it('is false with nothing waiting', () => {
        expect(updateIsWaiting({ waiting: null }, true)).toBe(false);
        expect(updateIsWaiting(null, true)).toBe(false);
    });
});

describe('applyUpdate', () => {
    it('sends the exact message Workbox listens for', () => {
        // Not ours to choose: the generated sw.js matches
        // `e.data.type === 'SKIP_WAITING'` and ignores anything else. A typo here
        // is a Reload button that does nothing at all.
        const w = worker();

        expect(applyUpdate({ waiting: w })).toBe(true);
        expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    });

    it('reports failure rather than pretending, when nothing is waiting', () => {
        // The caller reloads directly in this case. Returning true would leave a
        // spinner running for ever.
        expect(applyUpdate({ waiting: null })).toBe(false);
        expect(applyUpdate(null)).toBe(false);
    });
});

describe('watchForUpdate', () => {
    const noop = () => 0 as never;

    it('announces a worker that was ALREADY waiting when we started', () => {
        // It may have installed during a previous visit or before the component
        // mounted. Listening only for future events misses it and the banner
        // never appears.
        const { reg } = registration({ waiting: worker() });
        const onReady = vi.fn();

        watchForUpdate(reg, () => true, onReady, noop, () => undefined);

        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('announces one that arrives later, at `installed`', () => {
        // NOT `activated`: with skipWaiting off it never activates by itself, so
        // waiting for that waits for ever.
        const incoming = worker('installing');
        const { reg, fireUpdateFound } = registration();
        const onReady = vi.fn();

        watchForUpdate(reg, () => true, onReady, noop, () => undefined);
        expect(onReady).not.toHaveBeenCalled();

        reg.installing = incoming;
        fireUpdateFound();
        incoming.state = 'installed';
        incoming.fire();

        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('announces once, however many times it is told', () => {
        const incoming = worker('installed');
        const { reg, fireUpdateFound } = registration();
        const onReady = vi.fn();

        watchForUpdate(reg, () => true, onReady, noop, () => undefined);
        reg.installing = incoming;
        fireUpdateFound();
        incoming.fire();
        incoming.fire();

        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('polls, because an installed PWA may never navigate', () => {
        // Without this the browser only re-checks on navigation. A phone with the
        // app left open would never learn a release had happened — which is the
        // whole reason a stale client can survive for days.
        const { reg } = registration();
        let ticker: (() => void) | null = null;

        watchForUpdate(reg, () => true, vi.fn(), (fn, ms) => {
            expect(ms).toBe(UPDATE_POLL_MS);
            ticker = fn;
            return 1 as never;
        }, () => undefined);

        expect(reg.update).not.toHaveBeenCalled();
        ticker!();
        expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it('cancels the poll on cleanup, so it cannot outlive the component', () => {
        const { reg } = registration();
        const cancel = vi.fn();

        const stop = watchForUpdate(reg, () => true, vi.fn(), () => 7 as never, cancel);
        stop();

        expect(cancel).toHaveBeenCalledWith(7);
    });

    it('stays silent for a first-time visitor whose worker just installed', () => {
        const incoming = worker('installed');
        const { reg, fireUpdateFound } = registration();
        const onReady = vi.fn();

        // No controller: nothing is being replaced.
        watchForUpdate(reg, () => false, onReady, noop, () => undefined);
        reg.installing = incoming;
        fireUpdateFound();
        incoming.fire();

        expect(onReady).not.toHaveBeenCalled();
    });

    it('checks often enough to matter, and not so often it is chatty', () => {
        expect(UPDATE_POLL_MS).toBeLessThanOrEqual(30 * 60 * 1000);
        expect(UPDATE_POLL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
    });
});
