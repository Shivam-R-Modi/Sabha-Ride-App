// Stand-in for `firebase/firestore` in the visual harness.
//
// The hook stubs cover the hooks, but a component may hold its own listener —
// RecurringSabha subscribes to `settings/sabhaRecurrence` directly, so the whole
// manager page threw "Expected first argument to doc() to be a
// CollectionReference" against the stubbed `db` and rendered nothing at all.
//
// Deliberately dumb: a reference is a path string, a snapshot is canned data for
// that path, and every write resolves. Enough to LOOK at a screen; the tests are
// what prove behaviour.

type Ref = { path: string };

const CANNED: Record<string, unknown> = {
    'settings/sabhaRecurrence': {
        enabled: true, daysOfWeek: [5], startTime: '20:30', endTime: '22:00',
        venue: null, agenda: '',
    },
    'settings/main': {
        sabhaStartTime: '20:30', sabhaEndTime: '22:00',
        sabhaLocation: { lat: 42.339362, lng: -71.0878001, address: '346 Huntington Ave, Boston, MA 02115' },
    },
};

export const doc = (_db: unknown, ...parts: string[]): Ref => ({ path: parts.join('/') });
export const collection = (_db: unknown, name: string): Ref => ({ path: name });
export const query = (ref: Ref) => ref;
export const where = () => ({});
export const orderBy = () => ({});
export const limit = () => ({});
export const documentId = () => '__name__';

const snapshotFor = (ref: Ref) => ({
    exists: () => CANNED[ref.path] !== undefined,
    id: ref.path.split('/').pop(),
    data: () => CANNED[ref.path],
    docs: [] as unknown[],
    size: 0,
    empty: true,
    // A real QuerySnapshot is iterable. Without this, any hook that walks a
    // collection with `snap.forEach` throws and takes the whole preview tree with
    // it — which is how `useFeedback` was found to need it.
    forEach: (_fn: (doc: unknown) => void) => undefined,
});

export const onSnapshot = (ref: Ref, next: (snap: unknown) => void) => {
    next(snapshotFor(ref));
    return () => undefined;
};
export const getDoc = async (ref: Ref) => snapshotFor(ref);
export const getDocs = async (ref: Ref) => snapshotFor(ref);
export const setDoc = async () => undefined;

/**
 * Writes go nowhere — except that a write to a user document is echoed on the
 * window, so auth-stub can feed it back as a profile change.
 *
 * Without this the harness could show a drag starting and could not show it
 * finishing: `AuthContext` is what carries a saved tab order back to the
 * sidebar, and a stub that swallows the write leaves the list frozen. A preview
 * that cannot tell a working reorder from a broken one is worse than no preview.
 */
export const updateDoc = async (ref: Ref, data: Record<string, unknown>) => {
    if (ref.path.startsWith('users/')) {
        window.dispatchEvent(new CustomEvent('preview:userWrite', { detail: data }));
    }
};
export const deleteDoc = async () => undefined;
export const addDoc = async () => ({ id: 'preview' });
export const serverTimestamp = () => new Date().toISOString();
export const Timestamp = { now: () => ({ toDate: () => new Date() }) };
export const arrayUnion = (...v: unknown[]) => v;
export const arrayRemove = (...v: unknown[]) => v;
export const deleteField = () => '__DELETE__';
export const increment = (n: number) => n;
export const writeBatch = () => ({
    set: () => undefined, update: () => undefined, delete: () => undefined,
    commit: async () => undefined,
});
export const runTransaction = async (_db: unknown, fn: (tx: unknown) => unknown) => fn({
    get: async (ref: Ref) => snapshotFor(ref),
    set: () => undefined, update: () => undefined, delete: () => undefined,
});
export const startAfter = (...a: unknown[]) => a;
