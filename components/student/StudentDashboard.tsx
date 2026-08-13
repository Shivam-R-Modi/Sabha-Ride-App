import React, { useState, useEffect, useMemo } from 'react';
import { User, Driver } from '../../types';
import { MyRides } from '../MyRides';
import {
    useActiveRide, useStudentRequestStatus, useWeeklyAttendance, useRideHistory,
} from '../../hooks/useFirestore';
import { useNavigation } from '../../contexts/NavigationContext';
import { useRideWindow } from '../../hooks/useRideWindow';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { ProfileEditor } from '../shared/ProfileEditor';
import { RiderHome } from './RiderHome';
import { deriveRiderState } from '../../src/utils/riderState';

interface StudentDashboardProps {
    user: User | Driver;
    onLogout?: () => void;
}

/**
 * Routing and data for the rider. What to SHOW is decided by
 * `deriveRiderState`; how to draw it is `RiderHome`.
 *
 * This file used to do all three, and the mixing is what let two full-screen
 * interstitials — the attendance question and the "you said no" screen — sit as
 * early returns that replaced the entire dashboard. Both are gone: the question
 * is now a card among the others, and answering "not this time" collapses it
 * rather than taking the app away.
 */
export const StudentDashboard: React.FC<StudentDashboardProps> = ({ user }) => {
    const { currentTab } = useNavigation();

    const { dropoffOpen } = useRideWindow();
    const { hasEvent } = useCurrentEvent();
    const { activeRide, activeRides, loading: ridesLoading } = useActiveRide(user.id);
    const { dismissedRequest } = useStudentRequestStatus(user.id);
    const { attendance, loading: attendanceLoading, hasResponded } = useWeeklyAttendance(user.id);
    const { rides: rideHistory, loading: historyLoading, hasMore, loadMore } =
        useRideHistory(user.id, 10);

    /**
     * The answer this device has just given, which is ahead of the Firestore
     * listener by a round trip. Without it the card would snap back to the
     * question for a moment after answering.
     */
    const [justAnswered, setJustAnswered] = useState<'yes' | 'no' | null>(null);

    // Once the listener catches up, stop overriding it — otherwise an answer
    // changed on another device would never be reflected here.
    useEffect(() => {
        if (hasResponded && attendance?.response === justAnswered) setJustAnswered(null);
    }, [hasResponded, attendance?.response, justAnswered]);

    const state = useMemo(() => deriveRiderState({
        loading: ridesLoading || attendanceLoading,
        hasEvent,
        dropoffOpen,
        activeRide,
        activeRides,
        hasResponded: hasResponded || justAnswered !== null,
        attendanceResponse: justAnswered ?? attendance?.response ?? null,
        dismissedRequest,
    }), [
        ridesLoading, attendanceLoading, hasEvent, dropoffOpen, activeRide, activeRides,
        hasResponded, justAnswered, attendance?.response, dismissedRequest,
    ]);

    switch (currentTab) {
        case 'rides':
            return (
                <MyRides
                    history={rideHistory}
                    upcoming={activeRide ? [activeRide] : []}
                    onLoadMore={loadMore}
                    hasMoreHistory={hasMore}
                    loadingMore={historyLoading}
                />
            );
        case 'profile':
            return <ProfileEditor />;
        default:
            return (
                <RiderHome
                    user={user}
                    state={state}
                    ride={activeRide ?? null}
                    onAttendanceAnswered={setJustAnswered}
                />
            );
    }
};
