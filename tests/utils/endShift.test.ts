/**
 * A driver who declines the warning is still on shift, and the screen must say so.
 *
 * The dangerous shape here is not the dialog — it is the caller treating
 * `needsConfirmation` as success. That would show "Shift ended, thank you for
 * driving", refresh the profile and navigate away while the driver is still on
 * shift holding a car: a green confirmation for something that did not happen,
 * which is the failure mode this codebase keeps removing.
 */

import { describe, it, expect, vi } from 'vitest';
import { endShiftWithWarning } from '../../src/utils/endShift';

/** Typed so `ask.mock.calls[0]![0]` is the options object, not `never`. */
interface AskOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
}

const asker = (answer: boolean) => vi.fn(async (_options: AskOptions) => answer);

const OK = { success: true, driverId: 'd1', carReleased: true, message: 'done' };
const NEEDS = {
    success: false,
    driverId: 'd1',
    carReleased: false,
    message: 'w',
    needsConfirmation: true,
    waitingCount: 2,
    warning: '2 riders are still waiting, and you are the last driver on shift.',
};

describe('endShiftWithWarning', () => {
    it('ends the shift with no dialog when nothing is waiting', async () => {
        const done = vi.fn(async () => OK);
        const ask = asker(true);

        expect(await endShiftWithWarning('d1', done, ask)).toBe(true);
        expect(ask).not.toHaveBeenCalled();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('asks before finishing when riders are still waiting', async () => {
        const done = vi.fn(async () => NEEDS);
        const ask = asker(false);

        await endShiftWithWarning('d1', done, ask);

        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask.mock.calls[0]![0].message).toMatch(/2 riders are still waiting/);
    });

    it('reports FAILURE when the driver keeps driving', async () => {
        // The whole point: a false return is what stops the caller announcing a
        // shift that never ended.
        const done = vi.fn(async () => NEEDS);
        const ask = asker(false);

        expect(await endShiftWithWarning('d1', done, ask)).toBe(false);
    });

    it('does not call the server again when the driver keeps driving', async () => {
        const done = vi.fn(async () => NEEDS);
        const ask = asker(false);

        await endShiftWithWarning('d1', done, ask);

        expect(done).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith('d1');
    });

    it('acknowledges and finishes when the driver goes anyway', async () => {
        const done = vi.fn(async () => NEEDS);
        const ask = asker(true);

        expect(await endShiftWithWarning('d1', done, ask)).toBe(true);
        expect(done).toHaveBeenCalledTimes(2);
        expect(done).toHaveBeenLastCalledWith('d1', true);
    });

    it('offers "Keep driving" as the way out, not a bare cancel', async () => {
        const done = vi.fn(async () => NEEDS);
        const ask = asker(false);

        await endShiftWithWarning('d1', done, ask);

        const options = ask.mock.calls[0]![0];
        expect(options.cancelLabel).toBe('Keep driving');
        expect(options.confirmLabel).toBe('Finish anyway');
        expect(options.destructive).toBe(true);
    });

    it('still asks when the server sends no warning text', async () => {
        // Silently finishing because a field was missing would be the same bug
        // in a different coat.
        const done = vi.fn(async () => ({ ...NEEDS, warning: undefined }));
        const ask = asker(false);

        expect(await endShiftWithWarning('d1', done, ask)).toBe(false);
        expect(ask.mock.calls[0]![0].message).toMatch(/still waiting/);
    });
});
