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

// Mocked deliberately. Without it this component reaches real Firestore, the
// agenda is always undefined, and every assertion below passes for the wrong
// reason — the agenda half would be untested while looking covered.
let currentEvent: any = null;
let eventLoading = false;
vi.mock('../../hooks/useCurrentEvent', () => ({
    useCurrentEvent: () => ({ event: currentEvent, loading: eventLoading }),
}));

import { NoticeBoard } from '../../components/shared/NoticeBoard';

beforeEach(() => {
    notices = []; loading = false;
    currentEvent = null; eventLoading = false;
});

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

describe('the sabha agenda', () => {
    /**
     * The agenda was carried correctly through four layers — the calendar, the
     * event document, the recurrence resolver, `system/rideContext` — and then
     * rendered by nothing. A manager could type it and no rider or Sarthi would
     * ever see it. These are the tests that would have caught that.
     */
    it('shows the agenda for the upcoming sabha', () => {
        currentEvent = { agenda: 'Kirtan, then dinner' };
        render(<NoticeBoard />);
        expect(screen.getByText('Kirtan, then dinner')).toBeInTheDocument();
    });

    it('labels it, so it is not mistaken for a notice', () => {
        currentEvent = { agenda: 'Kirtan' };
        render(<NoticeBoard />);
        expect(screen.getByText('Sabha agenda')).toBeInTheDocument();
    });

    it('keeps the line breaks a long agenda depends on', () => {
        currentEvent = { agenda: '6:30 Kirtan\n7:15 Katha\n\n8:00 Prasad' };
        render(<NoticeBoard />);

        const body = screen.getByText(/6:30 Kirtan/);
        expect(body.textContent).toBe('6:30 Kirtan\n7:15 Katha\n\n8:00 Prasad');
        expect(body.className).toMatch(/whitespace-pre-line/);
    });

    it('does NOT render the agenda as markup', () => {
        // Same reasoning as the notice body: a manager types this, everyone reads it.
        currentEvent = { agenda: '<img src=x onerror=alert(1)>' };
        const { container } = render(<NoticeBoard />);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });

    it('renders with an agenda and no notices at all', () => {
        // The board used to return null whenever `notices` was empty. An
        // agenda-only week is the common case, so that had to change.
        currentEvent = { agenda: 'Youth sabha this week' };
        const { container } = render(<NoticeBoard />);
        expect(container).not.toBeEmptyDOMElement();
        expect(screen.getByText('Youth sabha this week')).toBeInTheDocument();
    });

    it('puts the agenda above the notices', () => {
        // It belongs to the evening people are about to attend.
        currentEvent = { agenda: 'AGENDA' };
        notices = [{ id: 'n1', body: 'NOTICE' }];
        render(<NoticeBoard />);

        const order = screen.getAllByText(/AGENDA|NOTICE/).map(n => n.textContent);
        expect(order).toEqual(['AGENDA', 'NOTICE']);
    });

    it('ignores an empty or whitespace-only agenda', () => {
        // `agenda` defaults to '' all the way through the recurrence resolver, so
        // the overwhelmingly common value is the empty string.
        currentEvent = { agenda: '   \n  ' };
        const { container } = render(<NoticeBoard />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows nothing while the event is still loading', () => {
        eventLoading = true;
        currentEvent = { agenda: 'Not ready yet' };
        const { container } = render(<NoticeBoard />);
        expect(container).toBeEmptyDOMElement();
    });

    it('survives no scheduled sabha at all', () => {
        // `useCurrentEvent` returns event: null when the calendar is empty.
        currentEvent = null;
        notices = [{ id: 'n1', body: 'Still shown' }];
        render(<NoticeBoard />);
        expect(screen.getByText('Still shown')).toBeInTheDocument();
    });
});
