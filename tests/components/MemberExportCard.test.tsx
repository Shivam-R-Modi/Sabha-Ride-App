/**
 * Downloading the member directory.
 *
 * TWO ASSERTIONS EARN THIS FILE:
 *
 *  - **the Airport scope is hidden, not disabled, without the coordinator flag.** The
 *    server refuses it, so a visible button would be one that always fails — and it
 *    is explained in words rather than silently absent, so a manager does not
 *    conclude the feature is broken.
 *  - **a truncated file says so.** A short export that looks complete is how somebody
 *    concludes half the congregation has left.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exportMembers = vi.fn(async () => ({
    success: true, scope: 'all' as const, csv: 'Name\r\nRamesh', rowCount: 1, truncated: false,
}));
const downloadCSV = vi.fn();
vi.mock('../../src/utils/cloudFunctions', () => ({
    exportMembers: (...a: unknown[]) => exportMembers(...(a as [])),
    downloadCSV: (...a: unknown[]) => downloadCSV(...(a as [])),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }));

const ask = vi.fn(async () => true);
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask, confirmDialog: null }),
}));

let profile: Record<string, unknown> = {
    name: 'Mira', role: 'manager', roles: ['manager'], accountStatus: 'approved',
};
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ userProfile: profile, currentUser: { uid: 'mgr_1' } }),
}));

import { MemberExportCard } from '../../components/manager/MemberExportCard';

const buttons = () =>
    screen.getAllByRole('button').map(b => (b.textContent ?? '').trim());

/**
 * The button whose LABEL is exactly this.
 *
 * Not `getByRole('button', { name: /Everyone/ })`: every blurb here begins
 * "Everyone who has asked…", so that regex matches the accessible name of all three
 * buttons. Matching the label span and walking up is unambiguous.
 */
const scopeButton = (label: string) =>
    screen.getByText(label, { exact: true }).closest('button')!;

beforeEach(() => {
    vi.clearAllMocks();
    ask.mockResolvedValue(true);
    profile = { name: 'Mira', role: 'manager', roles: ['manager'], accountStatus: 'approved' };
    exportMembers.mockResolvedValue({
        success: true, scope: 'all', csv: 'Name\r\nRamesh', rowCount: 1, truncated: false,
    });
});

describe('which scopes are offered', () => {
    it('a plain manager gets Sabha and Everyone, not Airport', async () => {
        render(<MemberExportCard />);
        const labels = buttons().join(' ');
        expect(labels).toContain('Sabha Seva');
        expect(labels).toContain('Everyone');
        expect(labels).not.toContain('Airport Seva');
    });

    it('and is told why, rather than left to think it is broken', () => {
        render(<MemberExportCard />);
        expect(screen.getByText(/airport coordinators only/i)).toBeInTheDocument();
    });

    it('a coordinator gets all three', () => {
        profile = { ...profile, airportCoordinator: true };
        render(<MemberExportCard />);
        expect(buttons().join(' ')).toContain('Airport Seva');
    });

    it('a coordinator is not shown the explanation they do not need', () => {
        profile = { ...profile, airportCoordinator: true };
        render(<MemberExportCard />);
        expect(screen.queryByText(/airport coordinators only/i)).not.toBeInTheDocument();
    });

    it('the flag alone is not enough — it has to be an approved manager', () => {
        // isAirportCoordinatorData on the server is built on isApprovedManagerData, and
        // the UI must not offer what the server will refuse.
        profile = { name: 'Kiran', role: 'driver', roles: ['driver'], accountStatus: 'approved', airportCoordinator: true };
        render(<MemberExportCard />);
        expect(buttons().join(' ')).not.toContain('Airport Seva');
    });
});

describe('downloading', () => {
    it('confirms first, because the file holds every family’s address', async () => {
        render(<MemberExportCard />);
        await userEvent.click(scopeButton('Everyone'));
        expect(ask).toHaveBeenCalled();
        expect(exportMembers).toHaveBeenCalledWith('all');
    });

    it('does nothing when the confirmation is declined', async () => {
        ask.mockResolvedValueOnce(false);
        render(<MemberExportCard />);
        await userEvent.click(scopeButton('Everyone'));
        expect(exportMembers).not.toHaveBeenCalled();
    });

    it('hands the file to the browser with a dated name', async () => {
        render(<MemberExportCard />);
        await userEvent.click(scopeButton('Everyone'));
        expect(downloadCSV).toHaveBeenCalledWith('Name\r\nRamesh', expect.stringMatching(/^all-members-\d{4}-\d{2}-\d{2}\.csv$/));
    });

    it('says so instead of handing over a file with only a header', async () => {
        exportMembers.mockResolvedValue({
            success: true, scope: 'all', csv: 'Name', rowCount: 0, truncated: false,
        });
        render(<MemberExportCard />);
        await userEvent.click(scopeButton('Everyone'));

        expect(downloadCSV).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/nothing to download/i));
    });

    it('warns loudly when the file is truncated', async () => {
        // A short export that looks complete is the silent-nothing failure again.
        exportMembers.mockResolvedValue({
            success: true, scope: 'all', csv: 'x', rowCount: 2000, truncated: true,
        });
        render(<MemberExportCard />);
        await userEvent.click(scopeButton('Everyone'));

        expect(downloadCSV).toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/there are more/i));
    });

    it('shows the server’s refusal rather than a generic failure', async () => {
        exportMembers.mockRejectedValue(new Error('Only airport coordinators can export airport records.'));
        render(<MemberExportCard />);
        await userEvent.click(scopeButton('Everyone'));
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('coordinators'));
    });
});
