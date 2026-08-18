/**
 * Reading a message off something thrown, without lying about what it was.
 *
 * `catch (e: unknown)` is correct, but eleven places reached for `e.message`
 * anyway and did not compile. Those were most of the standing typecheck errors,
 * and the errors mattered: a REAL one hid in the noise on 2026-08-18 and would
 * have shipped a blank screen.
 *
 * The tempting fix is `(e as Error).message`. These cases are why it is wrong.
 */

import { describe, it, expect } from 'vitest';
import { codeOf, messageOf } from '../../src/utils/errorText';

describe('messageOf', () => {
    it('reads a real Error', () => {
        expect(messageOf(new Error('home address is not set'))).toBe('home address is not set');
    });

    it('reads a bare thrown string', () => {
        // `throw 'nope'` and `Promise.reject('nope')` both happen in the wild.
        // A cast to Error would give undefined here.
        expect(messageOf('nope')).toBe('nope');
    });

    it('reads an object that merely carries a message', () => {
        // Where Firebase callable errors and hand-thrown literals land.
        expect(messageOf({ message: 'permission denied', code: 'functions/permission-denied' }))
            .toBe('permission denied');
    });

    it('falls back rather than returning "[object Object]"', () => {
        // The failure mode that matters most: a user-facing toast reading
        // "[object Object]" looks like the app is broken, which is worse than a
        // plain sentence that admits it does not know.
        expect(messageOf({ nothing: true }, 'Could not save.')).toBe('Could not save.');
        expect(messageOf({ nothing: true })).toBe('');
    });

    it('falls back on null, undefined and an empty message', () => {
        expect(messageOf(null, 'fallback')).toBe('fallback');
        expect(messageOf(undefined, 'fallback')).toBe('fallback');
        expect(messageOf('', 'fallback')).toBe('fallback');
        expect(messageOf(new Error(''), 'fallback')).toBe('fallback');
    });

    it('prefers a real Error over a decoy message property', () => {
        const err = new Error('the real one');
        (err as unknown as Record<string, unknown>).message = 'the real one';
        expect(messageOf(err)).toBe('the real one');
    });

    it('ignores a non-string message', () => {
        // `{ message: 42 }` would otherwise become the number 42 in a string slot.
        expect(messageOf({ message: 42 }, 'fallback')).toBe('fallback');
    });
});

describe('codeOf', () => {
    it('reads a Firebase-style code', () => {
        expect(codeOf({ code: 'auth/weak-password' })).toBe('auth/weak-password');
    });

    it('returns null rather than guessing', () => {
        // LoginScreen switches on these to turn a code into wording a person can
        // act on, so an invented value would send someone the wrong advice.
        expect(codeOf(new Error('no code here'))).toBeNull();
        expect(codeOf('a string')).toBeNull();
        expect(codeOf(null)).toBeNull();
        expect(codeOf({ code: 500 })).toBeNull();
    });
});
