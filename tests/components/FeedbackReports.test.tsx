/**
 * The manager's end: feedback on screen, and a spreadsheet on demand.
 *
 * WHY THE LIST MATTERS AS MUCH AS THE EXPORT
 * ------------------------------------------
 * This app already writes crash reports to `clientErrors` that **no screen has
 * ever displayed** — collected since the collection existed, never read once. A
 * download-only feature goes the same way: it depends on somebody remembering to
 * download it. So the list is the feature and the export is the convenience, and
 * both are asserted here.
 *
 * The export is asserted on the FILE, not on whether a click happened: the BOM
 * has to be the first byte or Excel mangles the names, and a name has to be
 * resolved rather than printed as `undefined`. Those are the two ways a
 * spreadsheet is quietly wrong while looking completely fine.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Row = { createdAt: string; name: string | null; role: string | null; rating: number; comment: string };
let feedback: Row[] = [];
let feedbackLoading = false;

/** What the browser was handed to save. */
let savedBlobText: string | null = null;
let savedName: string | null = null;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: () => ({}), query: (b: unknown) => b, where: () => ({}), orderBy: () => ({}),
    getDocs: vi.fn(async () => ({ docs: [], size: 0, empty: true })),
    onSnapshot: () => () => undefined,
}));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => ({ eventId: '2026-08-28' }) }));
vi.mock('../../hooks/useFirestore', () => ({ downloadAttendanceCSV: vi.fn(async () => undefined) }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'm1' }, userProfile: { name: 'Mira' } }),
}));
vi.mock('../../hooks/useFeedback', () => ({
    useFeedback: () => ({ rows: feedback, loading: feedbackLoading, error: null }),
}));

import { ManagerReports } from '../../components/manager/ManagerReports';

const row = (over: Partial<Row> = {}): Row => ({
    createdAt: '2026-08-21T19:30:00.000Z',
    name: 'Kishan Parekh', role: 'student', rating: 5, comment: 'On time.', ...over,
});

const exportButton = () => screen.getByRole('button', { name: /feedback csv/i });

beforeEach(() => {
    vi.clearAllMocks();
    feedback = [];
    feedbackLoading = false;
    savedBlobText = null;
    savedName = null;

    // Capture the download instead of performing it.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = (blob: Blob) => {
        savedBlobText = (blob as unknown as { __text?: string }).__text ?? null;
        return 'blob:stub';
    };
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => undefined;
    // jsdom's Blob does not expose its contents synchronously.
    const RealBlob = globalThis.Blob;
    globalThis.Blob = class extends RealBlob {
        __text: string;
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
            super(parts, opts);
            this.__text = parts.map(String).join('');
        }
    } as unknown as typeof Blob;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        savedName = this.getAttribute('download');
    });
});

describe('the export card', () => {
    it('says nobody has sent anything, and cannot be clicked', () => {
        // Not a button that hands over an empty file — that reads as the export
        // being broken.
        render(<ManagerReports />);

        expect(exportButton().hasAttribute('disabled')).toBe(true);
        expect(screen.getByText(/nobody has sent feedback yet/i)).toBeTruthy();
    });

    it('counts what there is to download', () => {
        feedback = [row(), row({ name: 'He Het' })];
        render(<ManagerReports />);

        expect(screen.getByText(/download 2 responses/i)).toBeTruthy();
        expect(exportButton().hasAttribute('disabled')).toBe(false);
    });

    it('says "response" for one', () => {
        feedback = [row()];
        render(<ManagerReports />);

        expect(screen.getByText(/download 1 response$/i)).toBeTruthy();
    });

    it('is not clickable while still loading', () => {
        feedbackLoading = true;
        render(<ManagerReports />);

        expect(exportButton().hasAttribute('disabled')).toBe(true);
    });
});

describe('the file it hands over', () => {
    it('starts with a UTF-8 BOM, so Excel keeps the names intact', async () => {
        feedback = [row({ name: 'Kiran Desái' })];
        render(<ManagerReports />);

        await userEvent.click(exportButton());

        await waitFor(() => expect(savedBlobText).not.toBeNull());
        expect(savedBlobText!.startsWith('﻿')).toBe(true);
        expect(savedBlobText).toContain('Kiran Desái');
    });

    it('carries a header and one row per response', async () => {
        feedback = [row(), row({ name: 'He Het', rating: 2 })];
        render(<ManagerReports />);

        await userEvent.click(exportButton());

        await waitFor(() => expect(savedBlobText).not.toBeNull());
        expect(savedBlobText!.replace(/^﻿/, '').split('\n')).toHaveLength(3);
        expect(savedBlobText).toContain('Date,Name,Role,Rating,Comment');
    });

    it('writes Unknown rather than undefined for an unresolvable account', async () => {
        feedback = [row({ name: null, role: null })];
        render(<ManagerReports />);

        await userEvent.click(exportButton());

        await waitFor(() => expect(savedBlobText).not.toBeNull());
        expect(savedBlobText).toContain('Unknown');
        expect(savedBlobText).not.toContain('undefined');
    });

    it('names the file so it is findable in a downloads folder', async () => {
        feedback = [row()];
        render(<ManagerReports />);

        await userEvent.click(exportButton());

        await waitFor(() => expect(savedName).not.toBeNull());
        expect(savedName).toMatch(/^sabha-feedback-\d{4}-\d{2}-\d{2}\.csv$/);
    });
});

describe('the list on screen', () => {
    it('invites feedback when there is none, rather than showing an empty box', () => {
        render(<ManagerReports />);

        expect(screen.getByText(/everyone can send it from their profile/i)).toBeTruthy();
    });

    it('shows the comment, the name and the day', () => {
        feedback = [row({ comment: 'Pickups run late.' })];
        render(<ManagerReports />);

        expect(screen.getByText('Pickups run late.')).toBeTruthy();
        expect(screen.getByText('Kishan Parekh')).toBeTruthy();
        expect(screen.getByText('2026-08-21')).toBeTruthy();
    });

    it('announces the rating for a screen reader, not only as stars', () => {
        feedback = [row({ rating: 3 })];
        render(<ManagerReports />);

        expect(screen.getByText('3 out of 5')).toBeTruthy();
    });

    it('keeps the order it was given, which is newest first', () => {
        feedback = [row({ comment: 'Newest' }), row({ comment: 'Older' })];
        render(<ManagerReports />);

        const items = [...document.querySelectorAll('li')].map(li => li.textContent);
        expect(items[0]).toContain('Newest');
        expect(items[1]).toContain('Older');
    });

    it('says it is loading in place, without replacing the page', () => {
        feedbackLoading = true;
        render(<ManagerReports />);

        expect(screen.getByText('Reports & Analytics')).toBeTruthy();
        expect(screen.getByText(/loading feedback/i)).toBeTruthy();
    });
});
