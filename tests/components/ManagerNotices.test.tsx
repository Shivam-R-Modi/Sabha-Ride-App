/**
 * The Notices tab, including the preview of what the congregation sees.
 *
 * The preview exists because the manager dashboard cannot be relied on for it:
 * managers land on the Waiting tab, and the board lives in the other tab's scroll
 * region — Waiting is a fixed-height queue and anything above it would shrink the
 * one thing a manager needs during a sabha. So this tab is where the answer to
 * "what does everyone see right now?" is always available.
 *
 * It renders the REAL NoticeBoard, not a mock-up of one. A preview that can drift
 * from the thing it previews is worse than no preview.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The composers reach Firebase and callables; neither is under test here.
vi.mock('../../components/manager/NoticeComposer', () => ({
    NoticeComposer: () => <div data-testid="notice-composer" />,
}));
vi.mock('../../components/manager/BroadcastComposer', () => ({
    BroadcastComposer: () => <div data-testid="broadcast-composer" />,
}));

// The board's own data sources, mocked the same way NoticeBoard.test.tsx does —
// without this the component reaches real Firestore and every assertion about the
// preview would pass for the wrong reason.
let notices: any[] = [];
let currentEvent: any = null;
vi.mock('../../hooks/useNotices', () => ({ useNotices: () => ({ notices, loading: false }) }));
vi.mock('../../hooks/useCurrentEvent', () => ({
    useCurrentEvent: () => ({ event: currentEvent, loading: false }),
}));

import { ManagerNotices } from '../../components/manager/ManagerNotices';

beforeEach(() => { notices = []; currentEvent = null; });

describe('ManagerNotices', () => {
    it('still shows both composers', () => {
        render(<ManagerNotices />);
        expect(screen.getByTestId('notice-composer')).toBeInTheDocument();
        expect(screen.getByTestId('broadcast-composer')).toBeInTheDocument();
    });

    it('previews a posted notice exactly as everyone sees it', () => {
        notices = [{ id: 'n1', body: 'Sabha this Friday' }];
        render(<ManagerNotices />);
        expect(screen.getByText('Sabha this Friday')).toBeInTheDocument();
    });

    it('previews the sabha agenda too', () => {
        currentEvent = { agenda: '6:30 Kirtan\n7:15 Katha' };
        render(<ManagerNotices />);
        expect(screen.getByText(/6:30 Kirtan/)).toBeInTheDocument();
    });

    it('says so plainly when the board is empty, instead of showing a blank panel', () => {
        // The manager asked a question by opening this tab; silence is not an answer.
        render(<ManagerNotices />);
        expect(screen.getByText(/Nothing on the board right now/)).toBeInTheDocument();
    });

    it('points at where the agenda is written, which is a different screen', () => {
        // The agenda is set in Setup → Sabha Calendar, not in this composer. Being
        // vague here is how a manager concludes the feature is broken.
        render(<ManagerNotices />);
        expect(screen.getByText(/Sabha Calendar/)).toBeInTheDocument();
    });

    it('drops the empty message once something is on the board', () => {
        notices = [{ id: 'n1', body: 'Something' }];
        render(<ManagerNotices />);
        expect(screen.queryByText(/Nothing on the board right now/)).toBeNull();
    });
});
