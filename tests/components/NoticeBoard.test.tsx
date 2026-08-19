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
import { render, screen, act, fireEvent } from '@testing-library/react';
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

    it('carries no label — the flyer text already says what it is', () => {
        // Removed at the owner's request, along with the card's own styling. The
        // agenda is now indistinguishable from a notice, which is the intent.
        currentEvent = { agenda: 'Kirtan' };
        render(<NoticeBoard />);
        expect(screen.queryByText(/Sabha agenda/i)).toBeNull();
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

describe('whenEmpty', () => {
    /**
     * The dashboards must keep rendering nothing when there is nothing to say —
     * an empty panel headed "Notices" is furniture. The manager's Notices tab is
     * the one caller that wants a word instead, because there the emptiness
     * answers a question they just asked.
     */
    it('renders nothing when empty and no fallback is given', () => {
        const { container } = render(<NoticeBoard />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the fallback when empty and one is given', () => {
        render(<NoticeBoard whenEmpty={<p>Nothing on the board</p>} />);
        expect(screen.getByText('Nothing on the board')).toBeInTheDocument();
    });

    it('does NOT render the fallback once there is a notice', () => {
        notices = [{ id: 'n1', body: 'Something' }];
        render(<NoticeBoard whenEmpty={<p>Nothing on the board</p>} />);
        expect(screen.queryByText('Nothing on the board')).toBeNull();
        expect(screen.getByText('Something')).toBeInTheDocument();
    });

    it('does NOT render the fallback once there is an agenda', () => {
        // An agenda-only week is the common case, and it must not read as empty.
        currentEvent = { agenda: 'Kirtan' };
        render(<NoticeBoard whenEmpty={<p>Nothing on the board</p>} />);
        expect(screen.queryByText('Nothing on the board')).toBeNull();
        expect(screen.getByText('Kirtan')).toBeInTheDocument();
    });

    it('renders the fallback while still loading, rather than flashing empty', () => {
        loading = true;
        render(<NoticeBoard whenEmpty={<p>Nothing on the board</p>} />);
        expect(screen.getByText('Nothing on the board')).toBeInTheDocument();
    });
});

describe('long text is collapsed so the dashboard stays usable', () => {
    /**
     * The first version rendered a full 2000-character agenda whole. On a phone it
     * filled the screen and pushed the rider's request button and the Sarthi's
     * "go on shift" below the fold — the dashboard's entire purpose, hidden behind
     * an announcement.
     *
     * The invariant that matters: the clamp and the button come from one decision,
     * so text is never clipped without a way to open it. Silently truncated text
     * reads as a short notice, and nobody scrolls for the rest.
     */
    const LONG = 'x'.repeat(400);

    it('clamps a long notice and offers to open it', () => {
        notices = [{ id: 'n1', body: LONG }];
        render(<NoticeBoard />);

        expect(screen.getByText(LONG).className).toMatch(/line-clamp-6/);
        expect(screen.getByRole('button', { name: /Read more/ })).toBeInTheDocument();
    });

    it('drops the clamp when opened, and offers to close again', () => {
        notices = [{ id: 'n1', body: LONG }];
        render(<NoticeBoard />);

        fireEvent.click(screen.getByRole('button', { name: /Read more/ }));

        expect(screen.getByText(LONG).className).not.toMatch(/line-clamp/);
        expect(screen.getByRole('button', { name: /Show less/ })).toBeInTheDocument();
    });

    it('reports its state to assistive tech', () => {
        notices = [{ id: 'n1', body: LONG }];
        render(<NoticeBoard />);

        const button = screen.getByRole('button', { name: /Read more/ });
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        expect(screen.getByRole('button', { name: /Show less/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('leaves a short notice unclamped, with no button', () => {
        // A one-line notice with a "Read more" that reveals nothing is worse than
        // no control at all.
        notices = [{ id: 'n1', body: 'Sabha at 8:30 tonight.' }];
        render(<NoticeBoard />);

        expect(screen.getByText('Sabha at 8:30 tonight.').className).not.toMatch(/line-clamp/);
        expect(screen.queryByRole('button', { name: /Read more/ })).toBeNull();
    });

    it('never clamps without giving a way to expand', () => {
        // The two must agree. If they ever diverge, text is silently cut off.
        notices = [{ id: 'short', body: 'Tiny' }, { id: 'long', body: LONG }];
        currentEvent = { agenda: LONG };
        const { container } = render(<NoticeBoard />);

        const clamped = container.querySelectorAll('.line-clamp-6').length;
        const buttons = screen.getAllByRole('button', { name: /Read more/ }).length;
        expect(clamped).toBe(buttons);
        expect(clamped).toBe(2);
    });

    it('collapses a long agenda too, not only notices', () => {
        currentEvent = { agenda: LONG };
        render(<NoticeBoard />);
        expect(screen.getByText(LONG).className).toMatch(/line-clamp-6/);
    });

    it('keeps the line breaks while clamped', () => {
        // The clamp uses -webkit-box; pre-line has to survive it or the flyer
        // collapses into one paragraph.
        const flyer = Array.from({ length: 12 }, (_, i) => `Line ${i}`).join('\n');
        currentEvent = { agenda: flyer };
        render(<NoticeBoard />);

        const body = screen.getByText(/Line 0/);
        expect(body.className).toMatch(/whitespace-pre-line/);
        expect(body.className).toMatch(/line-clamp-6/);
        expect(body.textContent).toBe(flyer);
    });

    it('expands each card independently', () => {
        notices = [{ id: 'a', body: LONG }, { id: 'b', body: `${LONG}b` }];
        render(<NoticeBoard />);

        fireEvent.click(screen.getAllByRole('button', { name: /Read more/ })[0]!);

        expect(screen.getAllByRole('button', { name: /Read more/ })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: /Show less/ })).toHaveLength(1);
    });
});
