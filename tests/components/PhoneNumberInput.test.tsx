/**
 * The phone field, which had no tests despite being on almost every form in the app —
 * registration, profile, the airport request (three times on that one screen alone).
 *
 * WHY THIS FILE EXISTS: the confirmation line printed the country code TWICE.
 *
 *     ✓ Valid phone number ({selectedCountry.dialCode} {validation.e164})
 *
 * `e164` already begins with the dial code, so an Indian number rendered as
 * "+91 +911293812944" — on the one line whose entire job is to reassure somebody that
 * the number they typed is the number we hold. Spotted in a screenshot of the live app
 * on 2026-08-25, not by any test.
 *
 * Shared with Sabha Seva, so this covers both sides.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { PhoneNumberInput } from '../../components/auth/PhoneNumberInput';

const show = (props: Partial<React.ComponentProps<typeof PhoneNumberInput>> = {}) =>
    render(<PhoneNumberInput value="" onChange={vi.fn()} {...props} />);

describe('the confirmation line', () => {
    it('prints the country code ONCE, not once detached and once attached', async () => {
        show({ value: '+16175550123' });

        const line = screen.getByText(/Valid phone number/);
        expect(line).toHaveTextContent('+16175550123');
        // THE REGRESSION GUARD. "+1 +16175550123" is what shipped.
        expect(line.textContent).not.toMatch(/\+1\s+\+1/);
    });

    it('holds for a longer dial code too, where the doubling was most obvious', () => {
        // The reported case: +91 is two digits, so the duplication read as a typo
        // rather than as a format.
        show({ value: '+911293812944' });

        const line = screen.getByText(/Valid phone number/);
        expect(line.textContent).not.toMatch(/\+91\s+\+91/);
    });

    it('says nothing at all until there is something to confirm', () => {
        show();
        expect(screen.queryByText(/Valid phone number/)).not.toBeInTheDocument();
    });

    it('does not claim a half-typed number is valid', async () => {
        show();
        await userEvent.type(screen.getByLabelText(/phone number/i), '617');
        expect(screen.queryByText(/Valid phone number/)).not.toBeInTheDocument();
    });
});

/**
 * Found by this file: the <label> carried no `htmlFor` and the <input> no `id`, so the
 * field was announced as an unlabelled text box by every screen reader, on every form
 * in the app. The country <select> had only a `title`, which is a tooltip and not an
 * accessible name.
 */
describe('the field is actually labelled', () => {
    it('ties the label to the box, so it can be found by its name', () => {
        show({ label: 'Their phone number' });
        expect(screen.getByLabelText(/Their phone number/i).tagName).toBe('INPUT');
    });

    it('gives every instance its own id, since one form stacks three of them', () => {
        const { container } = render(
            <>
                <PhoneNumberInput value="" onChange={vi.fn()} label="Yours" />
                <PhoneNumberInput value="" onChange={vi.fn()} label="Theirs" />
            </>,
        );
        const ids = Array.from(container.querySelectorAll('input')).map(i => i.id);
        // A hardcoded id would point one label at the other field's box — worse than none.
        expect(new Set(ids).size).toBe(2);
        expect(ids.every(Boolean)).toBe(true);
    });

    it('names the country selector with aria-label, not with a tooltip', () => {
        show();
        const select = screen.getByRole('combobox', { name: /country code/i });
        // Asserted as the ATTRIBUTE, not via the accessible name: `title` also
        // satisfies getByRole's name option, so a name-only assertion passed happily
        // against the broken version. Real assistive tech does not treat a tooltip as
        // a label the way the accessible-name algorithm's last resort does.
        expect(select).toHaveAttribute('aria-label', 'Country code');
    });

    it('marks the box invalid so the refusal is announced, not just displayed', async () => {
        show();
        const box = screen.getByLabelText(/phone number/i);
        expect(box).toHaveAttribute('aria-invalid', 'false');
        await userEvent.type(box, '617');
        expect(box).toHaveAttribute('aria-invalid', 'true');
    });
});

describe('the privacy line', () => {
    it('is shown by default, because most call sites ask for one number', () => {
        show();
        expect(screen.getByText(/Kept private/i)).toBeInTheDocument();
    });

    /**
     * The airport form stacks three of these. The same sentence three times reads as a
     * rendering fault rather than as a promise, which is why the flag exists — so it
     * needs a guard that the flag still turns it off.
     */
    it('can be suppressed for the second and third of a stack', () => {
        show({ showPrivacyNote: false });
        expect(screen.queryByText(/Kept private/i)).not.toBeInTheDocument();
    });
});
