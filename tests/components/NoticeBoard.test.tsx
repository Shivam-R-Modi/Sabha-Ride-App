/**
 * The notice board, as everyone sees it.
 *
 * Three things carry weight here.
 *
 * The body is rendered as PLAIN TEXT with line breaks preserved. It is never
 * parsed as markup — `dangerouslySetInnerHTML` appears nowhere in this app, and a
 * manager-typed flyer on every family's dashboard is the last place to start.
 *
 * The image has an `onError`. No other `<img>` in this app has one; a notice
 * image is remote and on every dashboard, so a broken one would be a visible
 * failure with no explanation. On error the picture goes and the words stay.
 *
 * CHANGED 2026-08-24: each notice is a ROW that opens, one at a time, and a
 * collapsed row shows its title and NOT its body. Two notices carrying flyers had
 * been enough to push the rider's request button off the first screen. The body
 * assertions therefore open the row first — a collapsed notice's text is not in
 * the DOM at all, which is what "collapsed" should mean.
 *
 * The sabha agenda kept the old always-open card. It is not a notice: it has no
 * title to put on a row, there is only ever one of it, and hiding a single
 * unnamed thing behind a chevron gains nothing.
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

/** Open a row by the title on it. */
const openRow = (name: RegExp) =>
    fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
    notices = []; loading = false;
    currentEvent = null; eventLoading = false;
    // The "New" badge lives in localStorage. Without this, one test's opened row
    // silently marks it read for the next.
    window.localStorage.clear();
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

    it('heads the notices, but only when there are some', () => {
        // The heading lives INSIDE this component precisely so it cannot appear on
        // an empty week. In a dashboard it would render over nothing.
        notices = [{ id: 'n1', title: 'Sabha moved', body: 'To 7pm' }];
        render(<NoticeBoard />);
        expect(screen.getByRole('heading', { name: 'Notices' })).toBeInTheDocument();
    });

    it('keeps the line breaks the flyer format depends on', () => {
        notices = [{ id: 'n1', title: 'Two lines', body: 'Line one\n\nLine two' }];
        render(<NoticeBoard />);
        openRow(/Two lines/);

        const body = screen.getByText(/Line one/);
        expect(body.textContent).toBe('Line one\n\nLine two');
        expect(body.className).toMatch(/whitespace-pre-line/);
    });

    it('does NOT render the body as markup', () => {
        // React escapes by default; this pins it, because the day someone
        // reaches for markdown this test is the objection.
        notices = [{ id: 'n1', title: 'Nasty', body: '<img src=x onerror=alert(1)>' }];
        const { container } = render(<NoticeBoard />);
        openRow(/Nasty/);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });

    it('drops the image when it fails to load, and keeps the words', () => {
        notices = [{
            id: 'n1', title: 'Come along', body: 'Bring a friend',
            imageUrl: 'https://example.test/gone.jpg',
        }];
        render(<NoticeBoard />);
        openRow(/Come along/);

        const image = document.querySelector('img')!;
        expect(image).not.toBeNull();

        act(() => { image.dispatchEvent(new Event('error')); });

        expect(document.querySelector('img')).toBeNull();
        expect(screen.getByText('Bring a friend')).toBeInTheDocument();
    });

    it('shows newest first, as the hook orders them', () => {
        notices = [{ id: 'new', title: 'Newer', body: 'x' }, { id: 'old', title: 'Older', body: 'y' }];
        render(<NoticeBoard />);

        const rendered = screen.getAllByRole('heading', { name: /Newer|Older/ })
            .map(n => n.textContent);
        expect(rendered).toEqual(['Newer', 'Older']);
    });
});

describe('a collapsed notice shows its title, not its message', () => {
    /**
     * The whole reason for the change. Every notice used to render its whole body
     * on every dashboard, so two flyers were enough to bury the rider's request
     * button — and a truncated body used as a heading reads as though the notice
     * itself were that short.
     */
    it('shows the title and hides the body until asked', () => {
        notices = [{ id: 'n1', title: 'Sabha this Sunday', body: 'Please arrive by 9.' }];
        render(<NoticeBoard />);

        expect(screen.getByText('Sabha this Sunday')).toBeInTheDocument();
        expect(screen.queryByText('Please arrive by 9.')).toBeNull();
    });

    it('reveals the body when opened, and hides it again when closed', () => {
        notices = [{ id: 'n1', title: 'Sabha this Sunday', body: 'Please arrive by 9.' }];
        render(<NoticeBoard />);

        openRow(/Sabha this Sunday/);
        expect(screen.getByText('Please arrive by 9.')).toBeInTheDocument();

        openRow(/Sabha this Sunday/);
        expect(screen.queryByText('Please arrive by 9.')).toBeNull();
    });

    it('renders no image at all while collapsed', () => {
        // A flyer costs nothing until someone opens it, and a text-only notice
        // has never had an <img> to break.
        notices = [{
            id: 'n1', title: 'Flyer', body: 'x', imageUrl: 'https://example.test/f.jpg',
        }];
        const { container } = render(<NoticeBoard />);
        expect(container.querySelector('img')).toBeNull();

        openRow(/Flyer/);
        expect(container.querySelector('img')).not.toBeNull();
    });

    it('reports its state to assistive tech', () => {
        notices = [{ id: 'n1', title: 'Sabha this Sunday', body: 'x' }];
        render(<NoticeBoard />);

        const row = screen.getByRole('button', { name: /Sabha this Sunday/ });
        expect(row).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(row);
        expect(row).toHaveAttribute('aria-expanded', 'true');
    });

    it('falls back to the body first line for the two notices with no title', () => {
        // Both live notices predate the field and cannot be given one
        // retrospectively. Their bodies open with a short line, which is the shape
        // the composer's placeholder has always taught.
        notices = [{ id: 'n1', body: 'Housekeeping\n\nNo password was used…' }];
        render(<NoticeBoard />);

        expect(screen.getByRole('button', { name: /Housekeeping/ })).toBeInTheDocument();
        expect(screen.queryByText(/No password was used/)).toBeNull();
    });

    it('shows the day it was posted', () => {
        notices = [{ id: 'n1', title: 'Sabha moved', body: 'x', createdAt: '2026-08-24T21:07:29.406Z' }];
        render(<NoticeBoard />);
        expect(screen.getByText('Aug 24, 2026')).toBeInTheDocument();
    });

    it('survives a notice with no usable createdAt, rather than blanking the dashboard', () => {
        // `formatDate` throws a RangeError on an unparseable date, and this
        // renders on every rider's home screen. The date is the least important
        // thing on the row, so the date is what gives way.
        notices = [{ id: 'n1', title: 'Sabha moved', body: 'x', createdAt: 'not a date' }];
        expect(() => render(<NoticeBoard />)).not.toThrow();
        expect(screen.getByText('Sabha moved')).toBeInTheDocument();
    });
});

describe('only one notice is open at a time', () => {
    /**
     * The owner's call, and the same reasoning ManagerSetup's accordion already
     * carries: two open at once means scrolling past one to reach the other, which
     * is the pile that collapsing them was meant to end.
     *
     * It holds by construction — one `openId` rather than a boolean per row — so
     * there is no state to synchronise and no way for two rows to disagree.
     */
    beforeEach(() => {
        notices = [
            { id: 'a', title: 'First notice', body: 'Body of the first' },
            { id: 'b', title: 'Second notice', body: 'Body of the second' },
        ];
    });

    it('closes the open one when another is opened', () => {
        render(<NoticeBoard />);

        openRow(/First notice/);
        expect(screen.getByText('Body of the first')).toBeInTheDocument();

        openRow(/Second notice/);
        expect(screen.getByText('Body of the second')).toBeInTheDocument();
        expect(screen.queryByText('Body of the first')).toBeNull();
    });

    it('never reports two rows as expanded', () => {
        render(<NoticeBoard />);

        openRow(/First notice/);
        openRow(/Second notice/);

        const expanded = screen.getAllByRole('button')
            .filter(b => b.getAttribute('aria-expanded') === 'true');
        expect(expanded).toHaveLength(1);
    });

    it('starts with everything closed', () => {
        // Not even the newest opens itself. A lone new notice that auto-expanded
        // would clear its own "New" badge before anyone had read it.
        render(<NoticeBoard />);

        expect(screen.queryByText('Body of the first')).toBeNull();
        expect(screen.queryByText('Body of the second')).toBeNull();
    });
});

describe('a notice not yet opened on this device is badged New', () => {
    /**
     * Device-scoped in localStorage, on purpose. Nothing in Firestore records "I
     * have read this" for any feature, and the app's two other "already dealt
     * with" flags — the install dismissal and the push pre-prompt — are both
     * localStorage for the same reason: a badge is worth no writes and no new
     * field on a user document holding a child's address.
     */
    beforeEach(() => {
        notices = [{ id: 'n1', title: 'Sabha moved', body: 'To 7pm' }];
    });

    it('badges a notice never opened here', () => {
        render(<NoticeBoard />);
        expect(screen.getByText('New')).toBeInTheDocument();
    });

    it('drops the badge as soon as the row is opened', () => {
        render(<NoticeBoard />);
        openRow(/Sabha moved/);
        expect(screen.queryByText('New')).toBeNull();
    });

    it('keeps it dropped after closing the row again', () => {
        // Opened is opened. The badge answers "have I looked at this", not "is it
        // on screen right now".
        render(<NoticeBoard />);
        openRow(/Sabha moved/);
        openRow(/Sabha moved/);
        expect(screen.queryByText('New')).toBeNull();
    });

    it('keeps it dropped across a remount', () => {
        // The reason it is stored at all — a reload must not make read notices new
        // again.
        const first = render(<NoticeBoard />);
        openRow(/Sabha moved/);
        first.unmount();

        render(<NoticeBoard />);
        expect(screen.queryByText('New')).toBeNull();
    });

    it('badges only the unopened one when there are several', () => {
        notices = [
            { id: 'a', title: 'Read this one', body: 'x' },
            { id: 'b', title: 'Not this one', body: 'y' },
        ];
        render(<NoticeBoard />);
        openRow(/Read this one/);

        expect(screen.getAllByText('New')).toHaveLength(1);
    });

    it('never badges the agenda, which has no id to remember', () => {
        notices = [];
        currentEvent = { agenda: 'Kirtan, then dinner' };
        render(<NoticeBoard />);

        expect(screen.queryByText('New')).toBeNull();
    });

    it('remembers both when two rows are opened before a re-render', () => {
        // THE BUG THIS EXISTS FOR, found in the browser rather than here. Every
        // update used to read the current `seen`, append and write; two clicks in
        // one tick handed the second handler the same stale array, so it wrote
        // ['b'] over ['a'] and the first notice went back to being New.
        //
        // `act` around BOTH clicks is what reproduces it — one act() per click, as
        // the tests above do, lets React re-render in between and the bug hides.
        notices = [
            { id: 'a', title: 'First notice', body: 'x' },
            { id: 'b', title: 'Second notice', body: 'y' },
        ];
        render(<NoticeBoard />);

        const [first, second] = screen.getAllByRole('button');
        act(() => {
            first!.click();
            second!.click();
        });

        expect(JSON.parse(window.localStorage.getItem('sabha-seen-notices') ?? '[]'))
            .toEqual(['a', 'b']);
        expect(screen.queryByText('New')).toBeNull();
    });

    it('forgets a notice that has left the board', () => {
        // Expired notices are deleted server-side. Their ids are pruned on load,
        // so the key cannot grow for the life of the install.
        render(<NoticeBoard />);
        openRow(/Sabha moved/);

        const stored = () => JSON.parse(window.localStorage.getItem('sabha-seen-notices') ?? '[]');
        expect(stored()).toEqual(['n1']);

        notices = [{ id: 'n2', title: 'A newer one', body: 'z' }];
        render(<NoticeBoard />);
        expect(stored()).toEqual([]);
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
        // Removed at the owner's request, along with the card's own styling.
        currentEvent = { agenda: 'Kirtan' };
        render(<NoticeBoard />);
        expect(screen.queryByText(/Sabha agenda/i)).toBeNull();
    });

    it('is not behind a chevron like the notices', () => {
        // It has no title to put on a row, and there is only ever one of it.
        // Collapsing a single unnamed thing hides it for no gain.
        currentEvent = { agenda: 'Kirtan, then dinner' };
        render(<NoticeBoard />);

        expect(screen.getByText('Kirtan, then dinner')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Kirtan/ })).toBeNull();
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
        notices = [{ id: 'n1', title: 'NOTICE', body: 'x' }];
        render(<NoticeBoard />);

        const agenda = screen.getByText('AGENDA');
        const notice = screen.getByText('NOTICE');
        expect(agenda.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
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
        notices = [{ id: 'n1', title: 'Still shown', body: 'x' }];
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
        notices = [{ id: 'n1', title: 'Something', body: 'x' }];
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

describe('a long agenda is collapsed so the dashboard stays usable', () => {
    /**
     * The first version rendered a full 2000-character agenda whole. On a phone it
     * filled the screen and pushed the rider's request button and the Sarthi's
     * "go on shift" below the fold — the dashboard's entire purpose, hidden behind
     * an announcement.
     *
     * The invariant that matters: the clamp and the button come from one decision,
     * so text is never clipped without a way to open it. Silently truncated text
     * reads as a short notice, and nobody scrolls for the rest.
     *
     * THE AGENDA IS THE ONLY THING THIS STILL APPLIES TO. A notice is a row that
     * opens, and the row IS the disclosure; a "Read more" inside an opened notice
     * would be a second control, two deep, for the same text.
     */
    const LONG = 'x'.repeat(400);

    it('clamps a long agenda and offers to open it', () => {
        currentEvent = { agenda: LONG };
        render(<NoticeBoard />);

        expect(screen.getByText(LONG).className).toMatch(/line-clamp-6/);
        expect(screen.getByRole('button', { name: /Read more/ })).toBeInTheDocument();
    });

    it('drops the clamp when opened, and offers to close again', () => {
        currentEvent = { agenda: LONG };
        render(<NoticeBoard />);

        fireEvent.click(screen.getByRole('button', { name: /Read more/ }));

        expect(screen.getByText(LONG).className).not.toMatch(/line-clamp/);
        expect(screen.getByRole('button', { name: /Show less/ })).toBeInTheDocument();
    });

    it('reports its state to assistive tech', () => {
        currentEvent = { agenda: LONG };
        render(<NoticeBoard />);

        const button = screen.getByRole('button', { name: /Read more/ });
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        expect(screen.getByRole('button', { name: /Show less/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('leaves a short agenda unclamped, with no button', () => {
        // A one-line agenda with a "Read more" that reveals nothing is worse than
        // no control at all.
        currentEvent = { agenda: 'Kirtan at 8:30 tonight.' };
        render(<NoticeBoard />);

        expect(screen.getByText('Kirtan at 8:30 tonight.').className).not.toMatch(/line-clamp/);
        expect(screen.queryByRole('button', { name: /Read more/ })).toBeNull();
    });

    it('never clamps without giving a way to expand', () => {
        // The two must agree. If they ever diverge, text is silently cut off.
        currentEvent = { agenda: LONG };
        notices = [{ id: 'long', title: 'A long notice', body: LONG }];
        const { container } = render(<NoticeBoard />);

        const clamped = container.querySelectorAll('.line-clamp-6').length;
        const buttons = screen.getAllByRole('button', { name: /Read more/ }).length;
        expect(clamped).toBe(buttons);
        expect(clamped).toBe(1);
    });

    it('does not clamp an opened notice — the row was the disclosure', () => {
        notices = [{ id: 'long', title: 'A long notice', body: LONG }];
        const { container } = render(<NoticeBoard />);
        openRow(/A long notice/);

        expect(screen.getByText(LONG).className).not.toMatch(/line-clamp/);
        expect(container.querySelectorAll('.line-clamp-6')).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /Read more/ })).toBeNull();
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
});
