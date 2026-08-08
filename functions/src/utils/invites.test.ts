/**
 * Invite codes. Every refusal is a separate path with its own message, so each
 * gets its own case — "invalid code" for all five would hide a fixable mistake
 * (an expired invite and a mistyped one need different answers).
 */

import { describe, it, expect } from 'vitest';
import {
    generateInvite, normaliseCode, splitCode, makeSalt, hashSecret,
    verifySecret, rejectionFor, INVITE_TTL_DAYS,
} from './invites';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86400000).toISOString();

/** A live invite for `secret`. */
const liveInvite = (secret: string, overrides: Record<string, unknown> = {}) => {
    const salt = makeSalt();
    return {
        salt,
        codeHash: hashSecret(secret, salt),
        expiresAt: later(INVITE_TTL_DAYS),
        usedBy: null,
        revokedAt: null,
        ...overrides,
    };
};

describe('generateInvite', () => {
    it('produces a REF-SECRET code that splits back', () => {
        const { ref, secret, code } = generateInvite();
        expect(code).toBe(`${ref}-${secret}`);
        expect(splitCode(code)).toEqual({ ref, secret });
    });

    it('avoids the characters people mis-transcribe', () => {
        // I/L/O/U/0/1 are where read-aloud codes go wrong.
        for (let i = 0; i < 40; i++) {
            expect(generateInvite().code).not.toMatch(/[ILOU01]/);
        }
    });

    it('does not repeat itself', () => {
        const seen = new Set(Array.from({ length: 200 }, () => generateInvite().code));
        expect(seen.size).toBe(200);
    });
});

describe('normaliseCode / splitCode', () => {
    it('ignores case, spaces and dashes', () => {
        const { ref, secret, code } = generateInvite();
        const messy = ` ${code.toLowerCase().replace('-', ' - ')} `;
        expect(splitCode(messy)).toEqual({ ref, secret });
    });

    it('drops characters outside the alphabet rather than failing', () => {
        expect(normaliseCode('A7K2M9-4FQXB2NRH3')).toBe('A7K2M94FQXB2NRH3');
    });

    it('rejects anything of the wrong length without a lookup', () => {
        // Returning null here is what lets the callable refuse before reading
        // Firestore at all.
        expect(splitCode('')).toBeNull();
        expect(splitCode('TOOSHORT')).toBeNull();
        expect(splitCode('A7K2M9-4FQXB2NRH3-EXTRA')).toBeNull();
        expect(splitCode('!!!!')).toBeNull();
    });
});

describe('hashing', () => {
    it('never stores the secret itself', () => {
        const salt = makeSalt();
        expect(hashSecret('4FQXB2NRH3', salt)).not.toContain('4FQXB2NRH3');
    });

    it('salts, so two invites with the same secret hash differently', () => {
        expect(hashSecret('SAME', makeSalt())).not.toBe(hashSecret('SAME', makeSalt()));
    });

    it('verifies the right secret and refuses the wrong one', () => {
        const salt = makeSalt();
        const hash = hashSecret('4FQXB2NRH3', salt);
        expect(verifySecret('4FQXB2NRH3', salt, hash)).toBe(true);
        expect(verifySecret('4FQXB2NRH4', salt, hash)).toBe(false);
    });

    it('refuses a malformed stored hash without throwing', () => {
        const salt = makeSalt();
        expect(verifySecret('ANY', salt, 'not-hex')).toBe(false);
        expect(verifySecret('ANY', salt, '')).toBe(false);
    });
});

describe('rejectionFor — one reason per refusal', () => {
    const SECRET = '4FQXB2NRH3';

    it('accepts a live invite with the right secret', () => {
        expect(rejectionFor(liveInvite(SECRET), SECRET, NOW)).toBeNull();
    });

    it('not-found when the reference matches no invite', () => {
        expect(rejectionFor(null, SECRET, NOW)).toBe('not-found');
        expect(rejectionFor(undefined, SECRET, NOW)).toBe('not-found');
    });

    it('already-used, so an invite is single use', () => {
        expect(rejectionFor(liveInvite(SECRET, { usedBy: 'someone' }), SECRET, NOW))
            .toBe('already-used');
    });

    it('revoked', () => {
        expect(rejectionFor(liveInvite(SECRET, { revokedAt: NOW.toISOString() }), SECRET, NOW))
            .toBe('revoked');
    });

    it('expired, including exactly at the boundary', () => {
        expect(rejectionFor(liveInvite(SECRET, { expiresAt: later(-1) }), SECRET, NOW))
            .toBe('expired');
        // Expiry is not a grace period: at the instant it expires it is expired.
        expect(rejectionFor(liveInvite(SECRET, { expiresAt: NOW.toISOString() }), SECRET, NOW))
            .toBe('expired');
    });

    it('expired when expiresAt is missing or unparseable, rather than never expiring', () => {
        // Failing open here would make a malformed invite immortal.
        expect(rejectionFor(liveInvite(SECRET, { expiresAt: undefined }), SECRET, NOW)).toBe('expired');
        expect(rejectionFor(liveInvite(SECRET, { expiresAt: 'whenever' }), SECRET, NOW)).toBe('expired');
        expect(rejectionFor(liveInvite(SECRET, { expiresAt: 12345 }), SECRET, NOW)).toBe('expired');
    });

    it('wrong-code for a bad secret', () => {
        expect(rejectionFor(liveInvite(SECRET), 'WRONGSECRT', NOW)).toBe('wrong-code');
    });

    it('wrong-code when the stored hash or salt is missing', () => {
        expect(rejectionFor(liveInvite(SECRET, { salt: undefined }), SECRET, NOW)).toBe('wrong-code');
        expect(rejectionFor(liveInvite(SECRET, { codeHash: undefined }), SECRET, NOW)).toBe('wrong-code');
    });

    it('checks used and revoked BEFORE the secret', () => {
        // A spent invite must not become a way to test whether a secret was
        // right — the answer would be the same either way, but the ordering is
        // what guarantees it.
        expect(rejectionFor(liveInvite(SECRET, { usedBy: 'x' }), 'WRONGSECRT', NOW))
            .toBe('already-used');
    });
});
