
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc, setDoc, getDocs, getDoc } from 'firebase/firestore';
import { WeeklyAttendanceRecord } from '../types';
import { useCurrentEvent } from './useCurrentEvent';

// --- Attendance, per gathering ---
//
// Every path below is keyed by `eventId` — the gathering's date, as published by
// the server in system/rideContext. It used to be computed in the browser by
// getCurrentWeekId(), which read the DEVICE clock: a phone in another timezone
// resolved a different key, so its owner's response landed in a record the
// manager never read. The count was quietly short with nothing to diagnose.
//
// eventId is threaded through as an argument rather than recomputed, so there is
// exactly one answer per render and it is the server's.

/**
 * Hook to check if a user has responded for the current gathering
 */
export const useWeeklyAttendance = (userId: string) => {
    const [attendance, setAttendance] = useState<WeeklyAttendanceRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasResponded, setHasResponded] = useState(false);
    const { eventId } = useCurrentEvent();

    useEffect(() => {
        if (!userId || !eventId) {
            setLoading(false);
            return;
        }

        const docRef = doc(db, 'weeklyAttendance', eventId, 'responses', userId);

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as WeeklyAttendanceRecord;
                setAttendance(data);
                setHasResponded(true);
            } else {
                setAttendance(null);
                setHasResponded(false);
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching weekly attendance:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, [userId, eventId]);

    return { attendance, loading, hasResponded };
};

/**
 * Submit weekly attendance response
 * Prevents duplicate submissions by checking if response already exists
 */
export const submitWeeklyAttendance = async (
    userId: string,
    response: 'yes' | 'no',
    userProfile: { name: string; phone?: string; address?: string },
    eventId: string
): Promise<void> => {
    if (!eventId) throw new Error('No gathering is scheduled right now.');
    const docRef = doc(db, 'weeklyAttendance', eventId, 'responses', userId);

    // Check if response already exists
    const existingDoc = await getDoc(docRef);
    if (existingDoc.exists()) {
        throw new Error('You have already submitted your attendance for this week. Use the update option to change your response.');
    }

    const record: WeeklyAttendanceRecord = {
        response,
        respondedAt: new Date().toISOString(),
        studentName: userProfile.name,
        studentPhone: userProfile.phone || '',
        studentAddress: userProfile.address || '',
        studentId: userId,
        eventId
    };

    await setDoc(docRef, record);
};

/**
 * Update attendance response (with Thursday 6 PM cutoff check for yes->no)
 */
export const updateAttendanceResponse = async (
    userId: string,
    newResponse: 'yes' | 'no',
    currentResponse: 'yes' | 'no',
    eventId: string,
    canWithdraw: boolean
): Promise<{ success: boolean; error?: string }> => {
    if (!eventId) return { success: false, error: 'No gathering is scheduled right now.' };

    // Withdrawing a yes is only allowed before the lock, which the server
    // publishes as an absolute instant. This used to be worked out from the
    // device clock and a hardcoded Thursday.
    if (currentResponse === 'yes' && newResponse === 'no' && !canWithdraw) {
        return {
            success: false,
            error: 'Responses are locked for this sabha. Drivers have already been planned around your yes — please contact a coordinator.'
        };
    }

    const docRef = doc(db, 'weeklyAttendance', eventId, 'responses', userId);

    await updateDoc(docRef, {
        response: newResponse,
        respondedAt: new Date().toISOString()
    });

    return { success: true };
};

/**
 * Hook for manager to get real-time count of "yes" responses
 */
export const useWeeklyAttendanceCount = () => {
    const [yesCount, setYesCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const { eventId } = useCurrentEvent();

    useEffect(() => {
        if (!eventId) return;
        const responsesRef = collection(db, 'weeklyAttendance', eventId, 'responses');
        const q = query(responsesRef, where('response', '==', 'yes'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setYesCount(snapshot.size);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching attendance count:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, [eventId]);

    return { yesCount, loading };
};

/**
 * Fetch all "yes" responses and generate CSV download
 */
export const downloadAttendanceCSV = async (eventId: string): Promise<void> => {
    if (!eventId) {
        alert('No gathering is scheduled right now.');
        return;
    }
    const responsesRef = collection(db, 'weeklyAttendance', eventId, 'responses');
    const q = query(responsesRef, where('response', '==', 'yes'));

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        alert('No confirmed attendees for this sabha yet.');
        return;
    }

    // Build CSV content
    const headers = ['Student Name', 'Phone Number', 'Address'];
    const rows: string[][] = [];

    snapshot.forEach((doc) => {
        const data = doc.data() as WeeklyAttendanceRecord;
        rows.push([
            data.studentName,
            data.studentPhone || 'N/A',
            data.studentAddress || 'N/A'
        ]);
    });

    // Sort by name
    rows.sort((a, b) => a[0].localeCompare(b[0]));

    // Create CSV string
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `sabha-attendance-${eventId}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
