/**
 * Driver Location Tracking Hook
 * Tracks driver location in real-time during active ride
 * Updates Firestore every 5 seconds for student tracking
 */

import { useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { watchPosition, clearPositionWatch } from '../src/utils/location';
import type { Fix } from '../src/utils/presence';

interface UseDriverLocationOptions {
    driverId: string;
    rideId: string | null;
    isRideActive: boolean;
    /**
     * Handed each throttled fix, so a caller can tick stops off without opening
     * a second `watchPosition` — two watches on one screen is double the battery
     * for the same answer.
     *
     * Held in a ref, so passing an inline arrow does not tear down and rebuild
     * the watch on every render. Called *before* the Firestore writes: a failed
     * write must not cost the caller its fix.
     */
    onFix?: (fix: Fix) => void;
}

/**
 * Hook to track and update driver location during active ride
 * Updates Firestore every 5 seconds with current location
 * Automatically starts/stops based on ride status
 */
export function useDriverLocation({
    driverId,
    rideId,
    isRideActive,
    onFix
}: UseDriverLocationOptions): void {
    const watchIdRef = useRef<number | null>(null);
    const lastUpdateRef = useRef<number>(0);
    const UPDATE_INTERVAL_MS = 5000; // 5 seconds

    const onFixRef = useRef(onFix);
    onFixRef.current = onFix;

    useEffect(() => {
        // Only track location during active ride
        if (!isRideActive || !rideId) {
            // Clear any existing watch
            if (watchIdRef.current !== null) {
                clearPositionWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
            return;
        }

        console.log('[DriverLocation] Starting location tracking for ride:', rideId);

        // Start watching position
        const watchId = watchPosition(
            async (position) => {
                const now = Date.now();

                // Throttle updates to every 5 seconds
                if (now - lastUpdateRef.current < UPDATE_INTERVAL_MS) {
                    return;
                }

                lastUpdateRef.current = now;

                onFixRef.current?.({
                    lat: position.lat,
                    lng: position.lng,
                    accuracy: position.accuracy,
                });

                try {
                    // Update driver location in users collection
                    await updateDoc(doc(db, 'users', driverId), {
                        currentLocation: {
                            lat: position.lat,
                            lng: position.lng,
                            updatedAt: new Date().toISOString()
                        }
                    });

                    // Also update location in the active ride document
                    if (rideId) {
                        await updateDoc(doc(db, 'rides', rideId), {
                            'driver.currentLocation': {
                                lat: position.lat,
                                lng: position.lng,
                                updatedAt: new Date().toISOString()
                            }
                        });
                    }

                    console.log('[DriverLocation] Updated:', position);
                } catch (error) {
                    console.error('[DriverLocation] Update failed:', error);
                }
            },
            (error) => {
                console.error('[DriverLocation] Geolocation error:', error);
            }
        );

        if (watchId !== null) {
            watchIdRef.current = watchId;
        }

        // Cleanup on unmount or when ride becomes inactive
        return () => {
            if (watchIdRef.current !== null) {
                console.log('[DriverLocation] Stopping location tracking');
                clearPositionWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
        };
    }, [driverId, rideId, isRideActive]);
}
