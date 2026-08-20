/**
 * The splash screen, which now waits for a tap.
 *
 * WHY THIS FILE EXISTS AT ALL: the auto-dismiss timer is gone at the owner's
 * request, so the tap is the ONLY way out of this screen. If it ever stops
 * working, the app is bricked at launch for everyone — no rider can request a
 * ride, no Sarthi can go on shift, and the screen looks perfectly fine while it
 * happens. That is the worst failure this repo has a name for: a control that is
 * visible and does nothing.
 *
 * The history is worth keeping because it has gone both ways. A tap was originally
 * required; the Phase 3 redesign removed it as "one mandatory, meaningless tap
 * before every launch"; the owner reversed that on 2026-08-19. So the absence of a
 * timer is a decision, not an oversight.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SplashScreen } from '../../components/auth/SplashScreen';

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the only way out', () => {
    it('calls onComplete when tapped', () => {
        const onComplete = vi.fn();
        const { container } = render(<SplashScreen onComplete={onComplete} />);

        fireEvent.click(container.firstElementChild!);

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('does NOT dismiss itself, however long it is left', () => {
        // The assertion that fails if a timer is ever put back. It was 1800ms
        // before; 30 seconds covers any plausible replacement.
        const onComplete = vi.fn();
        render(<SplashScreen onComplete={onComplete} />);

        act(() => { vi.advanceTimersByTime(30_000); });

        expect(onComplete).not.toHaveBeenCalled();
    });

    it('is still tappable after being left for a while', () => {
        // Guards the combination: no timer AND a live handler.
        const onComplete = vi.fn();
        const { container } = render(<SplashScreen onComplete={onComplete} />);

        act(() => { vi.advanceTimersByTime(30_000); });
        fireEvent.click(container.firstElementChild!);

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('tells the reader what to do', () => {
        // With no timer, a screen that does not say it wants a tap is a dead end.
        render(<SplashScreen onComplete={vi.fn()} />);
        expect(screen.getByText('Tap to continue')).toBeInTheDocument();
    });
});

describe('the quote', () => {
    it('shows one', () => {
        render(<SplashScreen onComplete={vi.fn()} />);
        // Gujarati, so match on script rather than a literal.
        const quote = screen.getByText(/[઀-૿]/);
        expect(quote.textContent!.length).toBeGreaterThan(5);
    });

    it('advances to the next one for the following launch', () => {
        render(<SplashScreen onComplete={vi.fn()} />);
        expect(localStorage.getItem('sabha_ride_quote_index')).toBe('1');
    });

    it('wraps round rather than running out', () => {
        // A stored index past the end would otherwise render `undefined`.
        localStorage.setItem('sabha_ride_quote_index', '2');
        render(<SplashScreen onComplete={vi.fn()} />);
        expect(localStorage.getItem('sabha_ride_quote_index')).toBe('0');
        expect(screen.getByText(/[઀-૿]/)).toBeInTheDocument();
    });
});

describe('covering the screen', () => {
    /**
     * Two viewports are in play on a phone and they are DIFFERENT SIZES: `svh` is
     * the screen with browser chrome showing, `lvh` is the screen with it
     * retracted. Content must live inside the small one to stay visible; the
     * picture must fill the large one so no strip is left when the chrome hides.
     * One element cannot be both — hence two.
     *
     * The first attempt sized the whole thing to `100lvh + safe-area` and the
     * report came back with "Tap to continue" sliced in half, because the content
     * was bottom-aligned inside a box taller than the screen.
     */
    const boxOf = (c: HTMLElement) => c.firstElementChild as HTMLElement;
    const photoOf = (c: HTMLElement) => c.querySelector('[aria-hidden="true"]') as HTMLElement;

    it('sizes the CONTENT box to the small viewport, so the tap line stays visible', () => {
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        expect(boxOf(container).style.height).toBe('100svh');
    });

    it('never sizes the content box to the large viewport', () => {
        // The exact regression: lvh on the content box hides the bottom of it.
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        expect(boxOf(container).style.height).not.toMatch(/lvh/);
    });

    it('paints the photograph past the bottom, on its own layer', () => {
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        const style = photoOf(container).getAttribute('style') ?? '';

        expect(style).toMatch(/100lvh/);
        expect(style).toMatch(/safe-area-inset-bottom/);
        expect(style).toMatch(/background-image/);
    });

    it('keeps the photo layer behind the words and out of the tap path', () => {
        // It is decoration. If it ever swallowed the click, the tap would be the
        // only way out of this screen and it would be gone.
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        const photo = photoOf(container);

        expect(photo.className).toMatch(/-z-10/);
        expect(photo.className).toMatch(/pointer-events-none/);
        expect(photo.getAttribute('aria-hidden')).toBe('true');
    });

    it('still dismisses when the tap lands on the photo layer', () => {
        // pointer-events-none means the click retargets to the box; prove it.
        const onComplete = vi.fn();
        const { container } = render(<SplashScreen onComplete={onComplete} />);

        fireEvent.click(photoOf(container));

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('has a dark colour behind everything', () => {
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        // jsdom normalises hex to rgb(). #1C1815 is rgb(28, 24, 21) — the same warm
        // near-black as the dark canvas, written literally and NOT as a theme token:
        // this screen is dark in both themes, so `--canvas` would put a near-white
        // band under a dark photograph in light mode.
        expect(boxOf(container).style.backgroundColor).toBe('rgb(28, 24, 21)');
    });
});
