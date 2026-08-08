"use strict";
/**
 * Manager invite codes: generation, parsing and verification.
 *
 * Replaces `settings/managerCode`, which was one static string with no expiry, no
 * single use, no record of who it was given to, and no revocation short of
 * changing it for everyone at once. firestore.rules also let any approved manager
 * read it in plaintext, so anyone who became a manager could mint managers
 * forever.
 *
 * ## Shape of a code
 *
 *     A7K2M9-4FQXB2NRH3
 *     └ ref ┘ └ secret ┘
 *
 * The reference is the invite's Firestore document id, so redeeming is a single
 * document read rather than a scan of every invite testing each hash in turn. The
 * secret is never stored — only a salted scrypt hash of it — so the Database
 * Console cannot show a working code, which is exactly what it does today with
 * settings/managerCode.
 *
 * The alphabet omits I, L, O, U, 0 and 1: these get read aloud, written down and
 * retyped, and O/0 and I/1/L are where that goes wrong. Input is normalised
 * before comparison, so case, spaces and dashes do not matter.
 *
 * 10 secret characters over a 30-character alphabet is a little under 50 bits.
 * Combined with the redeem rate limit that is not brute-forceable; the hash is
 * scrypt rather than a bare SHA so that a leaked database dump is not either.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVITE_TTL_DAYS = void 0;
exports.generateInvite = generateInvite;
exports.normaliseCode = normaliseCode;
exports.splitCode = splitCode;
exports.makeSalt = makeSalt;
exports.hashSecret = hashSecret;
exports.verifySecret = verifySecret;
exports.rejectionFor = rejectionFor;
const crypto = __importStar(require("crypto"));
/** No I, L, O, U, 0 or 1 — the characters people mis-transcribe. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const REF_LENGTH = 6;
const SECRET_LENGTH = 10;
/** How long a fresh invite stays redeemable. */
exports.INVITE_TTL_DAYS = 7;
const SCRYPT_KEYLEN = 32;
function randomFrom(alphabet, length) {
    // rejection-free: 256 % 30 != 0 would bias, so draw a 32-bit value per char
    // and reject the tail rather than taking a modulo of a byte.
    const out = [];
    while (out.length < length) {
        const n = crypto.randomBytes(4).readUInt32BE(0);
        const limit = Math.floor(0xffffffff / alphabet.length) * alphabet.length;
        if (n >= limit)
            continue;
        out.push(alphabet[n % alphabet.length]);
    }
    return out.join('');
}
function generateInvite() {
    const ref = randomFrom(ALPHABET, REF_LENGTH);
    const secret = randomFrom(ALPHABET, SECRET_LENGTH);
    return { ref, secret, code: `${ref}-${secret}` };
}
/** Upper-case and drop anything outside the alphabet, so dashes/spaces/case are free. */
function normaliseCode(input) {
    return input.toUpperCase().split('').filter(c => ALPHABET.includes(c)).join('');
}
/**
 * Split a typed code into its reference and secret.
 *
 * Returns null when the input cannot be a code at all, so the caller can reject
 * without a Firestore read.
 */
function splitCode(input) {
    const clean = normaliseCode(input);
    if (clean.length !== REF_LENGTH + SECRET_LENGTH)
        return null;
    return {
        ref: clean.slice(0, REF_LENGTH),
        secret: clean.slice(REF_LENGTH),
    };
}
function makeSalt() {
    return crypto.randomBytes(16).toString('hex');
}
function hashSecret(secret, salt) {
    return crypto.scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex');
}
/**
 * Constant-time comparison.
 *
 * A plain `===` on a hash leaks its matching prefix through timing. That is a
 * thin attack over the network, but the correct comparison costs one line.
 */
function verifySecret(secret, salt, expectedHash) {
    const actual = Buffer.from(hashSecret(secret, salt), 'hex');
    let expected;
    try {
        expected = Buffer.from(expectedHash, 'hex');
    }
    catch (_a) {
        return false;
    }
    if (actual.length !== expected.length)
        return false;
    return crypto.timingSafeEqual(actual, expected);
}
/**
 * Why this invite cannot be redeemed, or null if it can.
 *
 * Pure, so every refusal is testable without a Firestore fake — each one is a
 * separate path a user can hit and each needs its own message.
 */
function rejectionFor(invite, secret, now) {
    if (!invite)
        return 'not-found';
    if (invite.usedBy)
        return 'already-used';
    if (invite.revokedAt)
        return 'revoked';
    if (typeof invite.expiresAt !== 'string')
        return 'expired';
    const expiry = Date.parse(invite.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime())
        return 'expired';
    if (typeof invite.salt !== 'string' || typeof invite.codeHash !== 'string')
        return 'wrong-code';
    if (!verifySecret(secret, invite.salt, invite.codeHash))
        return 'wrong-code';
    return null;
}
//# sourceMappingURL=invites.js.map