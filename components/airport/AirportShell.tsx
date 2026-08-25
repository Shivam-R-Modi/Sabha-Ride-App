import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useMyLiveArrival } from '../../hooks/useArrivals';
import { hasGrantedRole } from '../../src/roles';
import { ProfileEditor } from '../shared/ProfileEditor';
import { ArrivalBoard } from './ArrivalBoard';
import { ArrivalRequestForm } from './ArrivalRequestForm';
import { ArrivalStatusCard } from './ArrivalStatusCard';

/**
 * Airport Seva's own router.
 *
 * Sits beside the sabha branch in App, never inside it, which is what keeps the two
 * services separate: the existing screens are not edited to make room for this one,
 * and nothing here can be reached from a sabha tab.
 *
 * It switches on the SAME `currentTab` as the sabha side, which is safe for one
 * reason: `setService` resets `currentTab` to the new service's home, so this switch
 * can never be handed 'people' or 'fleet' and the sabha switches can never be handed
 * an airport value. See the note on `TabView` in types.ts.
 *
 * `default` lands on whatever this person can actually use rather than on a fixed
 * screen — a Bhulku has no board, so defaulting everyone to it would open the service
 * on a page half the users cannot read.
 */
export const AirportShell: React.FC = () => {
    const { userProfile } = useAuth();
    const { currentTab } = useNavigation();

    const canSeeBoard = hasGrantedRole(userProfile, 'driver');

    switch (currentTab) {
        case 'airport-board':
            // Guarded, not assumed. A Bhulku reaching this tab would otherwise get a
            // board whose every query the rules refuse — an empty screen that looks
            // like "nobody is arriving".
            return canSeeBoard ? <ArrivalBoard /> : <TravellerView />;
        case 'airport-request':
            return <TravellerView />;
        case 'profile':
            return <ProfileEditor />;
        default:
            return canSeeBoard ? <ArrivalBoard /> : <TravellerView />;
    }
};

/**
 * The traveller's half: their live request if they have one, the form if they do not.
 *
 * One screen rather than two tabs, because "ask for a pickup" and "is somebody coming"
 * are the same question at different times, and a person with a live request has no
 * use for a second form — `requestAirportPickup` would refuse it anyway.
 *
 * `resetKey` remounts the form after a cancel. Without it the previous answers would
 * still be sitting in its state, which reads as though the cancel had not happened.
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

    // Said out loud rather than silently showing the form. Rendering a blank request
    // form when the read failed invites somebody to file a second request they already
    // have, and then be told they cannot.
    if (error) {
        return (
            <div className="p-6" role="alert">
                <div className="clay-card p-4 text-sm font-bold text-[rgb(var(--danger))]">
                    {error}
                </div>
            </div>
        );
    }

    if (arrival) {
        return (
            <ArrivalStatusCard
                arrival={arrival}
                onCancelled={() => setResetKey(k => k + 1)}
            />
        );
    }

    return <ArrivalRequestForm key={resetKey} onSubmitted={() => setResetKey(k => k + 1)} />;
};
