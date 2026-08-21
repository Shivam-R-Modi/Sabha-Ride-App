/**
 * Feedback on every profile, and the refusal that has to read like a sentence.
 *
 * Driven through the REAL ProfileEditor rather than the card alone, because
 * "every profile" is the actual requirement and the way it fails is by being
 * wired into one role and not the others. ProfileEditor is what all three roles
 * reach — manager and driver through App.tsx's switch, riders through
 * StudentDashboard — so rendering it per role is the assertion.
 *
 * The case worth the most care is the second submission. The document id is
 * `{uid}_{today}` and firestore.rules denies `update`, so sending twice in a day
 * comes back as `permission-denied`. Shown raw, that reads as "the app is broken"
 * to somebody whose only mistake was having a second thought. It has to read as a
 * sentence, and the payload has to land on the right document id or the whole
 * one-per-day guarantee is decoration.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setDoc = vi.fn(async () => undefined);
let profile: Record<string, unknown> = { name: 'Tonny Stark', role: 'manager', accountStatus: 'approved' };

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    setDoc: (...a: unknown[]) => setDoc(...(a as [])),
    serverTimestamp: () => 'now',
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: 'u_1' },
        userProfile: profile,
        logout: vi.fn(),
        refreshProfile: vi.fn(),
        activeRole: profile.role,
        getAvailableRoles: () => [profile.role],
        setActiveRole: vi.fn(),
    }),
}));
// Not what is under test, and each drags in Google Places or a live listener.
vi.mock('../../components/auth/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));
vi.mock('../../components/auth/PhoneNumberInput', () => ({ PhoneNumberInput: () => null }));
vi.mock('../../hooks/useGooglePlaces', () => ({ geocodeAddressInBrowser: vi.fn() }));
vi.mock('../../components/shared/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../../components/shared/InstallAppButton', () => ({ InstallAppButton: () => null }));
vi.mock('../../components/shared/PushToggle', () => ({ PushToggle: () => null }));

import { ProfileEditor } from '../../components/shared/ProfileEditor';

const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: /give feedback/i }));
};

/** The document path and payload of the last write. */
const lastWrite = () => {
    const call = [...setDoc.mock.calls].reverse()[0] as unknown as [{ path: string }, Record<string, unknown>];
    return call ? { path: call[0].path, data: call[1] } : null;
};

const permissionDenied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

beforeEach(() => {
    vi.clearAllMocks();
    profile = { name: 'Tonny Stark', role: 'manager', accountStatus: 'approved' };
});

describe('it is on every profile', () => {
    it.each(['manager', 'driver', 'student'])('offers feedback to a %s', (role) => {
        profile = { name: 'Someone', role, accountStatus: 'approved' };

        render(<ProfileEditor />);

        expect(screen.getByRole('button', { name: /give feedback/i })).toBeTruthy();
    });

    it('stays collapsed until asked, so it does not bury Sign Out', () => {
        render(<ProfileEditor />);

        expect(screen.queryByLabelText(/your feedback/i)).toBeNull();
        expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
    });
});

describe('the form', () => {
    it('says it is not anonymous, before the box', async () => {
        render(<ProfileEditor />);
        await open();

        expect(screen.getByText(/sent with your name/i)).toBeTruthy();
    });

    it('offers a rating that a keyboard can reach', async () => {
        render(<ProfileEditor />);
        await open();

        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(5);
        // sr-only, NOT display:none — the latter is unreachable by keyboard and
        // absent from the accessibility tree.
        expect(radios[0].className).toContain('sr-only');
    });

    it('cannot be sent empty', async () => {
        render(<ProfileEditor />);
        await open();

        expect(screen.getByRole('button', { name: /send feedback/i }).hasAttribute('disabled')).toBe(true);
    });

    it('cannot be sent with a comment but no rating', async () => {
        render(<ProfileEditor />);
        await open();
        await userEvent.type(screen.getByLabelText(/your feedback/i), 'Pickups run late.');

        expect(screen.getByRole('button', { name: /send feedback/i }).hasAttribute('disabled')).toBe(true);
    });

    it('cannot be sent with whitespace alone', async () => {
        render(<ProfileEditor />);
        await open();
        await userEvent.click(screen.getByRole('radio', { name: /4 out of 5/i }));
        await userEvent.type(screen.getByLabelText(/your feedback/i), '   ');

        expect(screen.getByRole('button', { name: /send feedback/i }).hasAttribute('disabled')).toBe(true);
    });
});

describe('sending', () => {
    const fill = async () => {
        await open();
        await userEvent.click(screen.getByRole('radio', { name: /4 out of 5/i }));
        await userEvent.type(screen.getByLabelText(/your feedback/i), 'Pickups run late.');
        await userEvent.click(screen.getByRole('button', { name: /send feedback/i }));
    };

    it('writes to the one-per-day document id', async () => {
        // Not a random id. The id IS the throttle — see src/utils/feedback.ts.
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(setDoc).toHaveBeenCalled());
        expect(lastWrite()!.path).toMatch(/^feedback\/u_1_\d{4}-\d{2}-\d{2}$/);
    });

    it('sends the rating, the trimmed comment and the caller uid', async () => {
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(setDoc).toHaveBeenCalled());
        expect(lastWrite()!.data).toMatchObject({
            uid: 'u_1',
            rating: 4,
            comment: 'Pickups run late.',
        });
    });

    it('does not send a name — the manager resolves that from the account', async () => {
        // A client-supplied name is unverifiable, and a forged one on a complaint
        // about a named volunteer would send a manager to the wrong person.
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(setDoc).toHaveBeenCalled());
        expect(lastWrite()!.data).not.toHaveProperty('name');
        expect(lastWrite()!.data).not.toHaveProperty('role');
    });

    it('thanks the person instead of leaving the form open', async () => {
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(screen.getByText(/thank you/i)).toBeTruthy());
        expect(screen.queryByRole('button', { name: /send feedback/i })).toBeNull();
    });

    it('explains a second submission in a sentence, not a permission code', async () => {
        // The whole reason this path is handled: the refusal is EXPECTED, and a
        // raw `permission-denied` reads as a broken app.
        setDoc.mockRejectedValueOnce(permissionDenied());
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(screen.getByText(/already sent feedback today/i)).toBeTruthy());
        expect(screen.queryByText(/permission/i)).toBeNull();
        expect(screen.queryByText(/insufficient/i)).toBeNull();
    });

    it('leaves the form open after a refusal, so the text is not lost', async () => {
        setDoc.mockRejectedValueOnce(permissionDenied());
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(screen.getByText(/already sent feedback today/i)).toBeTruthy());
        expect((screen.getByLabelText(/your feedback/i) as HTMLTextAreaElement).value).toBe('Pickups run late.');
    });

    it('reports any other failure without pretending it worked', async () => {
        setDoc.mockRejectedValueOnce(new Error('offline'));
        render(<ProfileEditor />);
        await fill();

        await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy());
        expect(screen.queryByText(/thank you/i)).toBeNull();
    });
});
