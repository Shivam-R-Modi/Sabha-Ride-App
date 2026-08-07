import type { FirestoreError } from 'firebase/firestore';

/**
 * Error handler for onSnapshot listeners.
 *
 * Every listener in this codebase was registered as `onSnapshot(q, cb)` with no
 * second callback. Firestore reports query failures through that callback and
 * nowhere else, so a failure was completely silent: `loading` stayed true, the
 * result array stayed empty, and the UI showed "nothing here" forever.
 *
 * That is exactly how the manager approval queue went unnoticed. It queries
 * `roles array-contains 'driver'` + `accountStatus == 'pending'`, which requires
 * a composite index that was never deployed. Every driver who registered was
 * invisible to every manager, with no error anywhere.
 *
 * `failed-precondition` on a listener almost always means a missing index, and
 * Firestore puts a create-it link in the message — so surface it loudly.
 */
export function handleSnapshotError(
    context: string,
    onDone?: (error: FirestoreError) => void,
): (error: FirestoreError) => void {
    return (error: FirestoreError) => {
        if (error.code === 'failed-precondition') {
            console.error(
                `[${context}] Query failed — this is almost certainly a MISSING FIRESTORE INDEX. ` +
                `Add it to firestore.indexes.json and run \`firebase deploy --only firestore:indexes\`. ` +
                `Firestore's message includes a direct create link:\n${error.message}`,
            );
        } else if (error.code === 'permission-denied') {
            console.error(
                `[${context}] Query denied by security rules. Check firestore.rules for this collection.\n${error.message}`,
            );
        } else {
            console.error(`[${context}] Snapshot listener failed (${error.code}):`, error.message);
        }
        onDone?.(error);
    };
}
