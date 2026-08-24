/**
 * The shared overlay.
 *
 * Twelve files hand-rolled their own, and exactly one announced itself as a
 * dialog. Every assertion here is a behaviour those twelve were missing, so
 * this file doubles as the specification for what migrating onto Sheet buys.
 */

import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { Sheet } from '../../components/shared/Sheet';

const Basic: React.FC<Partial<React.ComponentProps<typeof Sheet>>> = (props) => (
    <Sheet open onClose={vi.fn()} title="Release driver" {...props}>
        <button>Inside one</button>
        <button>Inside two</button>
    </Sheet>
);

/** A realistic host: a trigger that opens the sheet, so focus has somewhere to return to. */
const Host: React.FC = () => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button onClick={() => setOpen(true)}>Open the sheet</button>
            <button>Behind the sheet</button>
            <Sheet open={open} onClose={() => setOpen(false)} title="Release driver">
                <button>Inside one</button>
            </Sheet>
        </>
    );
};

describe('Sheet — it announces itself', () => {
    it('renders nothing when closed', () => {
        render(<Sheet open={false} onClose={vi.fn()} title="Release driver">body</Sheet>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is a modal dialog with an accessible name', () => {
        render(<Basic />);
        expect(screen.getByRole('dialog', { name: 'Release driver' }))
            .toHaveAttribute('aria-modal', 'true');
    });

    it('can hide the title visually while keeping the name', () => {
        render(<Basic hideTitle />);
        // Still named for assistive tech, just not shown.
        expect(screen.getByRole('dialog', { name: 'Release driver' })).toBeInTheDocument();
    });
});

describe('Sheet — closing', () => {
    it('closes on Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Basic onClose={onClose} />);

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on the close button', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Basic onClose={onClose} />);

        await user.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes when the backdrop is clicked', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Basic onClose={onClose} />);

        // Reached through the dialog rather than through the render container:
        // Sheet portals to document.body, so the overlay is deliberately NOT a
        // descendant of what render() returns. `container.firstElementChild` used
        // to be the backdrop and is now empty, which made this pass for the wrong
        // reason waiting to happen. The behaviour under test is unchanged.
        await user.click(screen.getByRole('dialog').parentElement as Element);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders outside the tree that opened it, so no ancestor can lay it out', async () => {
        // The reason for the portal. Sheet used to render in place, and fifteen of
        // its callers are `space-y-*` containers — Tailwind's
        // `.space-y-6 > * ~ *` rule put `margin-top: 1.5rem` on the `position:
        // fixed` overlay, so the scrim left the top 24px of the screen undimmed and
        // every docked sheet sat 24px low. A transformed or `overflow: hidden`
        // ancestor would have done worse.
        const { container } = render(
            <div className="space-y-6">
                <p>something above it</p>
                <Basic onClose={vi.fn()} />
            </div>,
        );

        const overlay = screen.getByRole('dialog').parentElement!;
        expect(container.contains(overlay)).toBe(false);
        expect(document.body.contains(overlay)).toBe(true);
    });

    it('does not close when the click lands inside the panel', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Basic onClose={onClose} />);

        await user.click(screen.getByRole('button', { name: 'Inside one' }));

        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('Sheet — a write in flight cannot be dismissed by accident', () => {
    it('ignores Escape when not dismissible', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Basic onClose={onClose} dismissible={false} />);

        await user.keyboard('{Escape}');

        expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores the backdrop when not dismissible', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const { container } = render(<Basic onClose={onClose} dismissible={false} />);

        await user.click(container.firstElementChild as Element);

        expect(onClose).not.toHaveBeenCalled();
    });

    it('hides the close button too, rather than leaving one that does nothing', () => {
        render(<Basic dismissible={false} />);
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
});

describe('Sheet — focus', () => {
    it('moves focus onto the dialog itself, not onto its close button', async () => {
        const user = userEvent.setup();
        render(<Host />);

        await user.click(screen.getByRole('button', { name: 'Open the sheet' }));

        // Deliberately the container. The first control in DOM order is Close,
        // and focusing that arms "discard this" on the next Enter. Focusing the
        // dialog also makes screen readers announce its title.
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
    });

    it('Tab from the dialog moves into its controls, not out of it', async () => {
        const user = userEvent.setup();
        render(<Host />);
        await user.click(screen.getByRole('button', { name: 'Open the sheet' }));

        await user.tab();

        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('Shift+Tab from the dialog wraps to the end rather than escaping behind it', async () => {
        const user = userEvent.setup();
        render(<Host />);
        await user.click(screen.getByRole('button', { name: 'Open the sheet' }));

        await user.tab({ shift: true });

        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
        expect(document.activeElement)
            .not.toBe(screen.getByRole('button', { name: 'Behind the sheet' }));
    });

    it('gives focus back to whatever opened it', async () => {
        const user = userEvent.setup();
        render(<Host />);
        const trigger = screen.getByRole('button', { name: 'Open the sheet' });

        await user.click(trigger);
        await user.keyboard('{Escape}');

        // Without this, closing dumps focus on <body> and a keyboard user
        // restarts from the top of the page.
        await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('keeps Tab inside the sheet even past the last control', async () => {
        const user = userEvent.setup();
        render(<Basic />);
        const dialog = screen.getByRole('dialog');

        // Three controls (Close, Inside one, Inside two) plus two extra presses,
        // so this only passes if Tab wraps rather than walking out.
        for (let i = 0; i < 5; i++) await user.tab();

        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('keeps Shift+Tab inside the sheet too', async () => {
        const user = userEvent.setup();
        render(<Basic />);
        const dialog = screen.getByRole('dialog');

        for (let i = 0; i < 5; i++) await user.tab({ shift: true });

        expect(dialog.contains(document.activeElement)).toBe(true);
    });
});

describe('Sheet — background scroll', () => {
    it('locks the page behind while open', () => {
        const { unmount } = render(<Basic />);
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
    });

    it('gives scrolling back on close', () => {
        const { unmount } = render(<Basic />);
        unmount();
        expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('keeps the lock until the LAST of two stacked sheets closes', () => {
        // A nested sheet closing must not hand scrolling back to a page that is
        // still covered by the sheet underneath.
        const outer = render(<Sheet open onClose={vi.fn()} title="Outer">outer</Sheet>);
        const inner = render(<Sheet open onClose={vi.fn()} title="Inner">inner</Sheet>);

        inner.unmount();
        expect(document.body.style.overflow).toBe('hidden');

        outer.unmount();
        expect(document.body.style.overflow).not.toBe('hidden');
    });
});

describe('Sheet — stacking', () => {
    it('Escape closes only the topmost sheet', async () => {
        const user = userEvent.setup();
        const closeOuter = vi.fn();
        const closeInner = vi.fn();

        render(
            <>
                <Sheet open onClose={closeOuter} title="Outer"><button>Outer button</button></Sheet>
                <Sheet open onClose={closeInner} title="Inner"><button>Inner button</button></Sheet>
            </>,
        );

        await user.keyboard('{Escape}');

        expect(closeInner).toHaveBeenCalledTimes(1);
        expect(closeOuter).not.toHaveBeenCalled();
    });
});

describe('Sheet — content', () => {
    it('renders its children', () => {
        render(<Basic />);
        expect(screen.getByRole('button', { name: 'Inside one' })).toBeInTheDocument();
    });

    it('renders a footer when given one', () => {
        render(<Basic footer={<button>Save</button>} />);
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
});
