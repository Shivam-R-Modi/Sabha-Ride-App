/**
 * The Users table in Raw records, after it stopped being six columns of PII.
 *
 * It used to render name-and-email, role, status and home address as columns, on a
 * screen a manager leaves open — four columns of a child's contact details, when
 * the reason for opening the tab is almost never any of them. It is now
 * Name / Role / Status / Actions, and everything removed is one tap away in the
 * detail sheet.
 *
 * The other half of this file guards the role BADGE. It used to read
 * `docItem.role` alone, so a record saying `role: 'driver'` with
 * `roles: ['student']` — the half-write the raw editor beside it could always
 * produce — rendered as a tidy, single, wrong answer.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const documents: any[] = [];

vi.mock('../../hooks/useAdminDatabase', () => ({
    useAdminDatabase: () => ({
        documents,
        loading: false,
        error: null,
        updateAdminDocument: vi.fn(),
        createAdminDocument: vi.fn(),
        deleteAdminDocument: vi.fn(),
        deleteMultipleAdminDocuments: vi.fn(),
    }),
    // Named in the component's import list; a type at build time, but the mock
    // has to satisfy the runtime binding.
    SupportedCollection: undefined,
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: 'mgr_1' },
        userProfile: { name: 'Mira', role: 'manager' },
    }),
}));

const managerSetUserRole = vi.fn().mockResolvedValue({ success: true, changed: true });
vi.mock('../../src/utils/cloudFunctions', () => ({
    managerSetUserRole: (...a: unknown[]) => managerSetUserRole(...a),
}));

import { DatabaseConsole } from '../../components/manager/DatabaseConsole';
import { ToastProvider } from '../../contexts/ToastContext';

const BHULKU = {
    id: 'p1', name: 'Asha Mehta', email: 'asha@example.com', phone: '+15550001111',
    address: '12 Maple Ave', accountStatus: 'approved',
    role: 'student', registeredRole: 'student', roles: ['student'], activeRole: 'student',
};

const SARTHI = {
    id: 'p2', name: 'Nilesh Rao', email: 'nilesh@example.com',
    accountStatus: 'approved',
    role: 'driver', registeredRole: 'driver', roles: ['driver', 'student'], activeRole: 'driver',
};

const show = () => render(<ToastProvider><DatabaseConsole /></ToastProvider>);

/** The header cells of the one table on screen. */
const headers = () => screen.getAllByRole('columnheader').map(h => h.textContent?.trim());

beforeEach(() => {
    documents.length = 0;
    documents.push(BHULKU, SARTHI);
    managerSetUserRole.mockResolvedValue({ success: true, changed: true });
});

describe('Raw records, Users — four columns and no more', () => {
    it('shows Name, Role, Status and Actions', () => {
        show();

        // The leading cell is the select-all checkbox, which is a control rather
        // than a column of data; bulk delete still needs it.
        expect(headers()).toEqual(['', 'Name', 'Role', 'Status', 'Actions']);
    });

    it('no longer has an Address column', () => {
        show();
        expect(headers()).not.toContain('Address');
    });

    it('shows the name WITHOUT the email beneath it', () => {
        // The old cell rendered `email || phone || 'No contact'` as a sub-line on
        // every single row.
        show();

        expect(screen.getByText('Asha Mehta')).toBeInTheDocument();
        expect(screen.queryByText('asha@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('+15550001111')).not.toBeInTheDocument();
    });

    it('shows no home address anywhere in a row', () => {
        show();
        expect(screen.queryByText('12 Maple Ave')).not.toBeInTheDocument();
    });
});

describe('Raw records, Users — the name opens the record', () => {
    it('is a button, not plain text', () => {
        // It has to be reachable by keyboard, and the row cannot carry the handler:
        // it also holds a checkbox and two icon buttons, so a row click would fire
        // whenever one of those was missed.
        show();
        expect(screen.getByRole('button', { name: 'Asha Mehta' })).toBeInTheDocument();
    });

    it('opens a dialog naming that person', async () => {
        show();
        await userEvent.click(screen.getByRole('button', { name: 'Asha Mehta' }));

        expect(await screen.findByRole('dialog', { name: /Asha Mehta/ })).toBeInTheDocument();
    });

    it('puts the contact details the table dropped inside the dialog', async () => {
        show();
        await userEvent.click(screen.getByRole('button', { name: 'Asha Mehta' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('asha@example.com')).toBeInTheDocument();
        expect(within(dialog).getByText('12 Maple Ave')).toBeInTheDocument();
    });

    it('offers the role change from there', async () => {
        show();
        await userEvent.click(screen.getByRole('button', { name: 'Asha Mehta' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: /Make Sarthi/ })).toBeInTheDocument();
    });
});

describe('Raw records, Users — the role badge reads all four fields', () => {
    it('labels roles in the words managers use', () => {
        show();

        const rows = screen.getAllByRole('row');
        expect(rows.some(r => within(r).queryByText('Bhulku'))).toBe(true);
        expect(rows.some(r => within(r).queryByText('Sarthi'))).toBe(true);
    });

    it('does not call a healthy Sarthi mixed', () => {
        // driver implies student, so two recorded roles is correct here.
        show();
        expect(screen.queryByText('mixed')).not.toBeInTheDocument();
    });

    it('marks a record whose four role fields disagree', () => {
        // `role: 'driver'` with everything else still saying student. Reading
        // `docItem.role` alone showed this as plain "Sarthi".
        documents.length = 0;
        documents.push({ ...BHULKU, role: 'driver' });
        show();

        expect(screen.getByText('mixed')).toBeInTheDocument();
    });
});
