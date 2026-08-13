/**
 * The role menu in the app header.
 *
 * Two separate bugs were fixed here, and jsdom can observe neither directly —
 * it has no layout and no compositor. So these cases guard the two decisions
 * that produce the right result, and the real geometry was measured in a
 * browser against the compiled CSS.
 *
 * 1. STACKING. The header is `position: sticky` with a z-index, which creates a
 *    stacking context, so `z-dropdown` (1000) inside it was only worth the
 *    header's own rung. Four in-page sticky headers share `z-sticky` and come
 *    later in the DOM, so they painted over the open menu. Fixed by moving the
 *    header to `z-chrome`; see tests/quality/z-index.test.ts.
 *
 * 2. ALIGNMENT. The menu used `left-0` while its trigger sits hard against the
 *    right edge of the header. Measured on a 375px viewport: the panel ran from
 *    233px to 425px — 50px past the edge of the screen. `right-0` puts it at
 *    134..326 instead.
 *
 * Neither was visible in the preview harness, because the preview pages render
 * screens without the app chrome around them.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = {
    activeRole: 'manager' as string | null,
    setActiveRole: vi.fn(),
    getAvailableRoles: () => ['manager', 'driver', 'student'],
    userProfile: { name: 'Test Manager' },
};

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));

import { RoleSwitcher } from '../../components/RoleSwitcher';

/** The menu panel — the positioned box, not the backdrop. */
const panel = () => document.querySelector('.absolute.top-full') as HTMLElement | null;

beforeEach(() => {
    auth.activeRole = 'manager';
    auth.setActiveRole = vi.fn();
    auth.getAvailableRoles = () => ['manager', 'driver', 'student'];
});

describe('RoleSwitcher — it opens and it works', () => {
    it('shows nothing at all for a single-role user', () => {
        auth.getAvailableRoles = () => ['student'];
        const { container } = render(<RoleSwitcher />);

        // A switcher offering one choice is a control that cannot do anything.
        expect(container).toBeEmptyDOMElement();
    });

    it('starts closed', () => {
        render(<RoleSwitcher />);
        expect(panel()).toBeNull();
    });

    it('opens on click and offers every role', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);

        await user.click(screen.getByRole('button', { name: /manager/i }));

        expect(screen.getByRole('button', { name: /driver/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /student/i })).toBeInTheDocument();
    });

    it('actually switches role — not a menu that just closes', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);

        await user.click(screen.getByRole('button', { name: /manager/i }));
        await user.click(screen.getByRole('button', { name: /driver/i }));

        expect(auth.setActiveRole).toHaveBeenCalledWith('driver');
    });

    it('closes after choosing', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);

        await user.click(screen.getByRole('button', { name: /manager/i }));
        await user.click(screen.getByRole('button', { name: /driver/i }));

        expect(panel()).toBeNull();
    });

    it('marks the current role so the menu says where you are', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);

        await user.click(screen.getByRole('button', { name: /manager/i }));

        expect(screen.getByText('Active')).toBeInTheDocument();
    });
});

describe('RoleSwitcher — it fits on a phone', () => {
    it('opens inward from the right, not off the edge of the screen', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);
        await user.click(screen.getByRole('button', { name: /manager/i }));

        const box = panel()!;

        // The trigger sits at the right edge of the header. Anchoring the menu's
        // LEFT edge to it pushed 50px of a 192px panel off a 375px screen.
        expect(box.className).toMatch(/\bright-0\b/);
        expect(box.className).not.toMatch(/\bleft-0\b/);
    });

    it('is still only w-48, so the alignment is what keeps it on screen', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);
        await user.click(screen.getByRole('button', { name: /manager/i }));

        // If this ever grows past the trigger's distance from the right edge,
        // right-0 stops being enough and the menu needs real collision handling.
        expect(panel()!.className).toMatch(/\bw-48\b/);
    });
});

describe('RoleSwitcher — it stays above the page', () => {
    it('puts the menu on the dropdown rung', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);
        await user.click(screen.getByRole('button', { name: /manager/i }));

        expect(panel()!.className).toMatch(/\bz-dropdown\b/);
    });

    it('puts the backdrop on the same rung, so it cannot cover the menu', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);
        await user.click(screen.getByRole('button', { name: /manager/i }));

        const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
        expect(backdrop.className).toMatch(/\bz-dropdown\b/);
    });

    it('dismisses when the backdrop is clicked', async () => {
        const user = userEvent.setup();
        render(<RoleSwitcher />);
        await user.click(screen.getByRole('button', { name: /manager/i }));

        await user.click(document.querySelector('.fixed.inset-0') as HTMLElement);

        expect(panel()).toBeNull();
    });
});
