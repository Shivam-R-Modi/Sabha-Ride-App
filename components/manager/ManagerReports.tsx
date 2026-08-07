import React, { useState, useEffect } from 'react';
import {
    Download,
    Users,
    Car,
    TrendingUp,
    Calendar,
    CheckCircle2,
    XCircle,
    Clock,
    FileSpreadsheet,
    Loader2
} from 'lucide-react';
import { db } from '../../firebase/config';
import { collection, query, getDocs, where, orderBy, limit } from 'firebase/firestore';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { downloadAttendanceCSV } from '../../hooks/useFirestore';
import '../../claymorphism.css';

interface WeeklyStats {
    weekId: string;
    totalYes: number;
    totalNo: number;
    totalResponses: number;
}

interface RideStats {
    totalRides: number;
    completedRides: number;
    totalStudentsServed: number;
    activeDrivers: number;
}

export const ManagerReports: React.FC = () => {
    const [weeklyStats, setWeeklyStats] = useState<WeeklyStats[]>([]);
    const [rideStats, setRideStats] = useState<RideStats>({
        totalRides: 0,
        completedRides: 0,
        totalStudentsServed: 0,
        activeDrivers: 0
    });
    const [loading, setLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    // Attendance is per gathering. eventId comes from the server, so this agrees
    // with what students wrote whatever timezone their devices are in.
    const { eventId } = useCurrentEvent();

    useEffect(() => {
        if (eventId) fetchStats();
        // Refetch when the gathering rolls over, so the numbers are never for
        // last week's sabha.
    }, [eventId]);

    const fetchStats = async () => {
        setLoading(true);
        try {
            // Attendance for the current gathering, keyed by the eventId the
            // server publishes rather than a locally-guessed Friday.
            const responsesRef = collection(db, 'weeklyAttendance', eventId!, 'responses');
            const responsesSnapshot = await getDocs(responsesRef);

            let yesCount = 0;
            let noCount = 0;
            responsesSnapshot.forEach(doc => {
                const data = doc.data();
                if (data.response === 'yes') yesCount++;
                else if (data.response === 'no') noCount++;
            });

            setWeeklyStats([{
                weekId: eventId!,
                totalYes: yesCount,
                totalNo: noCount,
                totalResponses: yesCount + noCount
            }]);

            // Fetch ride statistics
            const ridesRef = collection(db, 'rides');
            const ridesSnapshot = await getDocs(ridesRef);

            let totalRides = 0;
            let completedRides = 0;
            let totalStudents = 0;
            const driverIds = new Set<string>();

            ridesSnapshot.forEach(doc => {
                const data = doc.data();
                totalRides++;
                if (data.status === 'completed') completedRides++;
                if (data.students) totalStudents += data.students.length;
                if (data.driverId) driverIds.add(data.driverId);
            });

            // Fetch active drivers count
            const driversRef = collection(db, 'users');
            const driversQuery = query(driversRef, where('role', '==', 'driver'), where('accountStatus', '==', 'approved'));
            const driversSnapshot = await getDocs(driversQuery);

            setRideStats({
                totalRides,
                completedRides,
                totalStudentsServed: totalStudents,
                activeDrivers: driversSnapshot.size
            });

        } catch (error) {
            console.error('Error fetching stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadAttendance = async () => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            await downloadAttendanceCSV(eventId!);
        } catch (error) {
            console.error('Error downloading:', error);
            alert('Failed to download attendance CSV');
        } finally {
            setIsDownloading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <Loader2 className="animate-spin w-10 h-10 text-saffron" />
                <p className="text-xs font-bold text-gold-700 mt-4 tracking-widest">LOADING REPORTS...</p>
            </div>
        );
    }

    const currentWeekStats = weeklyStats[0];

    return (
        <div className="p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-header font-bold text-coffee">Reports & Analytics</h1>
                    <p className="text-coffee-500 text-sm mt-1">Overview of seva operations</p>
                </div>
                <button
                    onClick={fetchStats}
                    className="px-4 py-2 text-sm font-bold text-saffron-800 bg-orange-50 rounded-xl hover:bg-orange-100 transition-colors"
                >
                    Refresh
                </button>
            </div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total Rides */}
                <div className="clay-card p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                            <Car className="w-5 h-5 text-blue-500" />
                        </div>
                        <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">Total Rides</span>
                    </div>
                    <p className="text-3xl font-header font-bold text-coffee">{rideStats.totalRides}</p>
                    <p className="text-xs text-coffee-500 mt-1">{rideStats.completedRides} completed</p>
                </div>

                {/* Students Served */}
                <div className="clay-card p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                            <Users className="w-5 h-5 text-green-500" />
                        </div>
                        <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">Students Served</span>
                    </div>
                    <p className="text-3xl font-header font-bold text-coffee">{rideStats.totalStudentsServed}</p>
                    <p className="text-xs text-coffee-500 mt-1">across all rides</p>
                </div>

                {/* Active Drivers */}
                <div className="clay-card p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-purple-500" />
                        </div>
                        <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">Active Drivers</span>
                    </div>
                    <p className="text-3xl font-header font-bold text-coffee">{rideStats.activeDrivers}</p>
                    <p className="text-xs text-coffee-500 mt-1">approved volunteers</p>
                </div>

                {/* This Week Attendance */}
                <div className="clay-card p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                            <Calendar className="w-5 h-5 text-saffron" />
                        </div>
                        <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">This Week</span>
                    </div>
                    <p className="text-3xl font-header font-bold text-coffee">{currentWeekStats?.totalResponses || 0}</p>
                    <p className="text-xs text-coffee-500 mt-1">attendance responses</p>
                </div>
            </div>

            {/* Weekly Attendance Section */}
            <div className="clay-card p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-header font-bold text-coffee">Weekly Attendance</h2>
                        <p className="text-sm text-coffee-500">Week ending {currentWeekStats?.weekId || 'N/A'}</p>
                    </div>
                    <button
                        onClick={handleDownloadAttendance}
                        disabled={isDownloading}
                        className="flex items-center gap-2 px-4 py-2 bg-saffron text-white rounded-xl text-sm font-bold hover:bg-saffron/90 transition-colors disabled:opacity-50"
                    >
                        {isDownloading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Download size={16} />
                        )}
                        {isDownloading ? 'Downloading...' : 'Download CSV'}
                    </button>
                </div>

                {currentWeekStats ? (
                    <div className="grid grid-cols-2 gap-4">
                        {/* Yes Responses */}
                        <div className="bg-green-50 rounded-2xl p-4 text-center border border-green-100">
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <CheckCircle2 className="w-6 h-6 text-green-700" />
                            </div>
                            <p className="text-2xl font-bold text-green-700">{currentWeekStats.totalYes}</p>
                            <p className="text-xs text-green-700 font-medium mt-1">Attending</p>
                        </div>

                        {/* No Responses */}
                        <div className="bg-red-50 rounded-2xl p-4 text-center border border-red-100">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <XCircle className="w-6 h-6 text-red-600" />
                            </div>
                            <p className="text-2xl font-bold text-red-700">{currentWeekStats.totalNo}</p>
                            <p className="text-xs text-red-600 font-medium mt-1">Not Attending</p>
                        </div>

                        {/* A third "Pending" tile used to sit here showing the
                            literal '-'. Pending means eligible students who
                            have not answered, and that needs a denominator this
                            screen does not have — the attendance documents only
                            record people who DID answer. Getting it would mean
                            listing every user, which is exactly the query the
                            roadmap's city-scoping work changes. A permanent '-'
                            reads as "zero pending" at a glance, which is a
                            worse answer than not showing the tile. */}
                    </div>
                ) : (
                    <div className="text-center py-8 text-coffee-500">
                        <Calendar size={40} className="mx-auto mb-3 opacity-50" />
                        <p>No attendance data for this week yet</p>
                    </div>
                )}
            </div>

            {/* Export Section */}
            <div className="clay-card p-6">
                <h2 className="text-lg font-header font-bold text-coffee mb-4">Export Data</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={handleDownloadAttendance}
                        disabled={isDownloading}
                        className="flex items-center gap-4 p-4 bg-cream/50 rounded-xl border border-orange-100 hover:bg-cream transition-colors text-left"
                    >
                        <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
                            <FileSpreadsheet className="w-6 h-6 text-green-700" />
                        </div>
                        <div>
                            <p className="font-bold text-coffee">Weekly Attendance CSV</p>
                            <p className="text-xs text-coffee-500 mt-0.5">Download list of confirmed attendees</p>
                        </div>
                    </button>

                    <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 opacity-50 cursor-not-allowed">
                        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                            <FileSpreadsheet className="w-6 h-6 text-gray-500" />
                        </div>
                        <div>
                            <p className="font-bold text-gray-500">Ride History CSV</p>
                            <p className="text-xs text-gray-500 mt-0.5">Coming soon</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
