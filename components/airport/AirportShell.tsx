import React, { useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../shared/useConfirm';
import { useMyLiveArrival } from '../../hooks/useArrivals';
import { ProfileEditor } from '../shared/ProfileEditor';
import { ArrivalBoard } from './ArrivalBoard';
import { ArrivalRequestForm } from './ArrivalRequestForm';
import { ArrivalStatusCard } from './ArrivalStatusCard';

/**
 * Airport Seva — TWO surfaces, chosen by the tab.
 *
 * A TRAVELLER gets one screen plus their profile: their own pickup. Everybody ELSE who
 * can be here — a Sarthi or a manager, both of whom arrived by switching — gets the
 * ARRIVALS BOARD plus their profile. This is the only home the board has.
 *
 * The switching half of this used to be `TravellerView` as well, which meant a manager's
 * Airport Seva was a screen built for somebody else: a live form that would file a real
 * pickup request in their own name, and an "I am in the USA now" button that wrote
 * `isArriving: false` where it was already false and therefore did nothing visible. A
 * control that fires and changes nothing is this codebase's signature defect.
 *
 * NO ROLE CHECK HERE, deliberately. The tab is the only thing consulted, and
 * `tabBelongsTo` in src/constants/service.ts is what guarantees a traveller can never be
 * on 'arrivals' and a Sarthi never on 'airport-request'. One place decides, so the nav
 * and the screen cannot disagree — and a Bhulku, who has no switch at all, cannot land
 * on a board whose every query the rules would refuse.
 */
export const AirportShell: React.FC = () => {
    const { currentTab } = useNavigation();

    if (currentTab === 'profile') return <ProfileEditor />;
    if (currentTab === 'arrivals') return <ArrivalBoard />;
    return <TravellerView />;
};

/**
 * Their live request if they have one, the form if they do not.
 *
 * One screen rather than two tabs, because "ask for a pickup" and "is somebody coming"
 * are the same question at different times, and somebody with a live request has no use
 * for a second form — `requestAirportPickup` would refuse it anyway.
 *
 * `resetKey` remounts the form after a cancel. Without it the previous answers would
 * still be in its state, which reads as though the cancel had not happened.
 */
const TravellerView: React.FC = () => {
    const { arrival, loading, error } = useMyLiveArrival();
    const [resetKey, setResetKey] = useState(0);

    if (loading) {
        return (
            <div className="p-6 flex items-center gap-2 text-sm text-coffee-500">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Loading your pickup…
            </div>
        );
    }

    // Said out loud rather than silently showing the form. A blank request form when the
    // read failed invites somebody to file a second request they already have, and then
    // be told they cannot.
    if (error) {
        return (
            <div className="p-6" role="alert">
                <div className="clay-card p-4 text-sm font-bold text-[rgb(var(--danger-text))]">
                    {error}
                </div>
            </div>
        );
    }

    return (
        <>
            {arrival
                ? <ArrivalStatusCard arrival={arrival} onCancelled={() => setResetKey(k => k + 1)} />
                : <ArrivalRequestForm key={resetKey} onSubmitted={() => setResetKey(k => k + 1)} />}
            <AlreadyArrived />
        </>
    );
};

/**
 * The door out, and it is always here.
 *
 * The server clears `isArriving` when a Sarthi marks the trip dropped off — but a Sarthi
 * who forgets that last tap would otherwise leave a real person in an app with no way to
 * book a lift to sabha and no way to fix it themselves. That is the stranded-user
 * failure this codebase keeps removing, so there are two independent routes out and this
 * is the one that needs nobody else.
 *
 * Rendered below whatever they are looking at rather than only on a finished trip: it is
 * also the escape for somebody who picked the wrong option at signup, or who came in on
 * an earlier flight than the one they filed.
 *
 * A plain `updateDoc` on their own document. `isArriving` is not a privilege field —
 * see the note on it in types.ts — so no callable is needed, and needing one would mean
 * needing a manager awake.
 */
const AlreadyArrived: React.FC = () => {
    const { currentUser } = useAuth();
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const [busy, setBusy] = useState(false);

    const confirmArrived = async () => {
        const ok = await ask({
            title: 'You are in the USA?',
            message: 'This swaps you over to Sabha Seva, so you can start asking for lifts '
                + 'to sabha. You will be asked for your address here.',
            confirmLabel: 'Yes, I have arrived',
        });
        if (!ok || !currentUser) return;

        setBusy(true);
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { isArriving: false });
            // No navigation call. AuthContext holds an onSnapshot on this document, so
            // the write comes straight back as a profile change and the shell re-renders
            // into Sabha Seva on its own.
            toast.success('Welcome. Jai Swaminarayan.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'That could not be saved');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="px-4 lg:px-6 pb-6 max-w-2xl mx-auto">
            <button
                type="button"
                onClick={confirmArrived}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                           bg-cream-400 text-coffee text-sm font-bold hover:bg-saffron/15
                           transition-colors min-h-11 disabled:opacity-60"
            >
                <MapPin size={16} aria-hidden="true" />
                {busy ? 'Saving…' : 'I am in the USA now'}
            </button>
            <p className="text-xs text-coffee-500 text-center mt-2">
                Tap this once you have landed and settled in.
            </p>
            {confirmDialog}
        </div>
    );
};
