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
    it('overshoots the bottom instead of matching the viewport exactly', () => {
        // `position: fixed` is sized to the VISUAL viewport; the canvas html paints
        // can extend past it, under retracted chrome and into the home-indicator
        // inset. That difference was the strip along the bottom of a phone.
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        const style = (container.firstElementChild as HTMLElement).getAttribute('style') ?? '';

        expect(style).toMatch(/100lvh/);
        expect(style).toMatch(/safe-area-inset-bottom/);
    });

    it('has a dark colour behind the photograph', () => {
        const { container } = render(<SplashScreen onComplete={vi.fn()} />);
        // jsdom normalises hex to rgb(), so assert on the colour rather than the
        // notation. #1C1815 is rgb(28, 24, 21) — the same warm near-black as the
        // dark canvas, but written literally and NOT as a theme token: this screen
        // is dark in both themes, so `--canvas` would put a near-white band under a
        // dark photograph in light mode.
        const el = container.firstElementChild as HTMLElement;
        expect(el.style.backgroundColor).toBe('rgb(28, 24, 21)');
    });
});
