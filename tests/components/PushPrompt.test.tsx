/**
 * The offer to turn notifications on.
 *
 * It is a PRE-prompt, and that is the whole design. The OS dialog is one-shot:
 * on iOS a refusal can only be undone in Settings. So the real dialog is raised
 * only for someone who already said yes to this, which is reversible.
 *
 * The assertions that matter are the ones about NOT showing it — an ask that
 * cannot succeed is worse than no ask, because it spends the one chance.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const push = { availability: 'off', busy: false, error: null, enable: vi.fn(), disable: vi.fn() };
vi.mock('../../hooks/usePush', () => ({ usePush: () => push }));

import { PushPrompt } from '../../components/shared/PushPrompt';
import { PUSH_DISMISS_KEY, readPushDismissals } from '../../src/utils/push';

beforeEach(() => {
    window.localStorage.clear();
    push.availability = 'off';
    push.busy = false;
    vi.clearAllMocks();
});

describe('PushPrompt', () => {
    it('offers when push is available and untried', () => {
        render(<PushPrompt />);
        expect(screen.getByText(/Get told when your Sarthi is on the way/i)).toBeInTheDocument();
    });

    it('says exactly what will be sent', () => {
        // A vague promise is what makes people refuse. "Nothing else" is load-bearing.
        render(<PushPrompt />);
        expect(screen.getByText(/One notification when a Sarthi is assigned.*Nothing else/i)).toBeInTheDocument();
    });

    it('shows nothing in an iOS browser tab', () => {
        // Tapping would burn the one permission prompt on a context that can
        // never receive push.
        push.availability = 'needs-install';
        const { container } = render(<PushPrompt />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows nothing once the browser has refused', () => {
        push.availability = 'blocked';
        const { container } = render(<PushPrompt />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows nothing to someone who already turned it on', () => {
        push.availability = 'on';
        const { container } = render(<PushPrompt />);
        expect(container).toBeEmptyDOMElement();
    });

    it('raises the real dialog only on a deliberate tap', () => {
        render(<PushPrompt />);
        act(() => { screen.getByText(/Turn on notifications/i).click(); });
        expect(push.enable).toHaveBeenCalledTimes(1);
    });

    it('remembers a refusal and stops asking in this session', () => {
        const view = render(<PushPrompt />);
        act(() => { screen.getByText('Not now').click(); });

        expect(readPushDismissals().count).toBe(1);
        expect(view.container).toBeEmptyDOMElement();
    });

    it('stays away after two refusals, across a remount', () => {
        window.localStorage.setItem(PUSH_DISMISS_KEY, JSON.stringify({ count: 2, lastAt: 0 }));
        const { container } = render(<PushPrompt />);
        expect(container).toBeEmptyDOMElement();
    });
});
