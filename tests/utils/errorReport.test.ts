/**
 * A crash reporter that must not leak, must not loop, and must not crash.
 *
 * Before this, a client-side failure produced a `console.error` on somebody's
 * phone and nothing else. Cloud Functions errors reach Cloud Logging, so the
 * server half was observable; the browser half — where a rider actually sees a
 * dead screen — was invisible.
 *
 * The three things that could turn this from a safety net into a liability, in
 * order of severity:
 *
 *   LEAK   this app holds children's names, phone numbers and addresses. A
 *          reporter that captures a URL query string or arbitrary state is how
 *          that gets copied somewhere it was never meant to be.
 *   LOOP   a render loop throws thousands of times a second. Uncapped, one broken
 *          screen writes until it fills the collection and the bill.
 *   THROW  a reporter that can throw turns one bug into two, and reporting its
 *          own failure is an infinite loop that bills by the write.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    MAX_MESSAGE, MAX_PER_SESSION, MAX_STACK,
    buildErrorReport, bundleOf, resetReportingForTests, shouldSend, signatureOf,
} from '../../src/utils/errorReport';

const CTX = {
    pathname: '/dashboard',
    userAgent: 'Mozilla/5.0 (iPhone)',
    uid: 'stu_1',
    bundle: 'index-BBzGHgyY.js',
};

beforeEach(() => resetReportingForTests());

describe('buildErrorReport — what it refuses to collect', () => {
    it('keeps the path but DROPS the query string', () => {
        // The classic accidental leak. `?student=…&phone=…` in a URL would be
        // copied verbatim into a collection a manager can read.
        const r = buildErrorReport('render', new Error('boom'), {
            ...CTX, pathname: '/rider?studentId=abc123&phone=6175550143',
        });

        expect(r.path).toBe('/rider');
        expect(JSON.stringify(r)).not.toContain('6175550143');
        expect(JSON.stringify(r)).not.toContain('abc123');
    });

    it('drops the hash too', () => {
        const r = buildErrorReport('render', new Error('boom'), { ...CTX, pathname: '/x#token=zzz' });

        expect(r.path).toBe('/x');
        expect(JSON.stringify(r)).not.toContain('zzz');
    });

    it('records only the documented fields', () => {
        // A whitelist, asserted. If somebody adds `state` or `props` here later,
        // this fails and they have to justify it.
        const r = buildErrorReport('render', new Error('boom'), CTX);

        expect(Object.keys(r).sort()).toEqual(
            ['bundle', 'kind', 'message', 'path', 'stack', 'uid', 'userAgent'].sort(),
        );
    });

    it('keeps the uid, which is the point', () => {
        // Deliberate: it is the only way to help the specific person who says
        // "the app broke", and it is this system's own key rather than new
        // information about them.
        expect(buildErrorReport('render', new Error('x'), CTX).uid).toBe('stu_1');
    });
});

describe('buildErrorReport — robustness', () => {
    it('survives a non-Error being thrown', () => {
        // `throw 'a string'` and `Promise.reject(undefined)` both happen.
        expect(buildErrorReport('promise', 'just a string', CTX).message).toBe('just a string');
        expect(buildErrorReport('promise', undefined, CTX).message).toBe('Unknown error');
        expect(buildErrorReport('promise', null, CTX).message).toBe('Unknown error');
        expect(buildErrorReport('promise', { odd: true }, CTX).stack).toBeNull();
    });

    it('truncates a runaway message and stack', () => {
        const err = new Error('x'.repeat(5000));
        err.stack = 'y'.repeat(50_000);

        const r = buildErrorReport('window', err, CTX);

        expect(r.message).toHaveLength(MAX_MESSAGE);
        expect(r.stack).toHaveLength(MAX_STACK);
    });

    it('records which bundle was RUNNING', () => {
        // The field that would have saved an hour on 2026-08-17, when a bug was
        // reported against a build that was already fixed and deployed.
        const doc = { querySelector: () => ({ getAttribute: () => '/assets/index-ABC123.js' }) };

        expect(bundleOf(doc as never)).toBe('index-ABC123.js');
    });

    it('reports a null bundle rather than throwing when there is no module script', () => {
        expect(bundleOf({ querySelector: () => null } as never)).toBeNull();
    });
});

describe('the caps that stop a render loop from becoming an outage', () => {
    it('sends the same crash only once', () => {
        const sig = signatureOf({ kind: 'render', message: 'boom', stack: 'at f()' });

        expect(shouldSend(sig)).toBe(true);
        expect(shouldSend(sig)).toBe(false);
        expect(shouldSend(sig)).toBe(false);
    });

    it('stops after the session cap, even for DIFFERENT crashes', () => {
        // Distinct signatures, so dedup does not save us — this is the separate
        // volume cap doing the work.
        for (let i = 0; i < MAX_PER_SESSION; i++) {
            expect(shouldSend(`unique-${i}`)).toBe(true);
        }
        expect(shouldSend('one-too-many')).toBe(false);
    });

    it('caps low enough to be safe and high enough to diagnose', () => {
        expect(MAX_PER_SESSION).toBeLessThanOrEqual(10);
        expect(MAX_PER_SESSION).toBeGreaterThanOrEqual(3);
    });

    it('distinguishes crashes that differ only in kind', () => {
        // The same message from a render error and from a rejected promise are
        // different bugs with different causes.
        expect(signatureOf({ kind: 'render', message: 'm', stack: null }))
            .not.toBe(signatureOf({ kind: 'promise', message: 'm', stack: null }));
    });
});
