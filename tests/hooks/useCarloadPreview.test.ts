/**
 * The carload grouping is a CALLABLE against a queue that is a LIVE SUBSCRIPTION.
 *
 * That mismatch is the whole reason this hook exists, and every test here is about it.
 * The queue updates the instant a rider asks; the grouping is a snapshot computed on the
 * server. So they can disagree, and a grouping that looks settled while describing a
 * queue two riders out of date is exactly the quietly-wrong screen this app keeps
 * removing.
 *
 * The three things that can go wrong, and do:
 *
 *   1. not refetching when the pool changes — a manager reads last minute's cars;
 *   2. refetching on every render — a function invocation per keystroke, all evening;
 *   3. two requests in flight landing out of order, so the OLDER answer wins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const previewCarloads = vi.fn();
vi.mock('../../src/utils/cloudFunctions', () => ({
    previewCarloads: (...a: unknown[]) => previewCarloads(...a),
}));

import { useCarloadPreview } from '../../hooks/useCarloadPreview';

const result = (tag: string) => ({
    status: 'ok' as const, groups: [], leftover: [], carSeats: [3], tag,
});

beforeEach(() => {
    vi.clearAllMocks();
    previewCarloads.mockResolvedValue(result('first'));
});

describe('useCarloadPreview — when it asks', () => {
    it('asks once on mount when enabled', async () => {
        const { result: hook } = renderHook(() =>
            useCarloadPreview(['a', 'b'], null, true));

        await waitFor(() => expect(hook.current.preview).not.toBeNull());
        expect(previewCarloads).toHaveBeenCalledTimes(1);
    });

    it('DOES NOT ASK AT ALL while disabled', async () => {
        // The board is one of two views. Computing a grouping nothing renders spends an
        // invocation per arriving request, all evening, for nobody.
        renderHook(() => useCarloadPreview(['a', 'b'], null, false));

        await new Promise(r => setTimeout(r, 0));
        expect(previewCarloads).not.toHaveBeenCalled();
    });

    it('asks again when a rider JOINS the queue', async () => {
        const { result: hook, rerender } = renderHook(
            ({ ids }) => useCarloadPreview(ids, null, true),
            { initialProps: { ids: ['a'] } },
        );
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        rerender({ ids: ['a', 'b'] });
        await waitFor(() => expect(previewCarloads).toHaveBeenCalledTimes(2));
    });

    it('asks again when a rider LEAVES the queue', async () => {
        const { result: hook, rerender } = renderHook(
            ({ ids }) => useCarloadPreview(ids, null, true),
            { initialProps: { ids: ['a', 'b'] } },
        );
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        rerender({ ids: ['a'] });
        await waitFor(() => expect(previewCarloads).toHaveBeenCalledTimes(2));
    });

    it('does NOT ask again when the same riders arrive in a different order', async () => {
        /**
         * The grouping depends on WHICH riders are waiting, not on the order Firestore
         * happened to return them in — and a snapshot re-emits in whatever order it
         * likes. Keyed on the raw array this refetches on every tick, forever, which is
         * a Cloud Function call a second on a screen left open.
         */
        const { result: hook, rerender } = renderHook(
            ({ ids }) => useCarloadPreview(ids, null, true),
            { initialProps: { ids: ['a', 'b', 'c'] } },
        );
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        rerender({ ids: ['c', 'a', 'b'] });
        await new Promise(r => setTimeout(r, 0));
        expect(previewCarloads).toHaveBeenCalledTimes(1);
    });

    it('asks again when the hall changes', async () => {
        const { result: hook, rerender } = renderHook(
            ({ hall }) => useCarloadPreview(['a'], hall, true),
            { initialProps: { hall: null as string | null } },
        );
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        rerender({ hall: 'somerville' });
        await waitFor(() => expect(previewCarloads).toHaveBeenCalledTimes(2));
        expect(previewCarloads).toHaveBeenLastCalledWith('somerville');
    });

    it('asks again on demand', async () => {
        const { result: hook } = renderHook(() => useCarloadPreview(['a'], null, true));
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        await act(async () => { hook.current.refresh(); });
        expect(previewCarloads).toHaveBeenCalledTimes(2);
    });
});

describe('useCarloadPreview — staleness is not loading', () => {
    it('reports stale once the pool moves on, BEFORE the new answer lands', async () => {
        /**
         * The distinction a screen needs. `loading` means a request is in flight;
         * `stale` means what is on screen describes a different queue. Conflated, a
         * settled-looking board is quietly out of date, and a manager acting on it is
         * the entire failure this flag exists to prevent.
         */
        let release: (v: unknown) => void = () => {};
        previewCarloads.mockImplementation(() => new Promise(r => { release = r; }));

        const { result: hook, rerender } = renderHook(
            ({ ids }) => useCarloadPreview(ids, null, true),
            { initialProps: { ids: ['a'] } },
        );
        await act(async () => { release(result('first')); });
        await waitFor(() => expect(hook.current.preview).not.toBeNull());
        expect(hook.current.stale).toBe(false);

        // A rider asks. The grouping on screen now describes the previous queue.
        previewCarloads.mockImplementation(() => new Promise(r => { release = r; }));
        rerender({ ids: ['a', 'b'] });

        await waitFor(() => expect(hook.current.stale).toBe(true));
        expect(hook.current.preview).not.toBeNull();     // still showing the old one
    });

    it('clears stale once the new answer arrives', async () => {
        const { result: hook, rerender } = renderHook(
            ({ ids }) => useCarloadPreview(ids, null, true),
            { initialProps: { ids: ['a'] } },
        );
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        rerender({ ids: ['a', 'b'] });
        await waitFor(() => expect(hook.current.stale).toBe(false));
    });

    it('is not stale before the first answer has ever landed', async () => {
        // Nothing on screen to be out of date. Stale here would draw a warning over an
        // empty board.
        previewCarloads.mockImplementation(() => new Promise(() => {}));
        const { result: hook } = renderHook(() => useCarloadPreview(['a'], null, true));

        expect(hook.current.stale).toBe(false);
        expect(hook.current.loading).toBe(true);
    });
});

describe('useCarloadPreview — out-of-order answers', () => {
    it('DISCARDS an older answer that lands last', async () => {
        /**
         * Two riders ask a second apart, so two requests are in flight. They can come
         * back in either order, and the older one landing last would leave the board
         * showing a grouping for a queue that has already moved on — with `stale` false,
         * because as far as the hook knew it had just been recomputed. Silent, and
         * exactly the wrong way round.
         */
        const releases: Array<(v: unknown) => void> = [];
        previewCarloads.mockImplementation(() => new Promise(r => { releases.push(r); }));

        const { result: hook, rerender } = renderHook(
            ({ ids }) => useCarloadPreview(ids, null, true),
            { initialProps: { ids: ['a'] } },
        );
        rerender({ ids: ['a', 'b'] });
        await waitFor(() => expect(releases).toHaveLength(2));

        // The NEWER request answers first, then the older one.
        await act(async () => { releases[1](result('newer')); });
        await act(async () => { releases[0](result('older')); });

        expect((hook.current.preview as any)?.tag).toBe('newer');
        expect(hook.current.stale).toBe(false);
    });
});

describe('useCarloadPreview — failures and closing the view', () => {
    it('surfaces the SERVER\'s message', async () => {
        // It refuses for reasons a manager can act on. A generic "try again" hides a
        // revoked account behind a retry that will never work.
        previewCarloads.mockRejectedValue(new Error('Manager access has been revoked.'));

        const { result: hook } = renderHook(() => useCarloadPreview(['a'], null, true));

        await waitFor(() => expect(hook.current.error).toBe('Manager access has been revoked.'));
        expect(hook.current.loading).toBe(false);
    });

    it('stops loading after a failure, rather than spinning for ever', async () => {
        previewCarloads.mockRejectedValue(new Error('nope'));
        const { result: hook } = renderHook(() => useCarloadPreview(['a'], null, true));

        await waitFor(() => expect(hook.current.error).not.toBeNull());
        expect(hook.current.loading).toBe(false);
    });

    it('FORGETS the grouping when the view is closed', async () => {
        // Otherwise re-opening shows the carloads from whenever it was last open —
        // possibly a different sabha — for the moment before the refetch lands.
        const { result: hook, rerender } = renderHook(
            ({ on }) => useCarloadPreview(['a'], null, on),
            { initialProps: { on: true } },
        );
        await waitFor(() => expect(hook.current.preview).not.toBeNull());

        rerender({ on: false });
        await waitFor(() => expect(hook.current.preview).toBeNull());
    });

    it('clears a previous error when the view is closed', async () => {
        previewCarloads.mockRejectedValue(new Error('nope'));
        const { result: hook, rerender } = renderHook(
            ({ on }) => useCarloadPreview(['a'], null, on),
            { initialProps: { on: true } },
        );
        await waitFor(() => expect(hook.current.error).not.toBeNull());

        rerender({ on: false });
        await waitFor(() => expect(hook.current.error).toBeNull());
    });
});
