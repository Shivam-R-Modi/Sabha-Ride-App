/**
 * Writing a notice.
 *
 * THE TITLE IS REQUIRED, added 2026-08-24 with the collapsed board. Every notice
 * is a row showing its title now, so a notice without one has nothing to be a row
 * of — and a required field is exactly where this repo's recurring failure shows
 * up: a Post button that greys out with nothing on screen explaining which of two
 * fields is the problem. So the counter and the disabled state are pinned
 * together, not separately.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Typed with its argument, so `mock.calls[0][0]` is a real element and not an
// index into an empty tuple.
const publishNotice = vi.fn(async (_input: Record<string, unknown>) => ({ success: true, noticeId: 'n9' }));
const deleteNotice = vi.fn(async () => ({ success: true }));
vi.mock('../../src/utils/cloudFunctions', () => ({
    publishNotice: (input: Record<string, unknown>) => publishNotice(input),
    deleteNotice: (...a: unknown[]) => deleteNotice(...(a as [])),
}));

// The upload has its own tests; here the composer only needs it to resolve.
vi.mock('../../src/utils/noticeImage', () => ({
    uploadNoticeImage: async () => ({ imagePath: 'notices/x/f.jpg', imageUrl: 'https://x/f.jpg' }),
    describeImageProblem: () => null,
}));

let notices: any[] = [];
vi.mock('../../hooks/useNotices', () => ({ useNotices: () => ({ notices, loading: false }) }));

import { NoticeComposer } from '../../components/manager/NoticeComposer';
import { ToastProvider } from '../../contexts/ToastContext';

const show = () => render(<ToastProvider><NoticeComposer /></ToastProvider>);

const titleBox = () => screen.getByRole('textbox', { name: /^Title/ });
const bodyBox = () => screen.getByRole('textbox', { name: /^Notice/ });
const postButton = () => screen.getByRole('button', { name: /post notice/i });

beforeEach(() => {
    vi.clearAllMocks();
    notices = [];
});

describe('the title field', () => {
    it('is on the form, and says what it is for', () => {
        show();
        expect(titleBox()).toBeInTheDocument();
        // A manager cannot see the rider's board from here, so the label has to
        // explain that everything else is hidden until someone opens the row.
        expect(screen.getByText(/hidden until someone opens it/i)).toBeInTheDocument();
    });

    it('sends the title with the notice', async () => {
        show();
        fireEvent.change(titleBox(), { target: { value: 'Sabha moved to 7pm' } });
        fireEvent.change(bodyBox(), { target: { value: 'Please arrive early.' } });
        fireEvent.click(postButton());

        await waitFor(() => expect(publishNotice).toHaveBeenCalledOnce());
        expect(publishNotice.mock.calls[0]![0]).toMatchObject({
            title: 'Sabha moved to 7pm',
            body: 'Please arrive early.',
        });
    });

    it('trims it, so a stray space is not stored as part of the heading', async () => {
        show();
        fireEvent.change(titleBox(), { target: { value: '  Sabha moved  ' } });
        fireEvent.change(bodyBox(), { target: { value: 'x' } });
        fireEvent.click(postButton());

        await waitFor(() => expect(publishNotice).toHaveBeenCalledOnce());
        expect(publishNotice.mock.calls[0]![0].title).toBe('Sabha moved');
    });

    it('will not post without one', () => {
        show();
        fireEvent.change(bodyBox(), { target: { value: 'Please arrive early.' } });
        expect(postButton()).toBeDisabled();
    });

    it('will not post with only a title', () => {
        // The body was always required. Adding a second required field must not
        // quietly make the first optional.
        show();
        fireEvent.change(titleBox(), { target: { value: 'Sabha moved' } });
        expect(postButton()).toBeDisabled();
    });

    it('will not accept a whitespace-only title', () => {
        show();
        fireEvent.change(titleBox(), { target: { value: '   ' } });
        fireEvent.change(bodyBox(), { target: { value: 'x' } });
        expect(postButton()).toBeDisabled();
    });

    it('posts once both are filled in', () => {
        show();
        fireEvent.change(titleBox(), { target: { value: 'Sabha moved' } });
        fireEvent.change(bodyBox(), { target: { value: 'x' } });
        expect(postButton()).toBeEnabled();
    });

    it('counts the title towards its own cap, and refuses one over it', () => {
        // Not a maxLength: a hard stop at 80 with the counter frozen reads as a
        // broken keyboard. The count moves, turns red, and the button explains
        // itself by being disabled next to it — the same treatment the body has.
        show();
        fireEvent.change(titleBox(), { target: { value: 'x'.repeat(81) } });
        fireEvent.change(bodyBox(), { target: { value: 'x' } });

        expect(screen.getByText(/Title 81 \/ 80/)).toBeInTheDocument();
        expect(postButton()).toBeDisabled();
    });

    it('clears the title after posting, along with everything else', async () => {
        show();
        fireEvent.change(titleBox(), { target: { value: 'Sabha moved' } });
        fireEvent.change(bodyBox(), { target: { value: 'x' } });
        fireEvent.click(postButton());

        await waitFor(() => expect(titleBox()).toHaveValue(''));
        // A retained title is how the same notice gets posted twice.
        expect(bodyBox()).toHaveValue('');
    });

    it('surfaces the server refusal rather than clearing the form', async () => {
        publishNotice.mockRejectedValueOnce(new Error('A title is required'));
        show();
        fireEvent.change(titleBox(), { target: { value: 'Sabha moved' } });
        fireEvent.change(bodyBox(), { target: { value: 'x' } });
        fireEvent.click(postButton());

        expect(await screen.findByText(/A title is required/)).toBeInTheDocument();
        expect(titleBox()).toHaveValue('Sabha moved');
    });
});

describe('"On the board now" shows what everyone else sees', () => {
    it('lists the heading, not three clamped lines of the body', () => {
        // This list answers "what is on the board right now?", and what is on the
        // board is the collapsed row.
        notices = [{ id: 'n1', title: 'Sabha moved to 7pm', body: 'Please arrive early.' }];
        show();

        expect(screen.getByText('Sabha moved to 7pm')).toBeInTheDocument();
        expect(screen.queryByText('Please arrive early.')).toBeNull();
    });

    it('falls back to the first line for a notice with no title', () => {
        notices = [{ id: 'n1', body: 'Housekeeping\n\nNo password was used…' }];
        show();
        expect(screen.getByText('Housekeeping')).toBeInTheDocument();
    });
});
