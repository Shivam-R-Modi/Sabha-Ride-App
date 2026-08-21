/**
 * A tab shows itself first, and waits for its numbers second.
 *
 * Reported as "Reports has extra animation when switching to it". The animation
 * was not the problem — `.animate-in` and `.fade-in` are both fixed at 0.3s in
 * index.css, so every tab fades identically and always has. What Reports did
 * differently was return a full-page spinner while it fetched:
 *
 *     if (loading) return <spinner + "LOADING REPORTS..." />;
 *
 * so switching to it was a two-step no sibling did — page replaced, then page
 * fading in. `DriverHistory` had the same shape and was found by the source-level
 * guard in tests/quality/tab-entrance.test.ts rather than by anyone reporting it.
 *
 * That guard reads source. These two render, and assert the thing that actually
 * matters to somebody switching tabs: the heading is on screen while the data is
 * still coming, and the controls that never needed the data are usable.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/** A Firestore query result, as much of one as this screen reads. */
type Snap = { docs: unknown[]; size: number; empty: boolean };

/** A fetch that never settles, so the loading state is the state under test. */
const pending = (): Promise<Snap> => new Promise<Snap>(() => undefined);
let getDocs: () => Promise<Snap> = vi.fn(pending);

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: () => ({}),
    query: (b: unknown) => b,
    where: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    getDocs: (...a: unknown[]) => getDocs(...(a as [])),
}));
vi.mock('../../hooks/useCurrentEvent', () => ({
    useCurrentEvent: () => ({ eventId: '2026-08-28' }),
}));
vi.mock('../../hooks/useFirestore', () => ({
    downloadAttendanceCSV: vi.fn(async () => undefined),
    useDriverRideHistory: () => ({ rides: [], loading: true }),
}));
vi.mock('../../contexts/ToastContext', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { name: 'Asha' } }),
}));
// Reports gained a feedback list after this file was written. Stubbed rather than
// added to the firestore mock: what these tests are about is the FRAME rendering
// while the figures load, and the feedback hook holds its own listeners.
vi.mock('../../hooks/useFeedback', () => ({
    useFeedback: () => ({ rows: [], loading: false, error: null }),
}));

import { ManagerReports } from '../../components/manager/ManagerReports';

beforeEach(() => {
    vi.clearAllMocks();
    getDocs = vi.fn(pending);
});

describe('Reports while its figures are still loading', () => {
    it('shows its heading straight away', async () => {
        render(<ManagerReports />);

        expect(screen.getByText('Reports & Analytics')).toBeTruthy();
    });

    it('shows the controls that never needed the data', async () => {
        // Refresh and the export buttons depend on nothing being fetched, so
        // waiting for the fetch before drawing them bought nothing at all.
        render(<ManagerReports />);

        expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
        expect(screen.getByText('Export Data')).toBeTruthy();
    });

    it('says it is loading, in place, without replacing the page', async () => {
        render(<ManagerReports />);

        expect(screen.getByText(/loading figures/i)).toBeTruthy();
        // The old whole-screen state, gone for good.
        expect(screen.queryByText(/LOADING REPORTS/i)).toBeNull();
    });

    it('marks the waiting region for assistive tech', async () => {
        render(<ManagerReports />);

        expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    });

    it('replaces the loading card with figures once the data lands', async () => {
        getDocs = vi.fn(async (): Promise<Snap> => ({ docs: [], size: 0, empty: true }));

        render(<ManagerReports />);

        await waitFor(() => expect(screen.queryByText(/loading figures/i)).toBeNull());
        expect(screen.getByText('Reports & Analytics')).toBeTruthy();
        expect(screen.getByText(/total rides/i)).toBeTruthy();
    });
});
