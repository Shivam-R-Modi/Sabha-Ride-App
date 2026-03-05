
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, updateDoc, doc, setDoc, getDocs } from 'firebase/firestore';
import { WeeklyAttendanceRecord } from '../types';
import { getCurrentWeekId, canChangeResponseToNo } from '../src/utils/weekUtils';

// --- Weekly Attendance System ---

/**
 * Hook to check if a user has responded to this week's attendance check
 */
export const useWeeklyAttendance = (userId: string) => {
    const [attendance, setAttendance] = useState<WeeklyAttendanceRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasResponded, setHasResponded] = useState(false);

    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }

        const weekId = getCurrentWeekId();
        const docRef = doc(db, 'weeklyAttendance', weekId, 'responses', userId);

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
    }, [userId]);

    return { attendance, loading, hasResponded };
};

/**
 * Submit weekly attendance response
 */
export const submitWeeklyAttendance = async (
    userId: string,
    response: 'yes' | 'no',
    userProfile: { name: string; phone?: string; address?: string }
): Promise<void> => {
    const weekId = getCurrentWeekId();
    const docRef = doc(db, 'weeklyAttendance', weekId, 'responses', userId);

    const record: WeeklyAttendanceRecord = {
        response,
        respondedAt: new Date().toISOString(),
        studentName: userProfile.name,
        studentPhone: userProfile.phone || '',
        studentAddress: userProfile.address || '',
        studentId: userId
    };

    await setDoc(docRef, record);
};

/**
 * Update attendance response (with Thursday 6 PM cutoff check for yes->no)
 */
export const updateAttendanceResponse = async (
    userId: string,
    newResponse: 'yes' | 'no',
    currentResponse: 'yes' | 'no'
): Promise<{ success: boolean; error?: string }> => {
    // Check if changing from yes to no after Thursday 6 PM
    if (currentResponse === 'yes' && newResponse === 'no') {
        if (!canChangeResponseToNo()) {
            return {
                success: false,
                error: 'Cannot change response to "No" after Thursday 6:00 PM. You are committed to attending this week.'
            };
        }
    }

    const weekId = getCurrentWeekId();
    const docRef = doc(db, 'weeklyAttendance', weekId, 'responses', userId);

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

    useEffect(() => {
        const weekId = getCurrentWeekId();
        const responsesRef = collection(db, 'weeklyAttendance', weekId, 'responses');
        const q = query(responsesRef, where('response', '==', 'yes'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setYesCount(snapshot.size);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching attendance count:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    return { yesCount, loading };
};

/**
 * Fetch all "yes" responses and generate CSV download
 */
export const downloadAttendanceCSV = async (): Promise<void> => {
    const weekId = getCurrentWeekId();
    const responsesRef = collection(db, 'weeklyAttendance', weekId, 'responses');
    const q = query(responsesRef, where('response', '==', 'yes'));

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        alert('No confirmed attendees for this week yet.');
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
    link.setAttribute('download', `sabha-attendance-${weekId}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
