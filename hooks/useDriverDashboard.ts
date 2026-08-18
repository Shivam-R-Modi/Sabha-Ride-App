
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Ride, DriverAssignment } from '../types';
import { handleSnapshotError } from '../src/utils/firestoreErrors';
import { useSettings } from './useSettings';
import { useCurrentEvent } from './useCurrentEvent';

/**
 * The venue address to show a driver, in order of specificity.
 *
 * This used to keep its OWN `settings/main` listener and fall back to a
 * hardcoded constant, which made it a third independent opinion about where
 * sabha is. It now composes the two hooks that already exist.
 *
 * A ride's own snapshotted venue still wins over this — see the call sites — so a
 * driver mid-route never has their destination change under them.
 */
function useDefaultVenueAddress(): string {
    const { sabhaLocation } = useSettings();
    const { event } = useCurrentEvent();

    return event?.venue?.address || sabhaLocation.address;
}

// --- Driver Dashboard Data ---

export const useDriverAssignments = (driverId: string) => {
    const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
    const [loading, setLoading] = useState(true);
    const venueAddress = useDefaultVenueAddress();

    useEffect(() => {
        if (!driverId) return;

        // Watch for rides where I am the pickup driver or the return driver
        const q = query(
            collection(db, 'rides'),
            where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'completed'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const pickupRides: Ride[] = [];
            const dropoffRides: Ride[] = [];

            snapshot.forEach(doc => {
                const ride = { id: doc.id, ...doc.data() } as Ride;
                // Pickup check
                if (ride.driver?.id === driverId) {
                    pickupRides.push(ride);
                }
                // Dropoff check
                if (ride.returnDriver?.id === driverId) {
                    dropoffRides.push(ride);
                }
            });

            const newAssignments: DriverAssignment[] = [];

            // Group Pickup Rides into one Assignment (Simplified: All current pickups are one round)
            // In a real app, you'd group by Date/TimeSlot
            const activePickups = pickupRides.filter(r => r.status !== 'completed' && r.status !== 'cancelled');
            if (activePickups.length > 0) {
                newAssignments.push({
                    id: 'pickup_round_1',
                    type: 'pickup',
                    date: activePickups[0].date,
                    status: 'active',
                    passengers: activePickups.map((r, idx) => ({
                        ...r, // ride has studentId, studentName etc? No, User details are spread or fetched. 
                        // Simplified: Assuming ride stores student snapshot. If not, we map what we have.
                        id: r.id, // Using Ride ID as passenger key for now to avoid complexity
                        name: (r as any).studentName || "Student",
                        address: r.pickupAddress,
                        phone: (r as any).studentPhone || "",
                        avatarUrl: (r as any).studentAvatarUrl || "",
                        stopStatus: r.status === 'completed' ? 'completed' : 'pending',
                        sequenceOrder: idx + 1,
                        eta: '5:30 PM'
                    })),
                    totalDistance: `${activePickups.length * 2.5} mi`,
                    totalTime: `${activePickups.length * 10} min`,
                    // The venue snapshotted on the ride wins. A driver already on
                    // the road must not have their destination change because a
                    // manager edited the next gathering.
                    venueAddress: (activePickups[0] as any)?.venue?.address || venueAddress
                });
            }

            // Group Dropoff Rides
            // For dropoff, these are rides where isReadyToLeave is true and returnDriver is me
            const activeDropoffs = dropoffRides.filter(r => r.isReadyToLeave);
            if (activeDropoffs.length > 0) {
                newAssignments.push({
                    id: 'dropoff_round_1',
                    type: 'dropoff',
                    date: activeDropoffs[0].date,
                    status: 'pending',
                    passengers: activeDropoffs.map((r, idx) => ({
                        id: r.id,
                        name: (r as any).studentName || "Student",
                        address: r.pickupAddress, // Destination is home
                        phone: (r as any).studentPhone || "",
                        avatarUrl: (r as any).studentAvatarUrl || "",
                        stopStatus: 'pending',
                        sequenceOrder: idx + 1,
                        eta: '8:30 PM'
                    })),
                    totalDistance: `${activeDropoffs.length * 3} mi`,
                    totalTime: `${activeDropoffs.length * 12} min`,
                    venueAddress: (activeDropoffs[0] as any)?.venue?.address || venueAddress
                });
            }

            setAssignments(newAssignments);
            setLoading(false);
        }, handleSnapshotError('useDriverDashboard', () => setLoading(false)));

        return unsubscribe;
        // `venueAddress` belongs here, and leaving it out was a real bug rather
        // than a lint technicality.
        //
        // It resolves through useSettings(), which starts at
        // DEFAULT_SABHA_LOCATION and only becomes the real venue once the
        // settings snapshot lands. With `[driverId]` alone this effect captured
        // whatever the address was at subscribe time — in practice the
        // placeholder — and never re-ran, so a drop-off ride carrying no venue of
        // its own showed the driver 360 Huntington Ave for the life of the
        // listener. That placeholder was live in production until 2026-08-18.
        //
        // Re-subscribing on a venue change is cheap: it is a string, so this fires
        // when settings first load and again only if a manager moves the venue.
    }, [driverId, venueAddress]);

    return { assignments, loading };
};
