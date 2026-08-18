/**
 * Manager invites, and the reason they must not sit inside People's empty state.
 *
 * These moved on 2026-08-18 from the **Venue** section of Setup — filed under a
 * heading about where drivers are routed to, which is nowhere anybody would look
 * for "make this person a manager".
 *
 * THE TRAP THIS FILE EXISTS FOR
 * -----------------------------
 * `ManagerPeople` early-returns an "All caught up" card INSTEAD of its sections
 * when nothing is pending — which is the normal state most of the week. Dropping
 * the invite panel into that branch is the obvious way to wire it up, and it would
 * make the feature disappear exactly when a manager has time to use it. It would
 * look deleted, and nothing else would fail.
 */

import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let pendingDrivers: unknown[] = [];
let pendingRiders: unknown[] = [];
const created: Array<string | undefined> = [];

vi.mock('../../hooks/useFirestore', () => ({
    usePendingDrivers: () => ({ pendingDrivers, loading: false }),
    usePendingRiders: () => ({ pendingRiders, loading: false }),
    updateUserStatus: vi.fn(async () => undefined),
}));

vi.mock('../../src/utils/cloudFunctions', () => ({
    createManagerInvite: vi.fn(async (label?: string) => {
        created.push(label);
        return { code: 'ABCD-1234-EFGH', expiresAt: '2026-08-25T00:00:00.000Z' };
    }),
}));

vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../components/shared/useConfirm', () => ({
    useConfirm: () => ({ ask: vi.fn(async () => true), confirmDialog: null }),
}));

import { ManagerInvites } from '../../components/manager/ManagerInvites';
import { ManagerPeople } from '../../components/manager/ManagerPeople';

beforeEach(() => {
    pendingDrivers = [];
    pendingRiders = [];
    created.length = 0;
});

describe('ManagerInvites on the People page', () => {
    it('is reachable when NOBODY is pending — the empty-state trap', () => {
        // The whole point. `total === 0` renders "All caught up" instead of the
        // sections, so anything nested in that branch vanishes.
        render(<ManagerPeople />);

        expect(screen.getByText(/All caught up/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Create an invite/ })).toBeTruthy();
    });

    it('is still there when people ARE pending', () => {
        pendingDrivers = [{ id: 'd1', name: 'Asha', phone: '555', carModel: 'Odyssey' }];
        render(<ManagerPeople />);

        expect(screen.getByRole('button', { name: /Create an invite/ })).toBeTruthy();
    });
});

describe('ManagerInvites behaviour', () => {
    it('shows the code once, and says so', async () => {
        // Firestore stores a salted hash, so this render is the only copy that will
        // ever exist. It must not auto-hide.
        render(<ManagerInvites />);

        await act(async () => {
            screen.getByRole('button', { name: /Create an invite/ }).click();
        });

        expect(screen.getByText('ABCD-1234-EFGH')).toBeTruthy();
        expect(screen.getByText(/will not be shown again/i)).toBeTruthy();
    });

    it('stays on screen until dismissed, rather than on a timer', async () => {
        render(<ManagerInvites />);
        await act(async () => { screen.getByRole('button', { name: /Create an invite/ }).click(); });

        await act(async () => { screen.getByText(/Done, hide it/).click(); });

        expect(screen.queryByText('ABCD-1234-EFGH')).toBeNull();
    });

    it('passes the optional label through, trimmed, and omits it when blank', async () => {
        render(<ManagerInvites />);
        const input = screen.getByLabelText(/Who is this invite for/) as HTMLInputElement;

        // fireEvent, not `input.value = …` plus a raw event: React listens through
        // its own synthetic system, so a hand-dispatched 'input' never reaches
        // onChange and the field silently stays empty.
        fireEvent.change(input, { target: { value: '  Bhavesh  ' } });
        await act(async () => { screen.getByRole('button', { name: /Create an invite/ }).click(); });

        // A blank label must arrive as undefined, not '', so the server records
        // "no label" rather than an empty string.
        expect(created).toEqual(['Bhavesh']);
    });

    it('states the expiry window, which must match the server', () => {
        // functions/src/utils/invites.ts owns INVITE_TTL_DAYS. If the two drift the
        // manager tells someone the wrong date.
        render(<ManagerInvites />);
        expect(screen.getByText(/expires in 7 days/i)).toBeTruthy();
    });
});

describe('the old home no longer mints invites', () => {
    it('LocationSettings has no invite code left in it', async () => {
        const { readFileSync } = await import('node:fs');
        const path = await import('node:path');
        const src = readFileSync(
            path.resolve(__dirname, '../../components/manager/LocationSettings.tsx'), 'utf8');

        expect(src).not.toMatch(/createManagerInvite/);
        expect(src).not.toMatch(/setNewInvite/);
        expect(src).not.toMatch(/INVITE_TTL_DAYS\s*=/);
    });
});
