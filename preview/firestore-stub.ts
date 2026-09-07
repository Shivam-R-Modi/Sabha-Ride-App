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
        requestsOpenTime: '10:00',
        sabhaLocation: { lat: 42.339362, lng: -71.0878001, address: '346 Huntington Ave, Boston, MA 02115' },
    },
    /**
     * ONE NOTIFICATION DELIBERATELY OFF, so the "some are switched off" banner and a
     * grey switch are both on screen. An all-defaults fixture renders the happy state
     * only, and the muted state is the one worth looking at — it is what a manager
     * sees a week after forgetting they changed something.
     */
    'settings/notifications': {
        enabled: { notice: false },
        alertBands: [48, 24, 10, 2],
        nudgeCooldownSec: 60,
        reminderHour: 10,
        reminderCadence: 'daily',
    },
};

/**
 * COLLECTION fixtures, as opposed to the single documents above.
 *
 * Added on 2026-08-25 because `snapshotFor` returned `{ docs: [], empty: true }` for
 * every query, which meant the arrivals board rendered as an empty month in the harness
 * — so a POPULATED board had never been looked at anywhere except production. The
 * calendar redesign is almost entirely about what a day with arrivals looks like, and
 * none of it was visible.
 *
 * Dates are relative to whenever the preview is built, so the fixtures never rot into
 * the past: `soon(h)` mirrors the helper in preview/airport.tsx.
 */
const soon = (hours: number) => new Date(Date.now() + hours * 3600_000);
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** One arrival, spread over the shape ArrivalCard and the board both read. */
const pickup = (id: string, at: Date, over: Record<string, unknown> = {}) => ({
    id,
    data: () => ({
        requesterUid: `rider_${id}`,
        requesterName: 'Ramesh',
        direction: 'arrival',
        arrivalDate: dayKey(at),
        arrivalTime: clock(at),
        arrivalAt: at.toISOString(),
        airportCode: 'BOS',
        airline: 'Emirates',
        flightNumber: 'EK237',
        terminal: 'E',
        isInternational: true,
        partySize: 2,
        largeBags: 4,
        cabinBags: 2,
        dropoffAddress: '360 Huntington Ave, Boston, MA 02115',
        dropoffLat: 42.34,
        dropoffLng: -71.09,
        hasUsWorkingPhone: false,
        meetingPointNote: 'By the exit doors at arrivals',
        passenger: {
            name: 'Ramesh Patel',
            dateOfBirth: '2007-04-11',
            phone: '+16175550123',
            whatsappOn: 'primary',
            email: 'ramesh@example.com',
            familyContact: {
                name: 'Bhavna Patel', relationship: 'Mother',
                phone: '+919876543210', hasWhatsapp: true,
            },
        },
        status: 'open',
        retainUntil: soon(24 * 365 * 7).toISOString(),
        createdAt: soon(-200).toISOString(),
        updatedAt: soon(-200).toISOString(),
        ...over,
    }),
});

const CLAIMED = { status: 'claimed', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark' };
const DONE = {
    status: 'completed', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark',
    completedAt: soon(-6).toISOString(),
};

const COLLECTIONS: Record<string, Array<{ id: string; data: () => unknown }>> = {
    /**
     * Approved Sarthis, so the carload board can NAME whose car a group is.
     *
     * The preview returns a uid and nothing else — the same rule as the riders — and
     * `useAvailableDrivers` is what turns it into a name. Without these the board falls
     * back to "Car 1", which is the state it is trying to improve on, so the harness
     * would show the worse of the two versions.
     *
     * `roles` and not `role`: every driver in this congregation is recorded as a
     * manager, and the hook queries the granted set for exactly that reason.
     */
    users: [
        {
            id: 'drv-1',
            data: () => ({
                name: 'Ramesh Patel', roles: ['manager', 'driver', 'student'],
                role: 'manager', accountStatus: 'approved',
                location: { latitude: 42.3405, longitude: -71.0895 },
            }),
        },
        // Holding a car with NO home address, which is what puts them on the board's
        // "cannot collect anybody" row. Dispatch refuses them outright.
        {
            id: 'drv-2',
            data: () => ({
                name: 'Nisha Trivedi', roles: ['driver', 'student'],
                role: 'driver', accountStatus: 'approved',
            }),
        },
    ],

    /**
     * The halls sabha runs at.
     *
     * TWO ACTIVE plus one RETIRED. The retired one is here because a screen that lists
     * halls has to draw that state too, and an all-active fixture renders only the happy
     * half. The SECOND ACTIVE one is here because every multi-hall control in the app —
     * the rider's hall picker, the Sarthi's per-run picker, the calendar's per-hall Edit
     * and Cancel, the carload board's picker — renders only when more than one hall is
     * open. With a single-hall fixture none of them appear, so the harness would show a
     * version of the app nobody is trying to look at.
     *
     * The founding hall's id and venue match the seeded production document, so the
     * harness shows the same address the app actually routes to.
     */
    locations: [
        {
            id: 'boston-huntington',
            data: () => ({
                name: 'Sabha', active: true, order: 0,
                venue: {
                    lat: 42.339362, lng: -71.0878001,
                    address: '346 Huntington Ave, Boston, MA 02115',
                },
            }),
        },
        {
            id: 'somerville',
            data: () => ({
                name: 'Elm Street', active: true, order: 1,
                venue: {
                    lat: 42.3875, lng: -71.0995,
                    address: '5 Elm Street, Somerville, MA 02144',
                },
            }),
        },
        {
            id: 'old-hall',
            data: () => ({
                name: 'Old Hall', active: false, order: 1,
                venue: { lat: 42.4, lng: -71.1, address: '1 Old Street, Boston, MA' },
            }),
        },
    ],
    // Deliberately one of each thing the grid has to draw differently: a day needing
    // somebody, a day fully covered, a day with a mix, a busy day whose count is
    // two digits, a landed-but-unclaimed day in the past, and — added 2026-08-25 —
    // a day whose only trip is FINISHED, which must draw no badge at all. That last
    // state existed in production and in no fixture, which is why it shipped counting
    // itself as an upcoming arrival.
    airportPickups: [
        pickup('a1', soon(20)),
        pickup('a2', soon(21)),
        pickup('b1', soon(74), CLAIMED),
        pickup('c1', soon(122)),
        pickup('c2', soon(123), CLAIMED),
        pickup('d1', soon(-30)),
        pickup('f1', soon(48), DONE),
        ...Array.from({ length: 11 }, (_, i) => pickup(`e${i}`, soon(170 + i))),
    ],
};

export const doc = (_db: unknown, ...parts: string[]): Ref => ({ path: parts.join('/') });
export const collection = (_db: unknown, name: string): Ref => ({ path: name });
export const query = (ref: Ref) => ref;
export const where = () => ({});
export const orderBy = () => ({});
export const limit = () => ({});
export const documentId = () => '__name__';

const snapshotFor = (ref: Ref) => {
    const docs = COLLECTIONS[ref.path] ?? [];
    return {
    exists: () => CANNED[ref.path] !== undefined,
    id: ref.path.split('/').pop(),
    data: () => CANNED[ref.path],
    docs,
    size: docs.length,
    empty: docs.length === 0,
    // A real QuerySnapshot is iterable. Without this, any hook that walks a
    // collection with `snap.forEach` throws and takes the whole preview tree with
    // it — which is how `useFeedback` was found to need it.
    forEach: (fn: (doc: unknown) => void) => docs.forEach(fn),
    };
};

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
