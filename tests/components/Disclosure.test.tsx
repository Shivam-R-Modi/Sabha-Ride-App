/**
 * The one collapsible row, shared by Setup's sections and the notice board.
 *
 * It was `Section` inside ManagerSetup for six days before the notice board
 * needed the same thing. Lifting it rather than writing a second accordion is the
 * point of this file existing: two would drift, and then a settings row and a
 * notice row would disagree about what "collapsed" looks like.
 *
 * Deliberately stateless. `open` and `onToggle` are props, so ONE-AT-A-TIME falls
 * out of the caller holding a single `openId` instead of a boolean per row —
 * there is no state to synchronise and no way for two rows to both think they are
 * open. That property is pinned at the callers, where it is a real behaviour;
 * here what matters is that this component obeys the props it is given.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Disclosure } from '../../components/shared/Disclosure';

const show = (over: Partial<React.ComponentProps<typeof Disclosure>> = {}) =>
    render(
        <Disclosure title="Sabha calendar" open={false} onToggle={() => {}} {...over}>
            <p>the panel</p>
        </Disclosure>,
    );

describe('Disclosure', () => {
    it('shows the title and hides the panel when closed', () => {
        show();
        expect(screen.getByText('Sabha calendar')).toBeInTheDocument();
        expect(screen.queryByText('the panel')).toBeNull();
    });

    it('shows the panel when open', () => {
        show({ open: true });
        expect(screen.getByText('the panel')).toBeInTheDocument();
    });

    it('unmounts the panel rather than hiding it with a class', () => {
        // What "collapsed" should mean: out of the accessibility tree and out of
        // the browser's own find-on-page, not merely invisible.
        const { container } = show();
        expect(container.textContent).not.toContain('the panel');
    });

    it('reports its state to assistive tech', () => {
        const { rerender } = show();
        expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');

        rerender(
            <Disclosure title="Sabha calendar" open onToggle={() => {}}>
                <p>the panel</p>
            </Disclosure>,
        );
        expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('points aria-controls at the panel it actually opens', () => {
        // The original had neither attribute, so a screen reader was told a button
        // expands something and never which region.
        show({ open: true });

        const id = screen.getByRole('button').getAttribute('aria-controls');
        expect(id).toBeTruthy();
        expect(document.getElementById(id!)).toContainElement(screen.getByText('the panel'));
    });

    it('gives two rows different panel ids', () => {
        // Two boards can be mounted at once — a dashboard and a manager's tab.
        render(
            <>
                <Disclosure title="One" open onToggle={() => {}}><p>a</p></Disclosure>
                <Disclosure title="Two" open onToggle={() => {}}><p>b</p></Disclosure>
            </>,
        );

        const [first, second] = screen.getAllByRole('button');
        expect(first!.getAttribute('aria-controls'))
            .not.toBe(second!.getAttribute('aria-controls'));
    });

    it('calls onToggle when pressed', () => {
        const onToggle = vi.fn();
        show({ onToggle });
        fireEvent.click(screen.getByRole('button'));
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('renders the optional summary, and omits it cleanly', () => {
        show({ summary: 'Move a sabha, cancel one' });
        expect(screen.getByText('Move a sabha, cancel one')).toBeInTheDocument();

        const { container } = show();
        expect(container.querySelectorAll('p')).toHaveLength(0);
    });

    it('renders the optional icon, and omits it cleanly', () => {
        // A settings row earns a 44px tile; a notice row is a line and a chevron.
        show({ icon: <span data-testid="icon" /> });
        expect(screen.getByTestId('icon')).toBeInTheDocument();

        const { container } = show();
        expect(container.querySelector('[data-testid="icon"]')).toBeNull();
    });

    it('renders the trailing slot, where the New badge goes', () => {
        show({ trailing: <span>New</span> });
        expect(screen.getByText('New')).toBeInTheDocument();
    });

    it('puts the trailing slot after the title, not before it', () => {
        show({ trailing: <span>New</span> });

        const title = screen.getByText('Sabha calendar');
        const badge = screen.getByText('New');
        expect(title.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('keeps the whole header pressable, at a thumb-sized height', () => {
        // The row is the control. A small chevron as the only target is a mis-tap
        // on a phone, which is what min-h-11 is for across this app.
        show();
        const button = screen.getByRole('button');
        expect(button.className).toMatch(/min-h-11/);
        expect(button.className).toMatch(/w-full/);
    });
});
