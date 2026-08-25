import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { PICKUPS_COLLECTION } from '../src/utils/arrival';
import type { AirportPickup } from '../types';

/**
 * The arrivals board, live.
 *
 * IT REPORTS ITS OWN FAILURE, unlike `useNotices`, which sets an empty list and
 * carries on. That is right for a notice board — a missing flyer costs nothing — and
 * wrong here. An empty arrivals board means "nobody is landing", and a Sarthi reading
 * that when three people are waiting is the exact defect this repo keeps removing: a
 * query that returns nothing instead of erroring. So `error` comes back and the board
 * renders it.
 *
 * ONE FIELD in the query. `arrivalAt` is both the filter and the sort, so no composite
 * index is needed — the deliberate house pattern, and the reason it matters here is
 * that a missing index fails as an EMPTY RESULT rather than an error, which is the
 * same silent nothing again.
 */

export interface ArrivalsResult {
    arrivals: AirportPickup[];
    loading: boolean;
    /** A human-readable reason the board is empty, or null when it genuinely is. */
    error: string | null;
}

function subscribe(
    q: ReturnType<typeof query>,
    label: string,
    set: (r: ArrivalsResult) => void,
) {
    return onSnapshot(
        q,
        snapshot => set({
            arrivals: snapshot.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<AirportPickup, 'id'>),
            })),
            loading: false,
            error: null,
        }),
        err => {
            console.error(`[${label}] Could not read the arrivals board:`, err);
            set({
                arrivals: [],
                loading: false,
                // Named rather than generic, because the two causes need different
                // answers: a permission error means the account is not an approved
                // Sarthi, and anything else is worth retrying.
                error: err.code === 'permission-denied'
                    ? 'Your account is not approved to see the arrivals board.'
                    : 'The arrivals board could not be loaded. Check your connection.',
            });
        },
    );
}

/**
 * Every arrival between two instants. Both bounds are ISO strings, and they are
 * compared against `arrivalAt` — the server-computed instant — never against the
 * `arrivalDate` string, which is local to the airport and would put a 22:00 BOS
 * landing on the wrong day at either end of the range.
 */
export function useArrivalsBetween(fromIso: string, toIso: string): ArrivalsResult {
    const [result, setResult] = useState<ArrivalsResult>({
        arrivals: [], loading: true, error: null,
    });

    useEffect(() => {
        return subscribe(
            query(
                collection(db, PICKUPS_COLLECTION),
                where('arrivalAt', '>=', fromIso),
                where('arrivalAt', '<=', toIso),
                orderBy('arrivalAt'),
            ),
            'useArrivalsBetween',
            setResult,
        );
    }, [fromIso, toIso]);

    return result;
}

/**
 * The signed-in traveller's own requests, newest arrival last.
 *
 * Filtered on `requesterUid` alone — the one field their own rule arm matches on in
 * firestore.rules. Adding an `arrivalAt` bound here would need a composite index that
 * does not exist, and there are never more than a handful.
 */
export function useMyArrivals(): ArrivalsResult {
    const { currentUser } = useAuth();
    const uid = currentUser?.uid ?? null;
    const [result, setResult] = useState<ArrivalsResult>({
        arrivals: [], loading: true, error: null,
    });

    useEffect(() => {
        if (!uid) {
            setResult({ arrivals: [], loading: false, error: null });
            return;
        }
        return subscribe(
            query(collection(db, PICKUPS_COLLECTION), where('requesterUid', '==', uid)),
            'useMyArrivals',
            setResult,
        );
    }, [uid]);

    return result;
}

/**
 * The one request a traveller can act on, if any.
 *
 * `requestAirportPickup` refuses a second live request, so there is at most one —
 * but the collection also holds their finished trips, and the status card must not
 * show a completed pickup from last term as though a Sarthi were on the way.
 */
export function useMyLiveArrival(): { arrival: AirportPickup | null; loading: boolean; error: string | null } {
    const { arrivals, loading, error } = useMyArrivals();

    const arrival = useMemo(
        () => arrivals.find(a => a.status === 'open' || a.status === 'claimed' || a.status === 'met') ?? null,
        [arrivals],
    );

    return { arrival, loading, error };
}
