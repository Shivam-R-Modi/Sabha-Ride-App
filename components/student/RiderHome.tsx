import React, { useState } from 'react';
import { User, Driver } from '../../types';
import {
    Car, Navigation, AlertCircle, Phone, CheckCircle2, Clock, CalendarX, Loader2,
} from 'lucide-react';
import { RideStatusCard } from '../RideStatus';
import { PickupForm } from '../PickupForm';
import { Sheet } from '../shared/Sheet';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../shared/useConfirm';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { submitWeeklyAttendance, updateAttendanceResponse } from '../../hooks/useFirestore';
import { studentReadyToLeave } from '../../src/utils/cloudFunctions';
import { useSettings } from '../../hooks/useSettings';
import { getCurrentPosition } from '../../src/utils/location';
import {
    judgeFix, venueFor, PRESENCE_FIX_TIMEOUT_MS,
    type PresenceClaim, type Verdict,
} from '../../src/utils/presence';
import type { RiderState, SplitInfo, DismissedInfo } from '../../src/utils/riderState';

/**
 * The rider's home screen: ONE card, ONE action.
 *
 * What this replaces: five stacked cards and two competing primary buttons, plus
 * two full-screen interstitials that hijacked the whole dashboard to ask a
 * yes/no question. The screen now answers exactly one question — "what is
 * happening with my ride?" — and carries only the action that belongs to the
 * answer.
 *
 * Which card shows is decided in src/utils/riderState.ts, not here, so the
 * priority order between overlapping states is reviewable and tested. This file
 * only draws them.
 */

interface RiderHomeProps {
    user: User | Driver;
    state: RiderState;
    /** The active ride, for the states that render one. */
    ride: React.ComponentProps<typeof RideStatusCard>['ride'] | null;
    onAttendanceAnswered: (response: 'yes' | 'no') => void;
}

/** Shared frame so every state reads as the same object changing, not a new page. */
const StateCard: React.FC<{
    tone?: 'default' | 'accent' | 'warning' | 'danger';
    children: React.ReactNode;
}> = ({ tone = 'default', children }) => (
    <div className={tone === 'accent' ? 'clay-card-accent' : 'clay-card'}>{children}</div>
);

const CardHead: React.FC<{
    icon: React.ReactNode;
    title: string;
    detail?: string;
}> = ({ icon, title, detail }) => (
    <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-cream-300/70 flex items-center justify-center
                        text-saffron shrink-0">
            {icon}
        </div>
        <div className="min-w-0 flex-1">
            <h2 className="font-header font-bold text-coffee text-lg leading-tight">{title}</h2>
            {detail && <p className="text-sm text-coffee-500 mt-1 leading-snug">{detail}</p>}
        </div>
    </div>
);

export const RiderHome: React.FC<RiderHomeProps> = ({
    user, state, ride, onAttendanceAnswered,
}) => {
    const toast = useToast();
    const { ask, confirmDialog } = useConfirm();
    const { eventId, hasEvent, canWithdraw, venue } = useCurrentEvent();
    const { sabhaLocation } = useSettings();

    const [requestOpen, setRequestOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const eventLabel = (() => {
        if (!eventId) return '';
        const [y, m, d] = eventId.split('-').map(Number);
        return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            .format(new Date(Date.UTC(y, m - 1, d, 12)));
    })();

    const answerAttendance = async (response: 'yes' | 'no') => {
        if (!eventId) {
            toast.error('No sabha is scheduled yet.');
            return;
        }
        setBusy(true);
        try {
            await submitWeeklyAttendance(
                user.id, response,
                { name: user.name, phone: (user as User).phone, address: user.address },
                eventId,
            );
            onAttendanceAnswered(response);
            // Straight into booking, because that is what "yes" means next.
            if (response === 'yes') setRequestOpen(true);
        } catch (error) {
            console.error('Error submitting attendance:', error);
            toast.error(error instanceof Error ? error.message : 'Could not save your answer.');
        } finally {
            setBusy(false);
        }
    };

    const changeOfHeart = async () => {
        if (!eventId) return;
        setBusy(true);
        try {
            // no → yes is always allowed; canWithdraw only gates yes → no.
            const result = await updateAttendanceResponse(user.id, 'yes', 'no', eventId, canWithdraw);
            if (result.success) {
                onAttendanceAnswered('yes');
            } else {
                toast.error(result.error || 'Could not change your answer.');
            }
        } catch (error) {
            console.error('Error updating response:', error);
            toast.error('Could not change your answer. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    /**
     * Establish that this rider is at the sabha, then join the drop-off queue.
     *
     * Three routes in, in order of how little they bother the rider:
     *
     *  1. Their pickup completed, so they are here by definition — no prompt.
     *  2. A GPS fix inside 100m confirms it — no prompt.
     *  3. Otherwise they are asked. This is the ordinary indoor path, not a
     *     failure: a phone under a roof usually falls back to Wi-Fi positioning
     *     accurate to tens of metres at best, and the venue pin is geocoded from
     *     a street address.
     *
     * Route 3 is offered even when GPS is confident the rider is far away. That
     * is deliberate and the whole reason this is advisory: a rider stranded at
     * the temple with no way to ask for a lift is worse than a driver making one
     * wasted stop. What GPS said is recorded either way, so an implausible claim
     * is visible to a manager without anyone having been blocked.
     */
    const establishPresence = async (): Promise<PresenceClaim | null> => {
        // Widened deliberately: the prop is `User | Driver`, and Driver's status
        // union has no overlap with the rider statuses. The value on the wire is
        // the same string either way.
        if ((user as { status?: string }).status === 'at_sabha') return { method: 'pickup' };

        // The gathering's own venue wins: a manager can move one sabha, and
        // measuring that evening against the standing default would put every
        // rider kilometres out and take the check down for the whole night.
        const target = venueFor(venue, sabhaLocation);
        let verdict: Verdict | null = null;

        if (target) {
            try {
                const fix = await getCurrentPosition({
                    enableHighAccuracy: true,
                    // Short. A rider indoors should be asked, not left watching a
                    // spinner while the phone hunts for satellites it cannot see.
                    timeout: PRESENCE_FIX_TIMEOUT_MS,
                    maximumAge: 0,
                });
                verdict = judgeFix(fix, target);
            } catch (error) {
                // Denied, unavailable or timed out. All the same to us: ask.
                console.info('[RiderHome] No usable fix, asking instead:', error);
            }
        }

        if (verdict?.confirmed) {
            return { method: 'auto', distanceMeters: verdict.distanceMeters };
        }

        const here = await ask({
            title: 'Are you at the sabha?',
            message: 'Your driver will be told to head for the pickup point.',
            confirmLabel: 'Yes, I am here',
            cancelLabel: 'Not yet',
        });
        if (!here) return null;

        return {
            method: 'manual',
            ...(verdict ? { distanceMeters: verdict.distanceMeters } : {}),
        };
    };

    const askToLeave = async () => {
        setBusy(true);
        try {
            const presence = await establishPresence();
            if (!presence) return;

            // Confirmed without asking, so they have not yet been told what this
            // does. Everyone else answered "Are you at the sabha?", which said it.
            if (presence.method !== 'manual') {
                const ok = await ask({
                    title: 'Ready for pickup?',
                    message: 'Your driver will be told to head for the pickup point.',
                    confirmLabel: 'Yes, tell them',
                    cancelLabel: 'Not yet',
                });
                if (!ok) return;
            }

            await studentReadyToLeave(user.id, presence);
        } catch (error) {
            // The server's own words, not a generic retry prompt.
            //
            // This used to be a flat "Could not let your driver know. Please try
            // again." for every failure, which discarded the one thing the rider
            // needed — "your home address is not set", "drop-off is not open yet"
            // — and advised the single action that could never help.
            console.error('Error marking ready to leave:', error);
            toast.error(error instanceof Error && error.message
                ? error.message
                : 'Could not let your driver know. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    const card = () => {
        switch (state.kind) {
            case 'loading':
                return <SkeletonCard />;

            case 'no-sabha':
                return (
                    <StateCard>
                        <CardHead
                            icon={<CalendarX size={22} />}
                            title="No sabha scheduled yet"
                            detail="Once a date is set you will be able to ask for a ride here."
                        />
                    </StateCard>
                );

            case 'dismissed':
                return <DismissedCard info={state.info} />;

            case 'attendance-unanswered':
                return (
                    <StateCard tone="accent">
                        <CardHead
                            icon={<CheckCircle2 size={22} />}
                            title={eventLabel ? `Sabha on ${eventLabel}` : 'Sabha this week'}
                            detail="Are you coming? This is how we know how many cars to plan for."
                        />
                        {/* Stacked, not side by side. At phone width "Not this
                            time" wrapped onto two lines inside a half-width
                            button, and the pair read as equally weighted — but
                            one of them is the answer almost everyone gives. */}
                        <div className="flex flex-col gap-2 mt-5">
                            <button
                                onClick={() => answerAttendance('yes')}
                                disabled={busy || !hasEvent}
                                className="clay-button-primary w-full disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="animate-spin" size={18} /> : "Yes, I'm coming"}
                            </button>
                            <button
                                onClick={() => answerAttendance('no')}
                                disabled={busy || !hasEvent}
                                className="clay-button-secondary w-full disabled:opacity-50"
                            >
                                Not this time
                            </button>
                        </div>
                    </StateCard>
                );

            case 'not-coming':
                return (
                    <StateCard>
                        <CardHead
                            icon={<CalendarX size={22} />}
                            title="You're not coming this week"
                            detail="No ride will be arranged. You can still change your mind."
                        />
                        <button
                            onClick={changeOfHeart}
                            disabled={busy}
                            className="clay-button-secondary w-full mt-5 disabled:opacity-50"
                        >
                            {busy ? 'Just a moment…' : "Actually, I'm coming"}
                        </button>
                    </StateCard>
                );

            case 'can-request':
                return (
                    <StateCard tone="accent">
                        <CardHead
                            icon={<Car size={22} />}
                            title={eventLabel ? `Sabha on ${eventLabel}` : 'Next sabha'}
                            detail="Ask for a lift and a sevak will pick you up from home."
                        />
                        <button
                            onClick={() => setRequestOpen(true)}
                            className="clay-button-primary w-full mt-5"
                        >
                            Request a ride
                        </button>
                    </StateCard>
                );

            case 'waiting-for-driver':
                return (
                    <StateCard>
                        <CardHead
                            icon={<Clock size={22} />}
                            title="Looking for a driver"
                            detail="Your request is in. We will show the driver's name here as soon as one takes it."
                        />
                    </StateCard>
                );

            case 'driver-assigned':
                return (
                    <div className="space-y-3">
                        {state.split && <SplitNotice split={state.split} />}
                        {ride && <RideStatusCard ride={ride} />}
                    </div>
                );

            case 'ready-to-leave':
                return (
                    <StateCard tone="accent">
                        <CardHead
                            icon={<Navigation size={22} />}
                            title="Ready to go home?"
                            detail="Tell your sevak and they will come to the pickup point."
                        />
                        <button
                            onClick={askToLeave}
                            disabled={busy}
                            className="clay-button-primary w-full mt-5 disabled:opacity-50"
                        >
                            {busy ? 'Telling them…' : "I'm ready to leave"}
                        </button>
                    </StateCard>
                );

            case 'in-dropoff-queue':
                return (
                    <StateCard>
                        <CardHead
                            icon={<CheckCircle2 size={22} />}
                            title="You're in the queue"
                            detail="Your sevak knows you are ready. Please wait near the pickup point."
                        />
                    </StateCard>
                );
        }
    };

    return (
        <div className="px-4 pt-6 pb-6 space-y-5 animate-in fade-in duration-300">
            <header>
                <h1 className="text-2xl font-header font-bold text-coffee">Jai Swaminarayan!</h1>
                <p className="text-coffee-700 text-sm">{user.name}</p>
            </header>

            {card()}

            {/* Was a full card competing for attention with the real action. It is
                a hint, so it looks like one. */}
            {state.kind === 'can-request' && (
                <p className="text-xs text-coffee-500 text-center px-6 leading-relaxed">
                    Please ask by Thursday evening so a driver can be arranged for your area.
                </p>
            )}

            <Sheet
                open={requestOpen}
                onClose={() => setRequestOpen(false)}
                title="Request a ride"
                variant="sheet"
                maxWidth="max-w-lg"
            >
                <PickupForm
                    user={user}
                    embedded
                    onClose={() => setRequestOpen(false)}
                    onSubmit={() => setRequestOpen(false)}
                />
            </Sheet>

            {confirmDialog}
        </div>
    );
};

const SkeletonCard: React.FC = () => (
    // Shaped like the card that replaces it, so nothing jumps when data lands.
    <div className="clay-card" aria-busy="true" aria-label="Loading your ride">
        <div className="flex items-start gap-4 animate-pulse">
            <div className="w-12 h-12 rounded-2xl bg-cream-300 shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 bg-cream-300 rounded w-2/3" />
                <div className="h-3 bg-cream-300 rounded w-full" />
            </div>
        </div>
        <div className="h-12 bg-cream-300 rounded-full mt-5 animate-pulse" />
    </div>
);

const SplitNotice: React.FC<{ split: SplitInfo }> = ({ split }) => (
    <div className="clay-card border-l-4 border-l-[rgb(var(--warning))]">
        <p className="font-bold text-coffee text-sm">
            {split.assignedSeats} of your {split.totalSeats} seats
            {split.driverName ? ` are with ${split.driverName}` : ' have a car'}.
        </p>
        <p className="text-xs text-coffee-500 mt-1 leading-relaxed">
            The other {split.waitingSeats} {split.waitingSeats === 1 ? 'is' : 'are'} still waiting
            for the next car — no car is big enough to take you all at once. Please decide between
            you who travels first.
        </p>
    </div>
);

const DismissedCard: React.FC<{ info: DismissedInfo }> = ({ info }) => (
    <div className="clay-card border-l-4 border-l-[rgb(var(--danger))]">
        <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[rgb(var(--danger-bg))]
                            text-[rgb(var(--danger-text))] flex items-center justify-center shrink-0">
                <AlertCircle size={22} />
            </div>
            <div className="min-w-0 flex-1">
                <h2 className="font-header font-bold text-lg text-[rgb(var(--danger-text))] leading-tight">
                    Your request was turned down
                </h2>
                <p className="text-sm text-coffee-700 mt-1 leading-snug">
                    {info.managerName
                        ? `${info.managerName} could not fit you in this week.`
                        : 'A coordinator could not fit you in this week.'}
                </p>
                {info.dismissedAt && (
                    <p className="text-xs text-coffee-500 mt-2">
                        {new Date(info.dismissedAt).toLocaleString()}
                    </p>
                )}
            </div>
        </div>
        {info.managerContact && (
            <a
                href={`tel:${info.managerContact}`}
                className="clay-button-secondary w-full mt-5 no-underline"
            >
                <Phone size={16} />
                Call the coordinator
            </a>
        )}
    </div>
);
