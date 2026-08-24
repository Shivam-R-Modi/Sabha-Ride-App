import { describe, it, expect, beforeEach } from 'vitest';
import {
    SEEN_NOTICES_KEY, readSeenNotices, writeSeenNotices, pruneSeenNotices,
} from '../../src/utils/seenNotices';

/**
 * Which notices this device has opened.
 *
 * Device-scoped by choice, so the only thing that can go wrong is localStorage
 * itself — and localStorage does not merely return null in Safari's Lockdown Mode
 * or in a sandboxed iframe, it THROWS on access. A notice badge is not worth
 * taking a rider's dashboard down for, so every path here has to survive that.
 */
describe('seenNotices', () => {
    beforeEach(() => window.localStorage.clear());

    it('round-trips through localStorage', () => {
        writeSeenNotices(['n1', 'n2']);
        expect(readSeenNotices()).toEqual(['n1', 'n2']);
    });

    it('reads nothing when the key was never written', () => {
        expect(readSeenNotices()).toEqual([]);
    });

    it('reads malformed JSON as nothing seen, rather than throwing', () => {
        window.localStorage.setItem(SEEN_NOTICES_KEY, '{not json');
        expect(() => readSeenNotices()).not.toThrow();
        expect(readSeenNotices()).toEqual([]);
    });

    it('reads a non-array as nothing seen', () => {
        window.localStorage.setItem(SEEN_NOTICES_KEY, '{"n1":true}');
        expect(readSeenNotices()).toEqual([]);
    });

    it('drops elements that are not ids', () => {
        // Every element is checked, not just the array. Otherwise a half-written
        // value puts a number into an id comparison and a badge flickers.
        window.localStorage.setItem(SEEN_NOTICES_KEY, '["n1", 7, null, "", "n2"]');
        expect(readSeenNotices()).toEqual(['n1', 'n2']);
    });

    it('survives a storage that throws on read', () => {
        // Lockdown Mode. The injected stand-in is the pattern the theme and push
        // wrappers already use for exactly this.
        const throwing = { getItem: () => { throw new Error('SecurityError'); } };
        expect(readSeenNotices(throwing)).toEqual([]);
    });

    it('survives a storage that throws on write', () => {
        const throwing = { setItem: () => { throw new Error('SecurityError'); } };
        expect(() => writeSeenNotices(['n1'], throwing)).not.toThrow();
    });

    it('fails towards the badge showing, not towards it hiding', () => {
        // The direction matters. An unread notice shown as read is the one
        // mistake that loses information the rider needed.
        window.localStorage.setItem(SEEN_NOTICES_KEY, 'garbage');
        expect(readSeenNotices()).not.toContain('n1');
    });
});

describe('pruneSeenNotices', () => {
    it('drops ids that are no longer on the board', () => {
        // Expired notices are deleted server-side. Without this the key grows for
        // the life of the install and never shrinks.
        expect(pruneSeenNotices(['n1', 'gone', 'n2'], ['n1', 'n2'])).toEqual(['n1', 'n2']);
    });

    it('keeps the order it was given', () => {
        expect(pruneSeenNotices(['n2', 'n1'], ['n1', 'n2'])).toEqual(['n2', 'n1']);
    });

    it('adds the one just opened', () => {
        expect(pruneSeenNotices(['n1'], ['n1', 'n2'], 'n2')).toEqual(['n1', 'n2']);
    });

    it('does not add an id twice', () => {
        expect(pruneSeenNotices(['n1'], ['n1'], 'n1')).toEqual(['n1']);
    });

    it('ignores an opened id that is not on the board', () => {
        expect(pruneSeenNotices([], ['n1'], 'ghost')).toEqual([]);
    });

    it('empties out when the board does', () => {
        expect(pruneSeenNotices(['n1', 'n2'], [])).toEqual([]);
    });
});
