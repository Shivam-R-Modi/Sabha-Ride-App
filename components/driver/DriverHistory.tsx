import React, { useState, useEffect } from 'react';
import { Ride } from '../../types';
import { CheckCircle2, Calendar, Users, Navigation, Loader2, Car } from 'lucide-react';
import { db } from '../../firebase/config';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { seatsOnRide } from '../../src/constants/seats';

export const DriverHistory: React.FC = () => {
    const { currentUser } = useAuth();
    const [rides, setRides] = useState<Ride[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentUser) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'rides'),
            where('driverId', '==', currentUser.uid),
            where('status', '==', 'completed')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list: Ride[] = [];
            snapshot.forEach(doc => {
                list.push({ id: doc.id, ...doc.data() } as Ride);
            });
            // Sort by most recent completion date
            list.sort((a, b) => new Date(b.completedAt || b.date).getTime() - new Date(a.completedAt || a.date).getTime());
            setRides(list);
            setLoading(false);
        }, (error) => {
            console.error('[DriverHistory] Error fetching driver ride history:', error);
            setLoading(false);
        });

        return unsubscribe;
    }, [currentUser]);

    // Seats, not rows. This counted roster entries, so a driver who spent the
    // evening moving families saw a total far below what they actually carried.
    const totalStudents = rides.reduce((acc, r) => acc + seatsOnRide(r), 0);
    const totalDistance = rides.reduce((acc, r) => acc + (r.estimatedDistance || 0), 0);

    return (
        <div className="pb-6 pt-6 px-4 space-y-4 max-w-4xl mx-auto animate-in fade-in duration-300">
            <div>
                <h2 className="text-2xl font-header font-bold text-coffee">Drive History</h2>
                <p className="text-coffee-500 text-sm mt-0.5">Your record of transportation seva</p>
            </div>

            {/* THE HEADING RENDERS AT ONCE. Only the figures wait.
                This screen used to `return` a full-page spinner while it fetched
                — "Loading Seva History..." replacing everything — so opening
                History was a two-step: page gone, spinner, then page fading in.
                Found by the guard that caught the same shape on Reports, which
                is the one that got reported. Same fix, same reason. */}
            {loading ? (
                <div className="clay-card p-6 h-32 flex items-center justify-center gap-3" aria-busy="true">
                    <Loader2 className="animate-spin w-5 h-5 text-saffron" />
                    <span className="text-sm text-coffee-500">Loading your history…</span>
                </div>
            ) : (
            <>
            {/* Stats Overview Grid */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="clay-card p-4 border-l-4 border-l-saffron">
                    <p className="text-[10px] text-coffee-500 uppercase font-bold tracking-wider">Total Rides</p>
                    <p className="text-2xl font-bold text-saffron-800">{rides.length}</p>
                </div>
                <div className="clay-card p-4 border-l-4 border-l-[rgb(var(--info))]">
                    <p className="text-[10px] text-coffee-500 uppercase font-bold tracking-wider">Bhulka Moved</p>
                    <p className="text-2xl font-bold text-[rgb(var(--info-text))]">{totalStudents}</p>
                </div>
                <div className="clay-card p-4 border-l-4 border-l-[rgb(var(--success))]">
                    <p className="text-[10px] text-coffee-500 uppercase font-bold tracking-wider">Total Miles</p>
                    <p className="text-2xl font-bold text-[rgb(var(--success-text))]">{totalDistance.toFixed(0)}</p>
                </div>
            </div>

            {/* Ride List */}
            <div className="space-y-3">
                {rides.map((ride) => {
                    const studentCount = seatsOnRide(ride);
                    const rideDate = ride.completedAt
                        ? new Date(ride.completedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                        : new Date(ride.date).toLocaleDateString();

                    return (
                        <div key={ride.id} className="clay-card p-4 transition-all hover:scale-[1.01]">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="bg-saffron/10 p-2.5 rounded-xl text-saffron">
                                        <Car size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-coffee text-base">
                                            {ride.rideType === 'home-to-sabha' ? 'Home → Sabha' : 'Sabha → Home'}
                                        </h4>
                                        <p className="text-xs text-coffee-500 flex items-center gap-1 mt-0.5">
                                            <Calendar size={12} />
                                            {rideDate}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 text-[rgb(var(--success-text))] text-xs font-bold bg-[rgb(var(--success-bg))] px-2.5 py-1 rounded-full border border-[rgb(var(--success))]/25">
                                    <CheckCircle2 size={12} />
                                    Completed
                                </div>
                            </div>

                            <div className="flex items-center gap-4 pt-2 border-t border-hairline/10 text-xs text-coffee-700 mt-2">
                                <div className="flex items-center gap-1">
                                    <Users size={14} className="text-saffron" />
                                    <span>{studentCount} {studentCount === 1 ? 'student' : 'students'}</span>
                                </div>
                                {ride.estimatedDistance > 0 && (
                                    <div className="flex items-center gap-1">
                                        <Navigation size={14} className="text-[rgb(var(--info-text))]" />
                                        <span>{ride.estimatedDistance.toFixed(1)} mi</span>
                                    </div>
                                )}
                                {ride.carModel && (
                                    <div className="flex items-center gap-1 ml-auto text-coffee-500 font-mono">
                                        <span>{ride.carColor} {ride.carModel}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {rides.length === 0 && (
                    <div className="clay-card p-8 text-center text-coffee-500">
                        <Calendar size={36} className="mx-auto mb-3 text-saffron/40" />
                        <p className="font-bold text-coffee">No Completed Rides Yet</p>
                        <p className="text-xs text-coffee-500 mt-1">Completed seva rides will be archived here.</p>
                    </div>
                )}
            </div>
            </>
            )}
        </div>
    );
};