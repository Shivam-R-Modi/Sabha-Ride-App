import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Notice } from '../types';

/**
 * The notice board, live.
 *
 * Modelled on `hooks/useRideWindow.ts`: one subscription, `exists`-style guards,
 * `??` defaults, and an error branch that **fails closed** — an empty board is
 * honest, a board that throws takes the whole dashboard with it.
 *
 * Expired notices are filtered HERE as well as being deleted by the nightly
 * sweep. Between a notice's last day ending and 03:00 the document still exists,
 * and a stale flyer on every dashboard for a few hours is exactly what makes
 * people stop reading the board.
 */
export function useNotices(): { notices: Notice[]; loading: boolean } {
    const [notices, setNotices] = useState<Notice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onSnapshot(
            query(collection(db, 'notices'), orderBy('createdAt', 'desc')),
            snapshot => {
                // Local date, not UTC: the server sweeps in the sabha's timezone
                // and the two must agree or a notice flickers back for an hour.
                const today = new Date();
                const todayKey = [
                    today.getFullYear(),
                    String(today.getMonth() + 1).padStart(2, '0'),
                    String(today.getDate()).padStart(2, '0'),
                ].join('-');

                setNotices(snapshot.docs
                    .map(d => ({ id: d.id, ...(d.data() as Omit<Notice, 'id'>) }))
                    .filter(n => {
                        const until = n.showUntil ?? n.eventId ?? null;
                        return !until || until >= todayKey;
                    }));
                setLoading(false);
            },
            error => {
                console.error('[useNotices] Could not read the notice board:', error);
                setNotices([]);
                setLoading(false);
            },
        );
        return unsubscribe;
    }, []);

    return { notices, loading };
}
