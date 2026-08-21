import React, { useCallback, useEffect, useState } from 'react';
import { Download, Users, Car, TrendingUp, Calendar, CheckCircle2, XCircle, FileSpreadsheet, Loader2, MessageSquare, Star } from 'lucide-react';
import { db } from '../../firebase/config';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { downloadAttendanceCSV } from '../../hooks/useFirestore';
import '../../claymorphism.css';
import { seatsOnRide } from '../../src/constants/seats';
import { useFeedback } from '../../hooks/useFeedback';
import { buildFeedbackCsv } from '../../src/utils/feedback';
import { useToast } from '../../contexts/ToastContext';

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
    const toast = useToast();
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
    const { rows: feedback, loading: feedbackLoading } = useFeedback();

    /**
     * The same Blob-and-anchor as downloadAttendanceCSV. No library: a CSV opens
     * in Excel as a spreadsheet, and `buildFeedbackCsv` puts a UTF-8 BOM in front
     * so non-ASCII names survive the trip.
     */
    const downloadFeedback = () => {
        const blob = new Blob([buildFeedbackCsv(feedback)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `sabha-feedback-${new Date().toLocaleDateString('en-CA')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // `fetchStats` is memoised on `eventId` so it can be a real dependency
    // below. Without useCallback it is a new function every render, and listing
    // it would refetch on every render — which is why the dependency was
    // originally just omitted. Memoising is the honest fix: the effect now
    // declares everything it uses.
    const fetchStats = useCallback(async () => {
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
                // Seats, not roster rows — otherwise a sabha that moved forty
                // people reports the number of ride documents instead.
                totalStudents += seatsOnRide(data);
                if (data.driverId) driverIds.add(data.driverId);
            });

            // Fetch active drivers count.
            // `roles` (the granted set), not `role`: every driver here is recorded
            // as a manager, so this tile reported 0 active drivers while drivers
            // were on the road.
            const driversRef = collection(db, 'users');
            const driversQuery = query(driversRef, where('roles', 'array-contains', 'driver'), where('accountStatus', '==', 'approved'));
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
    }, [eventId]);

    // Refetch when the gathering rolls over, so the numbers are never for last
    // week's sabha.
    useEffect(() => {
        if (eventId) fetchStats();
    }, [eventId, fetchStats]);

    const handleDownloadAttendance = async () => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            await downloadAttendanceCSV(eventId!);
        } catch (error) {
            console.error('Error downloading:', error);
            toast.error(error instanceof Error ? error.message : 'Could not download the attendance list.');
        } finally {
            setIsDownloading(false);
        }
    };

    const currentWeekStats = weeklyStats[0];

    return (
        <div className="p-6 space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            {/* `min-w-0` on the text and `shrink-0` on the action: in a
                justify-between row a flex child will not shrink below its
                content, so at 390px the button was squeezed until its LABEL
                wrapped. The title is what should wrap, not the control. */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-header font-bold text-coffee">Reports & Analytics</h1>
                    <p className="text-coffee-500 text-sm mt-1">Overview of seva operations</p>
                </div>
                <button
                    onClick={fetchStats}
                    className="shrink-0 whitespace-nowrap px-4 py-2 text-sm font-bold text-saffron-800 bg-cream-300 rounded-xl hover:bg-cream-300 transition-colors"
                >
                    Refresh
                </button>
            </div>

            {/* THE FRAME RENDERS AT ONCE. Only the figures wait.
                This screen used to `return` a full-page spinner while it
                fetched, so switching to Reports was a two-step nobody else's tab
                did: whole page replaced by "LOADING REPORTS...", then the whole
                page fading in. Reported as "extra animation", and that is what
                it was — not the fade itself, which is 0.3s here and everywhere.

                Same shape as ManagerPeople, which renders its header and shows
                its loading state inside the list. The header and the export
                buttons never depended on the fetch, so waiting for it before
                drawing them bought nothing. */}
            {loading ? (
                <div
                    className="clay-card p-6 h-40 flex items-center justify-center gap-3"
                    aria-busy="true"
                >
                    <Loader2 className="animate-spin w-5 h-5 text-saffron" />
                    <span className="text-sm text-coffee-500">Loading figures…</span>
                </div>
            ) : (
                <>
                {/* Statistics Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Total Rides */}
                    <div className="clay-card p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-[rgb(var(--info-bg))] rounded-xl flex items-center justify-center">
                                <Car className="w-5 h-5 text-[rgb(var(--info-text))]" />
                            </div>
                            <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">Total Rides</span>
                        </div>
                        <p className="text-3xl font-header font-bold text-coffee">{rideStats.totalRides}</p>
                        <p className="text-xs text-coffee-500 mt-1">{rideStats.completedRides} completed</p>
                    </div>

                    {/* Students Served */}
                    <div className="clay-card p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-[rgb(var(--success-bg))] rounded-xl flex items-center justify-center">
                                <Users className="w-5 h-5 text-[rgb(var(--success-text))]" />
                            </div>
                            <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">Bhulka Served</span>
                        </div>
                        <p className="text-3xl font-header font-bold text-coffee">{rideStats.totalStudentsServed}</p>
                        <p className="text-xs text-coffee-500 mt-1">across all rides</p>
                    </div>

                    {/* Active Drivers */}
                    <div className="clay-card p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-cream-300 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-saffron" />
                            </div>
                            <span className="text-xs font-bold text-coffee-500 uppercase tracking-wider">Active Sarthis</span>
                        </div>
                        <p className="text-3xl font-header font-bold text-coffee">{rideStats.activeDrivers}</p>
                        <p className="text-xs text-coffee-500 mt-1">approved volunteers</p>
                    </div>

                    {/* This Week Attendance */}
                    <div className="clay-card p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-cream-300 rounded-xl flex items-center justify-center">
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
                    <div className="flex items-start justify-between gap-3 mb-6">
                        <div className="min-w-0">
                            <h2 className="text-lg font-header font-bold text-coffee">Weekly Attendance</h2>
                            {/* The date is one token. Left to wrap it broke at its own
                                hyphens — "Week ending 2026-08-" / "21" — which reads as
                                two different dates for a moment. Only the date is held
                                together; the words before it may still wrap. */}
                            <p className="text-sm text-coffee-500">
                                Week ending <span className="whitespace-nowrap">{currentWeekStats?.weekId || 'N/A'}</span>
                            </p>
                        </div>
                        <button
                            onClick={handleDownloadAttendance}
                            disabled={isDownloading}
                            className="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 bg-saffron text-white rounded-xl text-sm font-bold hover:bg-saffron/90 transition-colors disabled:opacity-50"
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
                            <div className="bg-[rgb(var(--success-bg))] rounded-2xl p-4 text-center border border-[rgb(var(--success))]/25">
                                <div className="w-12 h-12 bg-[rgb(var(--success-bg))] rounded-full flex items-center justify-center mx-auto mb-3">
                                    <CheckCircle2 className="w-6 h-6 text-[rgb(var(--success-text))]" />
                                </div>
                                <p className="text-2xl font-bold text-[rgb(var(--success-text))]">{currentWeekStats.totalYes}</p>
                                <p className="text-xs text-[rgb(var(--success-text))] font-medium mt-1">Attending</p>
                            </div>

                            {/* No Responses */}
                            <div className="bg-[rgb(var(--danger-bg))] rounded-2xl p-4 text-center border border-[rgb(var(--danger))]/25">
                                <div className="w-12 h-12 bg-[rgb(var(--danger-bg))] rounded-full flex items-center justify-center mx-auto mb-3">
                                    <XCircle className="w-6 h-6 text-[rgb(var(--danger-text))]" />
                                </div>
                                <p className="text-2xl font-bold text-[rgb(var(--danger-text))]">{currentWeekStats.totalNo}</p>
                                <p className="text-xs text-[rgb(var(--danger-text))] font-medium mt-1">Not Attending</p>
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
                </>
            )}

            {/* Export Section */}
            <div className="clay-card p-6">
                <h2 className="text-lg font-header font-bold text-coffee mb-4">Export Data</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={handleDownloadAttendance}
                        disabled={isDownloading}
                        className="flex items-center gap-4 p-4 bg-cream/50 rounded-xl border border-hairline/10 hover:bg-cream transition-colors text-left"
                    >
                        <div className="w-12 h-12 bg-[rgb(var(--success-bg))] rounded-xl flex items-center justify-center shrink-0">
                            <FileSpreadsheet className="w-6 h-6 text-[rgb(var(--success-text))]" />
                        </div>
                        <div>
                            <p className="font-bold text-coffee">Weekly Attendance CSV</p>
                            <p className="text-xs text-coffee-500 mt-0.5">Download list of confirmed attendees</p>
                        </div>
                    </button>

                    {/* Disabled with a REASON when there is nothing to export,
                        rather than handing over an empty file that looks like a
                        failure of the export. */}
                    <button
                        onClick={downloadFeedback}
                        disabled={feedbackLoading || feedback.length === 0}
                        className="flex items-center gap-4 p-4 bg-cream/50 rounded-xl border border-hairline/10 hover:bg-cream transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <div className="w-12 h-12 bg-[rgb(var(--info-bg))] rounded-xl flex items-center justify-center shrink-0">
                            <FileSpreadsheet className="w-6 h-6 text-[rgb(var(--info-text))]" />
                        </div>
                        <div>
                            <p className="font-bold text-coffee">Feedback CSV</p>
                            <p className="text-xs text-coffee-500 mt-0.5">
                                {feedbackLoading
                                    ? 'Loading…'
                                    : feedback.length === 0
                                        ? 'Nobody has sent feedback yet'
                                        : `Download ${feedback.length} ${feedback.length === 1 ? 'response' : 'responses'}`}
                            </p>
                        </div>
                    </button>

                    <div className="flex items-center gap-4 p-4 bg-cream-200 rounded-xl border border-hairline/20 opacity-50 cursor-not-allowed">
                        <div className="w-12 h-12 bg-cream-300 rounded-xl flex items-center justify-center shrink-0">
                            <FileSpreadsheet className="w-6 h-6 text-coffee-500" />
                        </div>
                        <div>
                            <p className="font-bold text-coffee-500">Ride History CSV</p>
                            <p className="text-xs text-coffee-500 mt-0.5">Coming soon</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ON SCREEN, not only in a download.
                This app already writes crash reports to `clientErrors` that no
                screen has ever displayed — they are collected and never read.
                A download-only feature goes the same way, so the list is the
                point and the export is the convenience. */}
            <div className="clay-card p-6">
                <div className="flex items-center gap-2 mb-4">
                    <MessageSquare size={18} className="text-saffron-800" />
                    <h2 className="text-lg font-header font-bold text-coffee">Feedback</h2>
                </div>

                {feedbackLoading ? (
                    <div className="h-24 flex items-center justify-center gap-3" aria-busy="true">
                        <Loader2 className="animate-spin w-5 h-5 text-saffron" />
                        <span className="text-sm text-coffee-500">Loading feedback…</span>
                    </div>
                ) : feedback.length === 0 ? (
                    <div className="text-center py-8 text-coffee-500">
                        <MessageSquare size={40} className="mx-auto mb-3 opacity-50" />
                        <p>No feedback yet. Everyone can send it from their Profile.</p>
                    </div>
                ) : (
                    <ul className="space-y-3">
                        {feedback.map((row, index) => (
                            <li key={`${row.createdAt}-${index}`} className="bg-cream-200 rounded-xl p-3">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1.5">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <Star
                                                key={n}
                                                size={13}
                                                aria-hidden="true"
                                                className={n <= row.rating ? 'text-saffron-800' : 'text-coffee-400'}
                                            />
                                        ))}
                                        <span className="sr-only">{row.rating} out of 5</span>
                                        <span className="text-xs font-bold text-coffee ml-1.5">
                                            {row.name || 'Unknown'}
                                        </span>
                                        {row.role && (
                                            <span className="text-[10px] uppercase tracking-wider text-coffee-500">
                                                {row.role}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[11px] text-coffee-500 tabular-nums">
                                        {(row.createdAt || '').slice(0, 10)}
                                    </span>
                                </div>
                                {/* `whitespace-pre-line`: the person typed line
                                    breaks in a textarea and they carry meaning. */}
                                <p className="text-sm text-coffee-700 mt-1.5 whitespace-pre-line">{row.comment}</p>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};
