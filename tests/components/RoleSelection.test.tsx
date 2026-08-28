/**
 * Signing up — the screen without which nobody can register, and it had no test.
 *
 * THE ASSERTION THIS FILE EXISTS FOR: **exactly one write, and it is a create.**
 *
 * That `setDoc` sets role, registeredRole, roles, activeRole and accountStatus — five of
 * the fields in `touchesPrivilegeFields()`. It is legal only because no user document
 * exists yet, so `firestore.rules` takes the `createsUnprivilegedProfile()` arm;
 * `changedKeys()` is update-only. Add a screen before this one that writes the
 * whereabouts answer, and that same write becomes an owner update touching privilege
 * fields, the rules deny it, and **student and driver signup stops working entirely.**
 *
 * So the "where are you" question is step 0 of this screen, its answer lives in React
 * state, and the write count is asserted below. `tests/rules/firestore.rules.test.ts`
 * guards the same thing from the other side.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDoc = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
    setDoc: (...a: unknown[]) => setDoc(...(a as [])),
    serverTimestamp: () => 'SERVER_TIME',
}));
vi.mock('../../firebase/config', () => ({ db: {}, auth: {}, app: {} }));

const redeemManagerInvite = vi.fn(async () => ({ redeemed: true, message: '' }));
vi.mock('../../src/utils/cloudFunctions', () => ({
    redeemManagerInvite: (...a: unknown[]) => redeemManagerInvite(...(a as [])),
}));

const refreshClaims = vi.fn(async () => undefined);
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: 'new_1', email: 'new@example.com', phoneNumber: null },
        refreshClaims,
    }),
}));

/**
 * Only `deviceTimeZone` is faked. `likelyInUsa` stays REAL, so these cases exercise the
 * actual zone table rather than a stub agreeing with itself.
 */
let deviceZone: string | undefined = 'America/New_York';
vi.mock('../../src/utils/whereabouts', async (importActual) => ({
    ...(await importActual<typeof import('../../src/utils/whereabouts')>()),
    deviceTimeZone: () => deviceZone,
}));

import { RoleSelection } from '../../components/auth/RoleSelection';

const onSelectRole = vi.fn();

const show = () => render(<RoleSelection onSelectRole={onSelectRole} />);

/** The single profile payload, whichever path produced it. */
const written = () => setDoc.mock.calls[0]?.[1] as unknown as Record<string, unknown>;

const click = (name: RegExp | string) =>
    userEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
    vi.clearAllMocks();
    redeemManagerInvite.mockResolvedValue({ redeemed: true, message: '' });
    deviceZone = 'America/New_York';
});

describe('step 0 — where are you', () => {
    it('is asked first, before anything about roles', () => {
        show();
        expect(screen.getByText(/where are you right now/i)).toBeInTheDocument();
        expect(screen.queryByText('Bhulku')).not.toBeInTheDocument();
        expect(screen.queryByText('Sarthi')).not.toBeInTheDocument();
    });

    it('offers exactly two answers', () => {
        show();
        expect(screen.getByText(/already in the USA/i)).toBeInTheDocument();
        expect(screen.getByText(/arriving soon/i)).toBeInTheDocument();
    });

    it('writes NOTHING when answered — the whole reason it lives in this screen', async () => {
        // A screen that wrote here would turn the create below into an owner update
        // touching privilege fields, and nobody could register.
        //
        // Each answer gets its own render: answering advances the screen, so the other
        // card is gone by then.
        const local = show();
        await click(/already in the USA/i);
        expect(setDoc).not.toHaveBeenCalled();
        local.unmount();

        show();
        await click(/arriving soon/i);
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('names no weekday, because a sabha schedule is a rule and not a constant', () => {
        const { container } = show();
        expect(container.textContent)
            .not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    });
});

describe('arriving soon', () => {
    beforeEach(async () => {
        show();
        await click(/arriving soon/i);
    });

    it('never shows the role cards — they cannot drive from another continent', () => {
        expect(screen.queryByText('Sarthi')).not.toBeInTheDocument();
        expect(screen.queryByText('Manager')).not.toBeInTheDocument();
    });

    it('says what happens next, rather than leaving a lone button', () => {
        expect(screen.getByText(/Jai Swaminarayan/i)).toBeInTheDocument();
        expect(screen.getByText(/a Sarthi will be waiting for you at arrivals/i)).toBeInTheDocument();
    });

    it('stops asking about a role, in the header too', () => {
        // The header said "Choose Your Role" on this branch at first — a question the
        // screen was no longer showing. Found by looking at it in the preview harness.
        expect(screen.queryByText(/choose your role/i)).not.toBeInTheDocument();
        expect(screen.getByText(/meet you at arrivals/i)).toBeInTheDocument();
    });

    it('creates an approved Bhulku marked as arriving, in ONE write', async () => {
        await click(/set up my pickup/i);

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(written()).toMatchObject({
            role: 'student',
            registeredRole: 'student',
            activeRole: 'student',
            roles: ['student'],
            // Auto-approved, so somebody in Ahmedabad at midnight files a request without
            // waiting for a manager to wake up.
            accountStatus: 'approved',
            isArriving: true,
        });
        expect(onSelectRole).toHaveBeenCalled();
    });

    it('stamps the tenancy pair, like every other profile write', async () => {
        await click(/set up my pickup/i);
        expect(written()).toMatchObject({ cityId: 'boston', locationId: 'boston-huntington' });
    });

    it('can be undone before it is written', async () => {
        // Back to step 0, not straight to the role cards — the question is "where are
        // you", and changing that answer means answering it again.
        await click(/already here/i);
        expect(screen.getByText(/where are you right now/i)).toBeInTheDocument();
        expect(setDoc).not.toHaveBeenCalled();

        await click(/already in the USA/i);
        expect(screen.getByText('Bhulku')).toBeInTheDocument();
        expect(setDoc).not.toHaveBeenCalled();
    });
});

describe('already here', () => {
    beforeEach(async () => {
        show();
        await click(/already in the USA/i);
    });

    it('shows the three role cards, unchanged', () => {
        expect(screen.getByText('Bhulku')).toBeInTheDocument();
        expect(screen.getByText('Sarthi')).toBeInTheDocument();
        expect(screen.getByText('Manager')).toBeInTheDocument();
    });

    it('creates an approved Bhulku with NO isArriving field at all', async () => {
        // Absent, not false. Absent-means-already-here is the migration, and writing
        // `false` on every new local account would make the field look load-bearing.
        await click(/^Bhulku/);
        await click(/continue/i);

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(written()).toMatchObject({ role: 'student', accountStatus: 'approved' });
        expect(written()).not.toHaveProperty('isArriving');
    });

    it('creates a Sarthi as pending, and grants them the student role too', async () => {
        await click(/^Sarthi/);
        await click(/continue/i);

        expect(written()).toMatchObject({
            role: 'driver',
            accountStatus: 'pending',
            // The GRANTED set. `['driver']` alone made a Sarthi invisible to the driver
            // picker, which queries `roles array-contains 'driver'`.
            roles: ['driver', 'student'],
        });
        expect(written()).not.toHaveProperty('isArriving');
    });

    it('routes a manager through the server and writes nothing from here', async () => {
        // The client must never write an approved manager profile — that is what the
        // hardcoded-code era did, and redeemManagerInvite exists to replace it.
        await click(/^Manager/);
        await userEvent.type(screen.getByPlaceholderText(/admin code/i), 'CODE1234');
        await click(/continue/i);

        expect(redeemManagerInvite).toHaveBeenCalledWith('CODE1234');
        expect(setDoc).not.toHaveBeenCalled();
        expect(refreshClaims).toHaveBeenCalled();
    });

    it('surfaces the server’s refusal for a bad invite, and still writes nothing', async () => {
        redeemManagerInvite.mockResolvedValue({ redeemed: false, message: 'That invite has expired.' });
        await click(/^Manager/);
        await userEvent.type(screen.getByPlaceholderText(/admin code/i), 'STALE123');
        await click(/continue/i);

        expect(screen.getByText(/that invite has expired/i)).toBeInTheDocument();
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('goes back to step 0 without writing', async () => {
        await click(/not in the USA yet/i);
        expect(screen.getByText(/where are you right now/i)).toBeInTheDocument();
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('clears a chosen role on the way back, so it cannot be submitted invisibly', async () => {
        await click(/^Sarthi/);
        await click(/not in the USA yet/i);
        await click(/already in the USA/i);

        // Continue must be inert again: no role selected.
        expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    });
});

describe('the Continue button', () => {
    it('is inert until step 0 is answered', () => {
        show();
        expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    });

    it('is inert on step 1 until a role is picked', async () => {
        show();
        await click(/already in the USA/i);
        expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    });

    it('is live as soon as arriving is chosen — there is nothing else to ask', async () => {
        show();
        await click(/arriving soon/i);
        expect(screen.getByRole('button', { name: /set up my pickup/i })).toBeEnabled();
    });
});

/**
 * STEERING BY TIMEZONE, added 2026-08-25.
 *
 * The device's zone picks which service is put forward. Deliberately NOT the geolocation
 * API: that costs a permission prompt at sign-up, before the app has been any use, and
 * this app already spends that prompt later where the value is obvious — a denial here
 * would be sticky and would break rider pickup and driver tracking.
 *
 * NOTHING IS WRITTEN. The verdict lives in React state and is forgotten. That matters
 * more than it looks: see this file's header — a write on this screen becomes an owner
 * update touching privilege fields, the rules deny it, and signup stops working. The
 * write-count assertions above are what guard it.
 */
describe('which service is offered first', () => {
    it('says nothing and dims nothing for somebody in the USA', () => {
        deviceZone = 'America/New_York';
        show();
        expect(screen.queryByText(/outside the USA/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/I actually live here/i)).not.toBeInTheDocument();
    });

    it('says so, once, for somebody abroad', () => {
        deviceZone = 'Asia/Kolkata';
        show();
        expect(screen.getByText(/It looks like you are outside the USA/i)).toBeInTheDocument();
    });

    it('offers the local card a way to disagree, rather than blocking it', () => {
        deviceZone = 'Asia/Kolkata';
        show();
        expect(screen.getByText(/I actually live here/i)).toBeInTheDocument();
    });

    it('KEEPS the local card clickable — a Boston student may be filing from abroad', () => {
        // The whole reason this is a hint and not a gate. Blocking it would strand a
        // resident who signed up while visiting family.
        deviceZone = 'Asia/Kolkata';
        show();
        const local = screen.getByRole('button', { name: /I am already in the USA/i });
        expect(local).not.toBeDisabled();
    });

    it('still reaches the role step when the dimmed card is tapped', async () => {
        deviceZone = 'Asia/Kolkata';
        show();
        await userEvent.click(screen.getByRole('button', { name: /I am already in the USA/i }));
        expect(screen.getByText('Bhulku')).toBeInTheDocument();
    });

    it('claims nothing when the zone is unreadable', () => {
        // `likelyInUsa` returns null here, and null must read as "ask, do not guess".
        // A confident line produced by a coin flip is worse than no line.
        deviceZone = undefined;
        show();
        expect(screen.queryByText(/outside the USA/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/I actually live here/i)).not.toBeInTheDocument();
    });

    it('treats Toronto as abroad, which a prefix check would not', () => {
        // `America/` is a CONTINENT. `startsWith('America/')` would call Toronto the USA
        // and show no hint at all — hiding the airport service from somebody flying in
        // from Canada. Asserted here as well as in the util, because this screen is
        // where the mistake would actually be seen.
        deviceZone = 'America/Toronto';
        show();
        expect(screen.getByText(/outside the USA/i)).toBeInTheDocument();
    });
});
