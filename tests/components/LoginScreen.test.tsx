/**
 * The sign-in screen — the one screen every single user reaches, and the one
 * the UI overhaul never touched.
 *
 * These cases exist because a preview audit found three controls here failing
 * WCAG on the deployed design:
 *
 *   - the show/hide password eye was 18x18 and its ONLY name was a `title`
 *     attribute, so a screen reader announced "button" and nothing more
 *   - "New to Sabha? Create Account" was 20px tall
 *   - "Forgot Password?" was 20px tall
 *
 * The eye is the serious one: unnamed and unreachable is two failures on the
 * control that decides whether someone can type their password correctly.
 *
 * Every assertion below checks the ACCESSIBLE name or the measured box, not
 * the markup that happens to produce it — the same rule the rest of this suite
 * follows.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase/auth', () => ({
    signInWithPopup: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({ auth: {}, googleProvider: {} }));

import { LoginScreen } from '../../components/auth/LoginScreen';

const renderLogin = () => render(<LoginScreen onLoginSuccess={vi.fn()} />);

/** Swap to the register view, which is where the second eye and the terms box live. */
const goToRegister = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /create account/i }));
};

describe('LoginScreen — the password eye is a real, named control', () => {
    it('has an accessible name, not just a tooltip', () => {
        renderLogin();

        const eye = screen.getByRole('button', { name: /show password/i });

        // The name must come from aria-label, and the assertion has to say so.
        // `title` ALSO satisfies getByRole — the accessible-name spec falls back
        // to it — so a getByRole check alone would have passed against the
        // broken version and caught nothing. Verified, not assumed.
        //
        // title is not good enough in the real world: it is a hover tooltip, so
        // it never appears for a touch user, and screen-reader support for
        // title-as-name is inconsistent.
        expect(eye).toHaveAttribute('aria-label', 'Show password');
    });

    it('says what it will do, and flips when it has done it', async () => {
        const user = userEvent.setup();
        renderLogin();

        await user.click(screen.getByRole('button', { name: /show password/i }));

        expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
    });

    it('reports its state to assistive tech', async () => {
        const user = userEvent.setup();
        renderLogin();

        const eye = screen.getByRole('button', { name: /show password/i });
        expect(eye).toHaveAttribute('aria-pressed', 'false');

        await user.click(eye);

        expect(screen.getByRole('button', { name: /hide password/i }))
            .toHaveAttribute('aria-pressed', 'true');
    });

    it('actually reveals the password — the point of the button', async () => {
        const user = userEvent.setup();
        renderLogin();

        const field = screen.getByPlaceholderText('••••••••');
        expect(field).toHaveAttribute('type', 'password');

        await user.click(screen.getByRole('button', { name: /show password/i }));

        expect(field).toHaveAttribute('type', 'text');
    });

    it('hides it again, so the control is not one-way', async () => {
        const user = userEvent.setup();
        renderLogin();

        const field = screen.getByPlaceholderText('••••••••');
        await user.click(screen.getByRole('button', { name: /show password/i }));
        await user.click(screen.getByRole('button', { name: /hide password/i }));

        expect(field).toHaveAttribute('type', 'password');
    });

    it('carries a 44px hit area rather than the bare icon size', () => {
        renderLogin();

        // jsdom has no layout, so the measured box is always 0 — assert the
        // classes that produce 44x44 instead. w-11 is Tailwind's 2.75rem.
        const eye = screen.getByRole('button', { name: /show password/i });
        expect(eye.className).toMatch(/\bw-11\b/);
        expect(eye.className).toMatch(/\bh-11\b/);
    });

    it('is not a submit button, so revealing the password cannot submit the form', () => {
        renderLogin();
        expect(screen.getByRole('button', { name: /show password/i }))
            .toHaveAttribute('type', 'button');
    });
});

describe('LoginScreen — the confirm-password eye, on the register view', () => {
    it('has its own distinct name, so the two eyes are tellable apart', async () => {
        const user = userEvent.setup();
        renderLogin();
        await goToRegister(user);

        expect(screen.getByRole('button', { name: /show confirmed password/i })).toBeInTheDocument();
        // Both exist at once; an ambiguous name would make getByRole throw here.
        expect(screen.getByRole('button', { name: /^show password$/i })).toBeInTheDocument();
    });

    it('carries the same 44px hit area', async () => {
        const user = userEvent.setup();
        renderLogin();
        await goToRegister(user);

        const eye = screen.getByRole('button', { name: /show confirmed password/i });
        expect(eye.className).toMatch(/\bw-11\b/);
        expect(eye.className).toMatch(/\bh-11\b/);
    });
});

describe('LoginScreen — the secondary links are tappable', () => {
    it('gives "Create Account" a grown hit area', () => {
        renderLogin();

        // .tap-target grows the hit box to 44x44 with a pseudo-element while
        // leaving the text its own size. See index.css.
        expect(screen.getByRole('button', { name: /create account/i }).className)
            .toMatch(/\btap-target\b/);
    });

    it('gives "Forgot Password?" a grown hit area', () => {
        renderLogin();

        expect(screen.getByRole('button', { name: /forgot password/i }).className)
            .toMatch(/\btap-target\b/);
    });
});

describe('LoginScreen — the terms checkbox', () => {
    it('is reachable by its label, not only by the 20px box', async () => {
        const user = userEvent.setup();
        renderLogin();
        await goToRegister(user);

        // Found by its label text, which is what proves the <label for> pairing
        // survives. That pairing is what makes the whole sentence tappable.
        const box = screen.getByLabelText(/terms of seva/i);
        expect(box).toHaveAttribute('type', 'checkbox');
    });

    it('ticks when the sentence is clicked, not just the box', async () => {
        const user = userEvent.setup();
        renderLogin();
        await goToRegister(user);

        const box = screen.getByLabelText(/terms of seva/i) as HTMLInputElement;
        expect(box.checked).toBe(false);

        // "I agree to the ..." is the label; the footer's "By continuing, you
        // agree to our Terms of Seva ..." also matches a looser pattern.
        await user.click(screen.getByText(/^I agree to the/i));

        expect(box.checked).toBe(true);
    });

    it('is bigger than the browser default 13px', async () => {
        const user = userEvent.setup();
        renderLogin();
        await goToRegister(user);

        expect((screen.getByLabelText(/terms of seva/i)).className).toMatch(/\bw-5\b/);
    });
});
