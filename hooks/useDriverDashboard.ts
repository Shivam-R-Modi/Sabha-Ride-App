
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { Ride, DriverAssignment } from '../types';
import { VENUE_ADDRESS } from '../constants';

/**
 * Fetch the Sabha venue address from Firestore settings/main.
 * Falls back to the hardcoded VENUE_ADDRESS constant.
 */
function useVenueAddress(): string {
    const [venueAddr, setVenueAddr] = useState(VENUE_ADDRESS);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'settings', 'main'),
            (snap) => {
                if (snap.exists()) {
                    const addr = snap.data()?.sabhaLocation?.address;
                    if (addr) setVenueAddr(addr);
                }
            },
            (err) => console.warn('[useVenueAddress] listener error:', err)
        );
        return unsub;
    }, []);

    return venueAddr;
}

// --- Driver Dashboard Data ---

export const useDriverAssignments = (driverId: string) => {
    const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
    const [loading, setLoading] = useState(true);
    const venueAddress = useVenueAddress();

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
                    venueAddress: venueAddress
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
                    venueAddress: venueAddress
                });
            }

            setAssignments(newAssignments);
            setLoading(false);
        });

        return unsubscribe;
    }, [driverId]);

    return { assignments, loading };
};
