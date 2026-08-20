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
import { withdrawRideRequest } from '../../hooks/useRides';

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
        // Holding a car means driving tonight, so no lift is on offer. Same
        // definition driverDoneForToday uses for "on shift": holding a car is
        // exactly what lets a driver be assigned riders. A manager or Sarthi
        // wearing the Bhulku hat lands here, which is the point.
        onShift: !!(user as { currentVehicleId?: string }).currentVehicleId,
    }), [
        ridesLoading, attendanceLoading, hasEvent, dropoffOpen, activeRide, activeRides,
        hasResponded, justAnswered, attendance?.response, dismissedRequest,
        (user as { currentVehicleId?: string }).currentVehicleId,
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
                    // Offered ONLY while the request is still waiting. Passing it
                    // unconditionally would put a cancel button on a ride whose
                    // Sarthi is already on the way, which firestore.rules refuses —
                    // so the control would be visible and dead, the exact shape this
                    // repo keeps removing.
                    onWithdraw={
                        activeRide && activeRide.status === 'requested'
                            ? () => withdrawRideRequest(activeRide.id)
                            : undefined
                    }
                />
            );
    }
};
