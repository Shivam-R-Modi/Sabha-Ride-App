/**
 * The notice board, as everyone sees it.
 *
 * Two things carry weight here.
 *
 * The body is rendered as PLAIN TEXT with line breaks preserved. It is never
 * parsed as markup — `dangerouslySetInnerHTML` appears nowhere in this app, and a
 * manager-typed flyer on every family's dashboard is the last place to start.
 *
 * The image has an `onError`. No other `<img>` in this app has one; a notice
 * image is remote and on every dashboard, so a broken one would be a visible
 * failure with no explanation. On error the picture goes and the words stay.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let notices: any[] = [];
let loading = false;
vi.mock('../../hooks/useNotices', () => ({ useNotices: () => ({ notices, loading }) }));

import { NoticeBoard } from '../../components/shared/NoticeBoard';

beforeEach(() => { notices = []; loading = false; });

describe('NoticeBoard', () => {
    it('renders nothing when there is nothing to say', () => {
        // An empty panel headed "Notices" is furniture.
        const { container } = render(<NoticeBoard />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing while it is still loading', () => {
        loading = true;
        const { container } = render(<NoticeBoard />);
        expect(container).toBeEmptyDOMElement();
    });

    it('keeps the line breaks the flyer format depends on', () => {
        notices = [{ id: 'n1', body: 'Line one\n\nLine two' }];
        render(<NoticeBoard />);

        const body = screen.getByText(/Line one/);
        expect(body.textContent).toBe('Line one\n\nLine two');
        expect(body.className).toMatch(/whitespace-pre-line/);
    });

    it('does NOT render the body as markup', () => {
        // React escapes by default; this pins it, because the day someone
        // reaches for markdown this test is the objection.
        notices = [{ id: 'n1', body: '<img src=x onerror=alert(1)>' }];
        const { container } = render(<NoticeBoard />);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });

    it('drops the image when it fails to load, and keeps the words', () => {
        notices = [{ id: 'n1', body: 'Come along', imageUrl: 'https://example.test/gone.jpg' }];
        render(<NoticeBoard />);

        const image = document.querySelector('img')!;
        expect(image).not.toBeNull();

        act(() => { image.dispatchEvent(new Event('error')); });

        expect(document.querySelector('img')).toBeNull();
        expect(screen.getByText('Come along')).toBeInTheDocument();
    });

    it('shows newest first, as the hook orders them', () => {
        notices = [{ id: 'new', body: 'Newer' }, { id: 'old', body: 'Older' }];
        render(<NoticeBoard />);

        const rendered = screen.getAllByText(/Newer|Older/).map(n => n.textContent);
        expect(rendered).toEqual(['Newer', 'Older']);
    });
});
