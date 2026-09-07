import React, { useState } from 'react';
import { MapPin, Plus, Loader2, AlertCircle, CheckCircle2, Building2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocations } from '../../hooks/useLocations';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PlaceDetails } from '../../hooks/useGooglePlaces';
import { useConfirm } from '../shared/useConfirm';
import { messageOf } from '../../src/utils/errorText';
import { locationIdFromName } from '../../src/utils/locations';
import { previewLocationActive, setLocationActive } from '../../src/utils/cloudFunctions';
import type { SabhaLocationRecord } from '../../src/utils/locations';

/**
 * The sabha halls: which exist, where they are, and which are open.
 *
 * ── WHY THIS EXISTS NOW AND NOT BEFORE ──────────────────────────────────────────────
 *
 * Adding a hall was a script for most of this feature's life, on the owner's call that a
 * hall is not something that changes. It is a screen now because the owner asked for
 * one, and because activating the second hall turned the old single-hall assumption in
 * `LocationSettings` into a dead control: that screen only wrote a hall's venue when
 * EXACTLY ONE was open, so with two it reported "Location updated successfully!" while
 * changing nothing dispatch routes by. Per-hall editing lives here, where the hall being
 * edited is named on the row.
 *
 * ── THE TWO DECISIONS ARE SEPARATE ──────────────────────────────────────────────────
 *
 * Creating a hall and OPENING one are different acts and this screen keeps them apart,
 * because firestore.rules does: `active` is denied to every client in both directions.
 *
 *   - Adding writes the document directly, with no `active` field. It lands CLOSED, so a
 *     half-finished hall — right name, wrong address — is invisible to riders until
 *     somebody says otherwise.
 *   - Opening and closing go through `setLocationActive`, which is guarded: it refuses
 *     to close the last open hall, refuses while a Sarthi is on the road to one, and
 *     requires an explicit acknowledgement when riders are already booked.
 *
 * That last guard is the one worth understanding. A closed hall is not merely hidden:
 * `rejectionFor` refuses a ride naming a hall that is not open, so everybody booked for
 * it becomes undispatchable — every Sarthi is told nobody is waiting and nobody is ever
 * collected. Nothing throws. So the dialog says how many people that is, from the
 * server's own count, before a manager confirms.
 *
 * ── THE ID IS PERMANENT ─────────────────────────────────────────────────────────────
 *
 * A hall's document id becomes part of every `events`, `weeklyAttendance` and
 * `statistics` key it ever has. It cannot be corrected later without orphaning all of
 * them, so it is derived from the name and SHOWN before saving rather than generated
 * silently. The name itself can be changed afterwards; the id cannot.
 */

/** One hall's row: its address, and whether it is open. */
const HallRow: React.FC<{
    hall: SabhaLocationRecord;
    /** Refuse to close the last one, so the button can say why before it is pressed. */
    openCount: number;
    onChanged: () => void;
}> = ({ hall, openCount, onChanged }) => {
    const { currentUser } = useAuth();
    const { updateLocationVenue } = useLocations();
    const { ask, confirmDialog } = useConfirm();

    const [editing, setEditing] = useState(false);
    const [address, setAddress] = useState(hall.venue.address);
    const [place, setPlace] = useState<PlaceDetails | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const saveVenue = async () => {
        if (!currentUser || !place) return;
        setBusy(true);
        setError(null);
        try {
            // Only ever with coordinates. An address with no lat/lng poisons every route
            // built from it, and firestore.rules refuses it anyway — this is the readable
            // message first.
            await updateLocationVenue(hall.id, {
                lat: place.latitude, lng: place.longitude, address: place.formattedAddress,
            }, currentUser.uid);
            setEditing(false);
            setPlace(null);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
            onChanged();
        } catch (err: unknown) {
            setError(messageOf(err, 'Could not move this sabha location.'));
        } finally {
            setBusy(false);
        }
    };

    const toggleOpen = async () => {
        const next = !hall.active;
        setBusy(true);
        setError(null);
        try {
            // The SERVER's count, asked before the dialog is drawn. A number this screen
            // worked out itself could disagree with the guard that is about to run.
            const preview = await previewLocationActive(hall.id, next);

            const affected = preview.requestedRideCount > 0
                ? `${preview.requestedRideCount} ride request${preview.requestedRideCount === 1 ? '' : 's'}`
                    + ` for ${preview.requestedSeatCount} `
                    + `${preview.requestedSeatCount === 1 ? 'person' : 'people'} would stop being`
                    + ' dispatchable. Nobody would be collected, and no Sarthi would be told why.'
                : 'Nobody is booked for it right now.';

            const ok = await ask({
                title: next ? `Open ${preview.name}?` : `Close ${preview.name}?`,
                message: next
                    ? 'Riders will be able to choose this sabha, and Sarthis can be sent to it.'
                    : `${affected}\n\nRiders will no longer be able to choose it.`,
                confirmLabel: next ? 'Open it' : 'Close it',
                cancelLabel: 'Leave it',
                destructive: !next,
            });
            if (!ok) { setBusy(false); return; }

            await setLocationActive(hall.id, next, true);
            onChanged();
        } catch (err: unknown) {
            // The server's own message. It refuses for reasons a manager can act on —
            // the last open hall, a Sarthi mid-route — and a generic failure hides them.
            setError(messageOf(err, 'Could not change this sabha location.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="px-4 py-3">
            {confirmDialog}

            <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-coffee">{hall.name}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            hall.active
                                ? 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]'
                                : 'bg-cream-300 text-coffee-700'
                        }`}>
                            {hall.active ? 'Open' : 'Closed'}
                        </span>
                    </div>
                    <p className="text-xs text-coffee-500 mt-0.5 flex items-center gap-1">
                        <MapPin size={11} className="shrink-0" /> {hall.venue.address}
                    </p>
                    {/* The id, quietly. It is permanent and it is what every attendance and
                        statistics record for this hall is filed under, so somebody reading
                        the database later needs to be able to match them up. */}
                    <p className="text-[10px] text-coffee-500 mt-0.5 font-mono">{hall.id}</p>
                </div>

                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={() => { setEditing(!editing); setAddress(hall.venue.address); setError(null); }}
                        disabled={busy}
                        className="min-h-11 px-3 rounded-lg text-xs font-bold text-saffron-800 border border-saffron-800/35 hover:bg-cream-300 disabled:opacity-50"
                    >
                        {editing ? 'Cancel' : 'Move'}
                    </button>
                    <button
                        onClick={toggleOpen}
                        disabled={busy || (hall.active && openCount <= 1)}
                        title={hall.active && openCount <= 1
                            ? 'This is the only sabha location open. Open another one before closing it.'
                            : undefined}
                        className={`min-h-11 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 ${
                            hall.active
                                ? 'text-[rgb(var(--danger-text))] border border-[rgb(var(--danger))]/35 hover:bg-[rgb(var(--danger-bg))]'
                                : 'bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))]'
                        }`}
                    >
                        {busy && <Loader2 size={12} className="animate-spin" />}
                        {hall.active ? 'Close' : 'Open'}
                    </button>
                </div>
            </div>

            {/* The only-one-open case, said in words as well as by the disabled button —
                a disabled control with no explanation is a control that looks broken. */}
            {hall.active && openCount <= 1 && (
                <p className="text-xs text-coffee-500 mt-2">
                    This is the only sabha location open, so it cannot be closed. Open another
                    one first.
                </p>
            )}

            {saved && (
                <p className="text-xs text-[rgb(var(--success-text))] mt-2 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Moved.
                </p>
            )}

            {error && (
                <p className="text-xs text-[rgb(var(--danger-text))] mt-2 flex items-start gap-1">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" /> {error}
                </p>
            )}

            {editing && (
                <div className="mt-3 space-y-2">
                    <label
                        htmlFor={`hall-address-${hall.id}`}
                        className="block text-xs font-medium text-coffee-700"
                    >
                        New address for {hall.name}
                    </label>
                    <AddressAutocomplete
                        id={`hall-address-${hall.id}`}
                        value={address}
                        onChange={(val) => {
                            setAddress(val);
                            if (place && val !== place.formattedAddress) setPlace(null);
                        }}
                        onSelect={(p) => { setPlace(p); setAddress(p.formattedAddress); }}
                        disabled={busy}
                        placeholder="Search for an address…"
                    />
                    {/* SAVE STAYS DISABLED UNTIL A SUGGESTION IS PICKED, because only a
                        picked place carries coordinates — and coordinates are what every
                        route and every carload is built from. Typed text alone would be
                        refused by the rules, after the button had already said it saved. */}
                    {!place && (
                        <p className="text-xs text-coffee-500">
                            Pick an address from the suggestions — that is what provides the
                            coordinates Sarthis are routed by.
                        </p>
                    )}
                    <button
                        onClick={saveVenue}
                        disabled={busy || !place}
                        className="min-h-11 px-4 rounded-lg text-xs font-bold bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] disabled:opacity-50"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save address'}
                    </button>
                </div>
            )}
        </li>
    );
};

export const HallManagement: React.FC = () => {
    const { currentUser } = useAuth();
    const { locations, active, loading, createLocation } = useLocations();

    const [adding, setAdding] = useState(false);
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [place, setPlace] = useState<PlaceDetails | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [addedName, setAddedName] = useState<string | null>(null);

    const proposedId = locationIdFromName(name);
    const idTaken = !!proposedId && locations.some(h => h.id === proposedId);
    /**
     * A DUPLICATE NAME IS ITS OWN PROBLEM, separate from a duplicate id.
     *
     * The id is derived from the name but they drift: this project's second hall is
     * called "D Street" and saved as `south-boston`, so typing "D Street" again collides
     * on neither. The result would be two identically-named options in the rider's
     * picker with nothing to tell them apart — and a rider who picks the wrong one is
     * collected for the wrong building.
     */
    const nameTaken = name.trim() !== ''
        && locations.some(h => h.name.trim().toLowerCase() === name.trim().toLowerCase());

    const reset = () => {
        setAdding(false); setName(''); setAddress(''); setPlace(null); setError(null);
    };

    const add = async () => {
        if (!currentUser || !place || !proposedId) return;
        setBusy(true);
        setError(null);
        try {
            await createLocation(proposedId, name.trim(), {
                lat: place.latitude, lng: place.longitude, address: place.formattedAddress,
            }, currentUser.uid);
            setAddedName(name.trim());
            reset();
            setTimeout(() => setAddedName(null), 6000);
        } catch (err: unknown) {
            setError(messageOf(err, 'Could not add this sabha location.'));
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-saffron" />
            </div>
        );
    }

    return (
        <div className="bg-surface rounded-xl border border-hairline/20 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-hairline/10 bg-cream-200">
                <div className="flex items-center gap-2">
                    <Building2 size={18} className="text-saffron" />
                    <h3 className="text-sm font-bold text-coffee">Sabha locations</h3>
                </div>
                <p className="text-xs text-coffee-500 mt-1">
                    Add as many as you need. Riders choose which one they are going to, and a
                    car never mixes riders bound for different ones.
                </p>
            </div>

            {locations.length === 0 ? (
                <p className="px-4 py-6 text-sm text-coffee-500">
                    No sabha locations yet.
                </p>
            ) : (
                <ul className="divide-y divide-hairline/10">
                    {locations.map(hall => (
                        <HallRow
                            key={hall.id}
                            hall={hall}
                            openCount={active.length}
                            onChanged={() => setError(null)}
                        />
                    ))}
                </ul>
            )}

            {/* A hall lands CLOSED, so this says so before it is pressed rather than
                leaving a manager wondering why nothing happened for riders. */}
            {addedName && (
                <p className="mx-4 my-3 text-xs px-3 py-2 rounded-xl bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]">
                    <strong>{addedName}</strong> was added, and it is CLOSED. Riders cannot
                    choose it until you press Open on its row.
                </p>
            )}

            <div className="px-4 py-4 border-t border-hairline/10">
                {!adding ? (
                    <button
                        onClick={() => setAdding(true)}
                        className="min-h-11 px-4 rounded-lg text-xs font-bold flex items-center gap-1.5 text-saffron-800 border border-saffron-800/35 hover:bg-cream-300"
                    >
                        <Plus size={14} /> Add a sabha location
                    </button>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label htmlFor="new-hall-name" className="block text-xs font-medium text-coffee-700 mb-1">
                                What is it called?
                            </label>
                            <input
                                id="new-hall-name"
                                value={name}
                                onChange={(e) => { setName(e.target.value); setError(null); }}
                                disabled={busy}
                                maxLength={80}
                                placeholder="Elm Street"
                                className="w-full px-3 py-2 rounded-lg border border-hairline/20 text-sm focus:outline-none focus:border-saffron disabled:opacity-50"
                            />
                            {/* THE ID, SHOWN BEFORE SAVING. It becomes part of every events,
                                attendance and statistics key this hall ever has, and cannot
                                be corrected afterwards without orphaning all of them. The
                                name can be changed later; this cannot. */}
                            {name.trim() !== '' && (
                                <p className="text-xs text-coffee-500 mt-1">
                                    {proposedId
                                        ? <>Saved as <span className="font-mono">{proposedId}</span> — permanent, unlike the name.</>
                                        : 'That name has no letters or digits to build an id from. Try another.'}
                                </p>
                            )}
                            {idTaken && (
                                <p className="text-xs text-[rgb(var(--danger-text))] mt-1">
                                    There is already a sabha location saved as{' '}
                                    <span className="font-mono">{proposedId}</span>.
                                </p>
                            )}
                            {nameTaken && !idTaken && (
                                <p className="text-xs text-[rgb(var(--danger-text))] mt-1">
                                    There is already a sabha location called &ldquo;{name.trim()}&rdquo;.
                                    Riders would see the same name twice with no way to tell them
                                    apart.
                                </p>
                            )}
                        </div>

                        <div>
                            <label htmlFor="new-hall-address" className="block text-xs font-medium text-coffee-700 mb-1">
                                Where is it?
                            </label>
                            <AddressAutocomplete
                                id="new-hall-address"
                                value={address}
                                onChange={(val) => {
                                    setAddress(val);
                                    if (place && val !== place.formattedAddress) setPlace(null);
                                }}
                                onSelect={(p) => { setPlace(p); setAddress(p.formattedAddress); }}
                                disabled={busy}
                                placeholder="Search for an address…"
                            />
                            {!place && (
                                <p className="text-xs text-coffee-500 mt-1">
                                    Pick one from the suggestions — that is what provides the
                                    coordinates Sarthis are routed by.
                                </p>
                            )}
                        </div>

                        {error && (
                            <p className="text-xs text-[rgb(var(--danger-text))] flex items-start gap-1">
                                <AlertCircle size={12} className="shrink-0 mt-0.5" /> {error}
                            </p>
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={add}
                                disabled={busy || !place || !proposedId || idTaken || nameTaken || name.trim() === ''}
                                className="min-h-11 px-4 rounded-lg text-xs font-bold bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] disabled:opacity-50"
                            >
                                {busy ? <Loader2 size={14} className="animate-spin" /> : 'Add it, closed'}
                            </button>
                            <button
                                onClick={reset}
                                disabled={busy}
                                className="min-h-11 px-4 rounded-lg text-xs font-bold text-coffee-700 border border-hairline/20"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
