/**
 * The waiting queue, grouped into the cars dispatch would form.
 *
 * A CALLABLE, NOT A SUBSCRIPTION, and that difference is the whole design problem here.
 * The queue itself is an `onSnapshot` and updates the instant a rider asks; the grouping
 * is computed on the server. So the two can disagree for as long as it takes to refetch,
 * and a stale grouping is precisely the kind of quietly-wrong screen this app keeps
 * removing.
 *
 * The answer is to key the refetch on WHAT THE GROUPING DEPENDS ON — the set of waiting
 * request ids, plus the hall and direction — and to say plainly, via `stale`, whenever
 * the two are out of step. A caller that renders `stale` as "recalculating" is honest;
 * one that ignores it shows last minute's cars as though they were this minute's.
 *
 * It deliberately does NOT refetch on a timer. The escalation valve in `chooseSeed`
 * promotes a rider after 90 minutes, so the grouping does change with nothing else
 * changing — but once every 90 minutes is not something a poll can catch usefully, and
 * a manager who wants the current answer has a Refresh they can see. A `setInterval`
 * here would be a control nobody can observe, firing on a screen nobody is watching.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    previewCarloads, type CarloadPreviewResult,
} from '../src/utils/cloudFunctions';

export interface CarloadPreviewState {
    preview: CarloadPreviewResult | null;
    loading: boolean;
    error: string | null;
    /**
     * The pool has changed since this grouping was computed.
     *
     * Not the same as `loading`: loading is "a request is in flight", stale is "what you
     * are looking at describes a different queue". Both can be true, and a screen needs
     * to distinguish them or a manager reads a settled-looking answer that is out of date.
     */
    stale: boolean;
    refresh: () => void;
}

export function useCarloadPreview(
    /** Every waiting request's id. The grouping is a function of this set. */
    requestIds: readonly string[],
    /** The hall to group for. Null means the founding hall. */
    locationId: string | null,
    /**
     * Off by default.
     *
     * The manager's queue renders as a flat list unless the grouped view is showing, and
     * calling this for a view nobody opened would spend a function invocation per
     * request that arrives, all evening, to compute something nothing renders.
     */
    enabled: boolean,
): CarloadPreviewState {
    const [preview, setPreview] = useState<CarloadPreviewResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** The pool this grouping was computed for, so `stale` is a fact and not a guess. */
    const [computedFor, setComputedFor] = useState<string | null>(null);

    // Sorted and joined: the grouping depends on WHICH riders are waiting, not on the
    // order Firestore happened to return them in. Without sorting, a re-ordered snapshot
    // of an unchanged queue would refetch on every tick.
    const key = [...requestIds].sort().join(',');

    /**
     * Guards against a slow response overwriting a newer one.
     *
     * Two refetches in flight — a rider asks, then another asks a second later — can
     * come back in either order, and the older answer landing last would leave the
     * screen showing a grouping for a queue that has already moved on. Compared against
     * the key rather than counted, so it is obvious what is being discarded.
     */
    const inFlight = useRef<string | null>(null);

    const run = useCallback(async (forKey: string) => {
        inFlight.current = forKey;
        setLoading(true);
        setError(null);
        try {
            const result = await previewCarloads(locationId);
            if (inFlight.current !== forKey) return;
            setPreview(result);
            setComputedFor(forKey);
        } catch (err: unknown) {
            if (inFlight.current !== forKey) return;
            // Surfaced, never swallowed. The server refuses for reasons a manager can
            // act on — a revoked account, a hall that is no longer open — and a silent
            // empty grouping would look like "nobody is waiting" on a Friday night.
            setError(err instanceof Error ? err.message : 'Could not work out the carloads.');
        } finally {
            if (inFlight.current === forKey) setLoading(false);
        }
    }, [locationId]);

    useEffect(() => {
        if (!enabled) return;
        void run(key);
    }, [enabled, key, run]);

    /**
     * Clear the grouping when the view is closed.
     *
     * Otherwise re-opening it shows the carloads from whenever it was last open —
     * possibly a different sabha — for the moment before the refetch lands.
     */
    useEffect(() => {
        if (enabled) return;
        setPreview(null);
        setComputedFor(null);
        setError(null);
        inFlight.current = null;
    }, [enabled]);

    return {
        preview,
        loading,
        error,
        stale: preview !== null && computedFor !== key,
        refresh: useCallback(() => { void run(key); }, [run, key]),
    };
}
