/**
 * The address field's suggestion list. It had no tests, and it had a visible bug.
 *
 * WHAT THIS FILE EXISTS FOR: the list was cut off at the bottom edge of the card it sat
 * in. It was `position: absolute` inside the input's wrapper, and four of the six call
 * sites live inside an `overflow-hidden` ancestor — SabhaCalendar's two cards,
 * LocationSettings, and `Disclosure`, which wraps every section of the airport request
 * form. `overflow: hidden` clips an absolutely positioned descendant however high its
 * z-index is, so this was never a stacking problem.
 *
 * The list is now portalled to `document.body`. The assertion that matters is that it is
 * NOT a descendant of the wrapper — that is the whole fix, and the only thing that makes
 * it immune to whatever a caller wraps it in.
 *
 * The second-most important assertion is that selecting still works. The outside-click
 * handler closes on `mousedown` against `wrapperRef`, and once the list is portalled it
 * is no longer inside that ref — so without a second ref, mousedown on a suggestion
 * reads as an outside click, the list closes before the click lands, and choosing an
 * address silently does nothing.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PREDICTIONS = [
    { placeId: 'p1', description: '356 Western Avenue, Brookline, MA, USA', mainText: '356 Western Avenue', secondaryText: 'Brookline, MA, USA' },
    { placeId: 'p2', description: '356 Boylston St, Boston, MA, USA', mainText: '356 Boylston St', secondaryText: 'Boston, MA, USA' },
];

/**
 * `results` is what Google would answer; `predictions` is what the hook is currently
 * holding. Keeping them apart matters: the component calls `clearPredictions()` on every
 * keystroke below three characters, so a mock where that wiped the ONLY copy left
 * nothing to show by the time the third character arrived — which is what the first run
 * of this file reported as "the list is missing".
 */
let results: typeof PREDICTIONS = PREDICTIONS;
let predictions: typeof PREDICTIONS = [];
const getPlacePredictions = vi.fn(() => { predictions = results; });
const clearPredictions = vi.fn(() => { predictions = []; });
const getPlaceDetails = vi.fn(async () => ({
    formattedAddress: '356 Western Avenue, Brookline, MA, USA', lat: 42.34, lng: -71.12,
}));
vi.mock('../../hooks/useGooglePlaces', () => ({
    useGooglePlaces: () => ({
        predictions, loading: false, getPlacePredictions, getPlaceDetails, clearPredictions,
    }),
}));

import { AddressAutocomplete } from '../../components/auth/AddressAutocomplete';

const onChange = vi.fn();
const onSelect = vi.fn();

/**
 * STATEFUL, because the component is controlled: it opens the list from
 * `e.target.value.length >= 3`, and a parent that never feeds the new value back means
 * React resets the box on every keystroke and the length never gets past 1. The first
 * version of this file did exactly that and reported the list missing.
 *
 * Wrapped in an `overflow-hidden` box on purpose — the exact shape of the four call
 * sites where the bug showed. Rendered bare, these assertions would pass either way.
 */
const Harness: React.FC = () => {
    const [value, setValue] = React.useState('');
    return (
        <div data-testid="clipping-card" style={{ overflow: 'hidden' }}>
            <AddressAutocomplete
                value={value}
                onChange={(v) => { setValue(v); onChange(v); }}
                onSelect={onSelect}
            />
        </div>
    );
};

const show = () => render(<Harness />);

const type = async (text: string) => {
    await userEvent.type(screen.getByRole('textbox'), text);
};

beforeEach(() => {
    vi.clearAllMocks();
    results = PREDICTIONS;
    predictions = [];
});

describe('the suggestion list escapes whatever it is nested in', () => {
    it('renders outside the clipping ancestor, not inside it', async () => {
        show();
        await type('356');

        const list = screen.getByRole('list');
        const card = screen.getByTestId('clipping-card');
        // THE FIX. Inside the card, `overflow: hidden` cuts it off at the card's edge.
        expect(card.contains(list)).toBe(false);
        expect(document.body.contains(list)).toBe(true);
    });

    it('is pinned with position: fixed, so no ancestor can scroll it away', async () => {
        show();
        await type('356');
        expect(screen.getByRole('list').style.position).toBe('fixed');
    });

    it('shows every suggestion it was given', async () => {
        show();
        await type('356');
        expect(screen.getByText('356 Western Avenue')).toBeInTheDocument();
        expect(screen.getByText('356 Boylston St')).toBeInTheDocument();
    });
});

describe('choosing an address', () => {
    it('still works once the list is portalled', async () => {
        // The regression this fix could easily have introduced: mousedown on a
        // suggestion is outside `wrapperRef`, so a naive outside-click handler closes
        // the list before the click arrives.
        show();
        await type('356');
        await userEvent.click(screen.getByText('356 Western Avenue'));

        expect(getPlaceDetails).toHaveBeenCalledWith('p1');
        expect(onChange).toHaveBeenCalledWith('356 Western Avenue, Brookline, MA, USA');
    });

    it('closes on a click that really is outside', async () => {
        show();
        await type('356');
        expect(screen.getByRole('list')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('picks with the keyboard too', async () => {
        show();
        await type('356');
        const box = screen.getByRole('textbox');
        await userEvent.type(box, '{ArrowDown}{Enter}');
        expect(getPlaceDetails).toHaveBeenCalledWith('p1');
    });
});

describe('when there is nothing to suggest', () => {
    it('renders no list at all rather than an empty one', async () => {
        results = [];
        show();
        await type('356');
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('does not ask Google until there are enough characters to be worth it', async () => {
        results = [];
        show();
        await type('35');
        expect(getPlacePredictions).not.toHaveBeenCalled();
    });
});

/**
 * WHICH WAY IT OPENS. `position: fixed` bought immunity from clipping and brought a new
 * hazard with it: absolutely positioned, a list running past the bottom of the page
 * could still be scrolled to; pinned to the viewport it cannot, so it would sit
 * off-screen with no way to reach it. That would be a worse bug than the one being
 * fixed.
 *
 * jsdom is the right place to prove this — `getBoundingClientRect` returns zeros here by
 * default, so the rect is stubbed per case and `innerHeight` set explicitly. The browser
 * pane could not be used: it reports `innerHeight` as 0.
 */
describe('which way it opens', () => {
    const atY = (top: number, height = 48, width = 300) => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            top, bottom: top + height, left: 20, right: 20 + width, width, height, x: 20, y: top,
            toJSON: () => ({}),
        } as DOMRect);
    };

    afterEach(() => { vi.restoreAllMocks(); });

    it('opens downward when there is room below', async () => {
        window.innerHeight = 800;
        atY(100);
        show();
        await type('356');
        const style = screen.getByRole('list').style;
        // Just under the input: 148 + a 4px gap.
        expect(style.top).toBe('152px');
        expect(style.maxHeight).toBe('240px');
    });

    it('FLIPS ABOVE when the input is near the bottom', async () => {
        window.innerHeight = 300;
        atY(240); // bottom 288, so only 8px below and 240 above
        show();
        await type('356');
        const style = screen.getByRole('list').style;
        // 240 (input top) − 4 gap − 240 maxHeight = −4. Above, not below.
        expect(parseInt(style.top, 10)).toBeLessThan(240);
    });

    it('clamps its height to the space it has rather than overflowing', async () => {
        window.innerHeight = 400;
        atY(100); // 252 below, less than the preferred 240? no — 400-148-4 = 248
        show();
        await type('356');
        expect(parseInt(screen.getByRole('list').style.maxHeight, 10)).toBeLessThanOrEqual(240);
    });

    it('opens downward at full height when the viewport height is unreadable', async () => {
        // The in-app browser pane reports 0. Without the guard the arithmetic decides
        // there is no room anywhere and crams the list to 96px at the top.
        window.innerHeight = 0;
        atY(100);
        show();
        await type('356');
        const style = screen.getByRole('list').style;
        expect(style.top).toBe('152px');
        expect(style.maxHeight).toBe('240px');
    });

    it('matches the width of the field it belongs to', async () => {
        window.innerHeight = 800;
        atY(100, 48, 420);
        show();
        await type('356');
        expect(screen.getByRole('list').style.width).toBe('420px');
    });
});
