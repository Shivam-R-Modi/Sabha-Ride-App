/**
 * Location Hook
 * Manages geolocation tracking and waypoint detection
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    getCurrentPosition,
    watchPosition,
    clearPositionWatch,
    isWithinDistance,
    haversineDistance,
} from '../utils/location';
import type { Waypoint, GeoLocation } from '../types';

interface UseLocationOptions {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
}

interface UseLocationReturn {
    location: GeoLocation | null;
    error: string | null;
    isLoading: boolean;
    isWatching: boolean;
    getLocation: () => Promise<GeoLocation | null>;
    startWatching: () => void;
    stopWatching: () => void;
}

export function useLocation(options: UseLocationOptions = {}): UseLocationReturn {
    const { enableHighAccuracy = true, timeout = 10000, maximumAge = 0 } = options;

    const [location, setLocation] = useState<GeoLocation | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isWatching, setIsWatching] = useState(false);
    const watchIdRef = useRef<number | null>(null);

    const getLocation = useCallback(async (): Promise<GeoLocation | null> => {
        setIsLoading(true);
        setError(null);

        try {
            const pos = await getCurrentPosition();
            const newLocation: GeoLocation = {
                lat: pos.lat,
                lng: pos.lng,
            };
            setLocation(newLocation);
            setIsLoading(false);
            return newLocation;
        } catch (err: any) {
            setError(err.message);
            setIsLoading(false);
            return null;
        }
    }, []);

    const startWatching = useCallback(() => {
        if (watchIdRef.current !== null) return;

        setIsWatching(true);
        setError(null);

        watchIdRef.current = watchPosition(
            (pos) => {
                setLocation({
                    lat: pos.lat,
                    lng: pos.lng,
                });
                setError(null);
            },
            (err) => {
                setError(err.message);
            }
        );
    }, []);

    const stopWatching = useCallback(() => {
        if (watchIdRef.current !== null) {
            clearPositionWatch(watchIdRef.current);
            watchIdRef.current = null;
            setIsWatching(false);
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopWatching();
        };
    }, [stopWatching]);

    return {
        location,
        error,
        isLoading,
        isWatching,
        getLocation,
        startWatching,
        stopWatching,
    };
}

// Hook for tracking waypoints during a ride
interface UseWaypointTrackingOptions {
    waypoints: Waypoint[];
    onWaypointReached?: (index: number, waypoint: Waypoint) => void;
    thresholdKm?: number;
}

interface UseWaypointTrackingReturn {
    currentWaypointIndex: number;
    distanceToNext: number | null;
    visitedWaypoints: number[];
}

export function useWaypointTracking(
    userLocation: GeoLocation | null,
    options: UseWaypointTrackingOptions
): UseWaypointTrackingReturn {
    const { waypoints, onWaypointReached, thresholdKm = 0.05 } = options;

    const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0);
    const [visitedWaypoints, setVisitedWaypoints] = useState<number[]>([]);
    const [distanceToNext, setDistanceToNext] = useState<number | null>(null);

    useEffect(() => {
        if (!userLocation || waypoints.length === 0) return;

        // Find next unvisited waypoint
        let nextIndex = -1;
        for (let i = 0; i < waypoints.length; i++) {
            if (!waypoints[i].visited && !visitedWaypoints.includes(i)) {
                nextIndex = i;
                break;
            }
        }

        if (nextIndex === -1) return;

        const nextWaypoint = waypoints[nextIndex];
        const distance = haversineDistance(
            userLocation.lat,
            userLocation.lng,
            nextWaypoint.lat,
            nextWaypoint.lng
        );

        setDistanceToNext(distance);
        setCurrentWaypointIndex(nextIndex);

        // Check if within threshold
        if (distance <= thresholdKm) {
            setVisitedWaypoints((prev) => [...prev, nextIndex]);
            onWaypointReached?.(nextIndex, nextWaypoint);
        }
    }, [userLocation, waypoints, thresholdKm, onWaypointReached]);

    return {
        currentWaypointIndex,
        distanceToNext,
        visitedWaypoints,
    };
}

// Hook for background location tracking (simplified version)
interface UseBackgroundLocationReturn {
    isTracking: boolean;
    startTracking: () => void;
    stopTracking: () => void;
    locations: GeoLocation[];
}

export function useBackgroundLocation(): UseBackgroundLocationReturn {
    const [isTracking, setIsTracking] = useState(false);
    const [locations, setLocations] = useState<GeoLocation[]>([]);
    const watchIdRef = useRef<number | null>(null);

    const startTracking = useCallback(() => {
        if (watchIdRef.current !== null) return;

        setIsTracking(true);
        watchIdRef.current = watchPosition((pos) => {
            setLocations((prev) => [...prev, { lat: pos.lat, lng: pos.lng }]);
        });
    }, []);

    const stopTracking = useCallback(() => {
        if (watchIdRef.current !== null) {
            clearPositionWatch(watchIdRef.current);
            watchIdRef.current = null;
            setIsTracking(false);
        }
    }, []);

    useEffect(() => {
        return () => {
            stopTracking();
        };
    }, [stopTracking]);

    return {
        isTracking,
        startTracking,
        stopTracking,
        locations,
    };
}
