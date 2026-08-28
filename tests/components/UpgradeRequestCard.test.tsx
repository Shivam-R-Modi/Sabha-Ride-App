/**
 * A Bhulku asking to become a Sarthi. The card had no tests.
 *
 * WHAT THIS FILE EXISTS FOR: a request filed from abroad is answered on the spot rather
 * than joining a queue a manager can only refuse. A Sarthi drives Bhulka to the sabha,
 * which cannot be done from another country.
 *
 * The steer comes from the DEVICE TIMEZONE — no permission prompt, nothing stored — the
 * same helper the signup screen uses. And it is a hint, not a gate: the timezone answers
 * "where is this device right now", not "where do you live", so a Boston Sarthi-to-be
 * visiting family in Ahmedabad reads as abroad and can still ask. That escape is free
 * here because the request grants nothing on its own — a manager approves every one, so
 * a human is the real gate.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../firebase/config', () => ({ db: {}, auth: {}, app: {} }));

const requestRoleUpgrade = vi.fn(async (_uid: string) => undefined);
const clearRoleUpgradeRequest = vi.fn(async (_uid: string) => undefined);
vi.mock('../../hooks/useFirestore', () => ({
    requestRoleUpgrade: (uid: string) => requestRoleUpgrade(uid),
    clearRoleUpgradeRequest: (uid: string) => clearRoleUpgradeRequest(uid),
}));

/** Only the device zone is faked; `likelyInUsa` stays real so the zone table is exercised. */
let deviceZone: string | undefined = 'America/New_York';
vi.mock('../../src/utils/whereabouts', async (importActual) => ({
    ...(await importActual<typeof import('../../src/utils/whereabouts')>()),
    deviceTimeZone: () => deviceZone,
}));

let profile: Record<string, unknown> = {
    name: 'Ramesh', role: 'student', roles: ['student'], accountStatus: 'approved',
};
const refreshProfile = vi.fn(async () => undefined);
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { uid: 'rider_1' }, userProfile: profile, refreshProfile }),
}));

import { UpgradeRequestCard } from '../../components/shared/UpgradeRequestCard';

const show = () => render(<UpgradeRequestCard />);
const offer = () => screen.getByRole('button', { name: /Become a Sarthi/i });

beforeEach(() => {
    vi.clearAllMocks();
    deviceZone = 'America/New_York';
    profile = { name: 'Ramesh', role: 'student', roles: ['student'], accountStatus: 'approved' };
});

describe('who is offered the request at all', () => {
    it('offers it to an approved Bhulku', () => {
        show();
        expect(offer()).toBeInTheDocument();
    });

    it('renders NOTHING for somebody who is already a Sarthi', () => {
        // The hierarchy already grants them everything a Bhulku has, so there is no
        // request to make — and a control that cannot do anything is the failure this
        // app keeps removing.
        profile = { ...profile, roles: ['driver', 'student'] };
        const { container } = show();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for an account that is not approved yet', () => {
        profile = { ...profile, accountStatus: 'pending' };
        const { container } = show();
        expect(container).toBeEmptyDOMElement();
    });
});

describe('asking from inside the USA', () => {
    it('sends the request straight away', async () => {
        show();
        await userEvent.click(offer());
        expect(requestRoleUpgrade).toHaveBeenCalledWith('rider_1');
    });

    it('says nothing about where they are', async () => {
        show();
        await userEvent.click(offer());
        expect(screen.queryByText(/being here in the USA/i)).not.toBeInTheDocument();
    });
});

describe('asking from abroad', () => {
    beforeEach(() => { deviceZone = 'Asia/Kolkata'; });

    it('still shows the offer, rather than hiding how to volunteer', () => {
        show();
        expect(offer()).toBeInTheDocument();
    });

    it('answers warmly on the tap instead of filing the request', async () => {
        show();
        await userEvent.click(offer());
        expect(screen.getByText(/Thank you for offering/i)).toBeInTheDocument();
        expect(screen.getByText(/being here in the USA/i)).toBeInTheDocument();
        // THE POINT: nothing was sent, so no manager has a request to refuse.
        expect(requestRoleUpgrade).not.toHaveBeenCalled();
    });

    it('leaves a way through for somebody who lives here and is travelling', async () => {
        // The timezone says where the DEVICE is, not where the person lives. Free to
        // allow, because a manager approves every request anyway.
        show();
        await userEvent.click(offer());
        await userEvent.click(screen.getByRole('button', { name: /I am already in the USA/i }));
        expect(requestRoleUpgrade).toHaveBeenCalledWith('rider_1');
    });
});

describe('when the zone cannot be read', () => {
    it('behaves exactly as it did before any of this', async () => {
        // `likelyInUsa` returns null, and null must never produce a refusal somebody
        // cannot argue with.
        deviceZone = undefined;
        show();
        await userEvent.click(offer());
        expect(requestRoleUpgrade).toHaveBeenCalledWith('rider_1');
        expect(screen.queryByText(/Thank you for offering/i)).not.toBeInTheDocument();
    });
});

describe('the states after asking', () => {
    it('shows a pending request, with a way to withdraw it', async () => {
        profile = { ...profile, roleUpgrade: { status: 'pending' } };
        show();
        expect(screen.getByText(/Waiting to be reviewed/i)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Withdraw request/i }));
        expect(clearRoleUpgradeRequest).toHaveBeenCalledWith('rider_1');
    });

    it('keeps a refusal on screen until it is dismissed', () => {
        // A person who asked and heard nothing asks again, and the manager's queue
        // fills with duplicates of a decision already made.
        profile = { ...profile, roleUpgrade: { status: 'rejected' } };
        show();
        expect(screen.getByText(/did not approve/i)).toBeInTheDocument();
    });

    it('does not show the abroad message over a pending request', () => {
        // The request already exists; telling them where they are would answer a
        // question they are no longer asking.
        deviceZone = 'Asia/Kolkata';
        profile = { ...profile, roleUpgrade: { status: 'pending' } };
        show();
        expect(screen.getByText(/Waiting to be reviewed/i)).toBeInTheDocument();
        expect(screen.queryByText(/Thank you for offering/i)).not.toBeInTheDocument();
    });
});
