/**
 * The feedback a manager can read, with names resolved.
 *
 * Live, because `AuthContext` and every other list in this app are — a manager
 * who leaves Reports open should see feedback arrive rather than having to reload.
 *
 * WHY THE NAME IS JOINED HERE AND NOT STORED
 * ------------------------------------------
 * The feedback document holds `uid` and nothing about who that is. A name written
 * by the client would be unverifiable, and a forged one on a complaint about a
 * named volunteer would send a manager to the wrong person. So the display name
 * comes from `users/{uid}`, which a manager already reads on the People page, and
 * `uid` stays the authoritative key.
 *
 * An unresolvable uid — a deleted account, or a users read that failed — yields a
 * null name, and `buildFeedbackCsv` prints "Unknown" rather than `undefined`.
 */

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleSnapshotError } from '../src/utils/firestoreErrors';
import type { FeedbackRow } from '../src/utils/feedback';

export function useFeedback() {
    const [rows, setRows] = useState<FeedbackRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Two listeners rather than a join per row: `users` is already streamed on
        // other manager screens, and N document reads per render on a list that
        // updates live is the shape this repo has removed twice.
        const names = new Map<string, { name: string | null; role: string | null }>();
        let latest: Array<Omit<FeedbackRow, 'name' | 'role'> & { uid: string }> = [];

        const publish = () => setRows(latest.map(r => ({
            ...r,
            name: names.get(r.uid)?.name ?? null,
            role: names.get(r.uid)?.role ?? null,
        })));

        const unsubUsers = onSnapshot(collection(db, 'users'), snap => {
            names.clear();
            snap.forEach(d => names.set(d.id, {
                name: (d.data()?.name as string) ?? null,
                role: (d.data()?.role as string) ?? null,
            }));
            publish();
        }, handleSnapshotError('useFeedback/users', () => undefined));

        const unsubFeedback = onSnapshot(
            query(collection(db, 'feedback'), orderBy('createdAt', 'desc')),
            snap => {
                latest = snap.docs.map(d => {
                    const data = d.data();
                    return {
                        uid: (data.uid as string) ?? '',
                        createdAt: (data.createdAt as string) ?? '',
                        rating: Number(data.rating) || 0,
                        comment: (data.comment as string) ?? '',
                    };
                });
                publish();
                setLoading(false);
            },
            handleSnapshotError('useFeedback', () => {
                setError('Could not load feedback.');
                setLoading(false);
            }),
        );

        return () => { unsubUsers(); unsubFeedback(); };
    }, []);

    return { rows, loading, error };
}
