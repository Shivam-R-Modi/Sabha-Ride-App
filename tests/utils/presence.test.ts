/**
 * The presence check must never be able to strand somebody.
 *
 * It is advisory by design: a rider is always offered the manual question, even
 * when GPS is confident they are far away. Being stuck at the temple with no way
 * to ask for a lift is worse than a driver making a wasted stop — and a check
 * that can strand a rider is the bug it replaces, wearing a new coat.
 *
 * The case worth the most care is the vague fix. "40m away, give or take 150m"
 * confirms nothing: passing it lets someone at home through, failing it strands
 * someone standing in the hall. It has to be neither.
 */

import { describe, it, expect } from 'vitest';
import {
    judgeFix, venueFor, describePresence, PRESENCE_RADIUS_METERS,
} from '../../src/utils/presence';

/** The founding venue, 360 Huntington Ave. */
const VENUE = { lat: 42.339925, lng: -71.088182 };

/** Roughly 60m north of the venue — inside the radius. */
const INSIDE = { lat: 42.340465, lng: -71.088182 };
/** Roughly 500m away — comfortably outside. */
const OUTSIDE = { lat: 42.344425, lng: -71.088182 };

describe('judgeFix', () => {
    it('confirms a sharp fix inside the radius', () => {
        const verdict = judgeFix({ ...INSIDE, accuracy: 10 }, VENUE);

        expect(verdict.confirmed).toBe(true);
        expect(verdict.reason).toBeUndefined();
        expect(verdict.distanceMeters).toBeLessThanOrEqual(PRESENCE_RADIUS_METERS);
    });

    it('refuses to confirm a sharp fix outside the radius', () => {
        const verdict = judgeFix({ ...OUTSIDE, accuracy: 10 }, VENUE);

        expect(verdict.confirmed).toBe(false);
        expect(verdict.reason).toBe('too-far');
    });

    it('refuses to confirm on a fix too vague to answer the question', () => {
        // Dead centre on the venue, but ±400m. That cannot confirm a 100m
        // question however good the coordinates look.
        const verdict = judgeFix({ ...VENUE, accuracy: 400 }, VENUE);

        expect(verdict.confirmed).toBe(false);
        expect(verdict.reason).toBe('fix-too-vague');
    });

    it('treats a missing or nonsense accuracy as too vague, never as a pass', () => {
        for (const accuracy of [NaN, Infinity, undefined as unknown as number]) {
            const verdict = judgeFix({ ...VENUE, accuracy }, VENUE);
            expect(verdict.confirmed).toBe(false);
            expect(verdict.reason).toBe('fix-too-vague');
        }
    });

    it('checks vagueness BEFORE distance, so a vague fix is never called too-far', () => {
        // The rider might well be at the sabha; we simply cannot tell. Reporting
        // 'too-far' would justify blocking them on evidence we do not have.
        const verdict = judgeFix({ ...OUTSIDE, accuracy: 5000 }, VENUE);

        expect(verdict.reason).toBe('fix-too-vague');
    });

    it('always reports a distance, so the manager can see what GPS thought', () => {
        expect(judgeFix({ ...OUTSIDE, accuracy: 10 }, VENUE).distanceMeters)
            .toBeGreaterThan(100);
        expect(judgeFix({ ...VENUE, accuracy: 9999 }, VENUE).distanceMeters)
            .toBeGreaterThanOrEqual(0);
    });

    it('rounds the distance to 10m, so a precise location is never reconstructable', () => {
        const verdict = judgeFix({ ...OUTSIDE, accuracy: 10 }, VENUE);

        expect(verdict.distanceMeters % 10).toBe(0);
    });

    it('honours a custom radius', () => {
        // Same fix, opposite verdicts. This is what lets the radius move to a
        // setting later without touching the logic.
        const fix = { ...INSIDE, accuracy: 5 };

        expect(judgeFix(fix, VENUE, 500).confirmed).toBe(true);
        expect(judgeFix(fix, VENUE, 10).confirmed).toBe(false);
    });

    it('is 100 metres by default', () => {
        expect(PRESENCE_RADIUS_METERS).toBe(100);
    });
});

describe('venueFor', () => {
    const EVENT = { lat: 1, lng: 2 };
    const DEFAULT = { lat: 3, lng: 4 };

    it('prefers the gathering\'s own venue', () => {
        // A manager can move one sabha. Measuring that evening against the
        // standing default would put every rider kilometres out and take the
        // whole check down for the night.
        expect(venueFor(EVENT, DEFAULT)).toEqual(EVENT);
    });

    it('falls back to the default when the gathering has no venue', () => {
        expect(venueFor(null, DEFAULT)).toEqual(DEFAULT);
        expect(venueFor(undefined, DEFAULT)).toEqual(DEFAULT);
    });

    it('rejects null island rather than measuring against the Atlantic', () => {
        // 0,0 is what an unset or half-written venue looks like. Measuring
        // against it puts everyone ~5000km away and sends every rider to the
        // manual question with a nonsense distance attached.
        expect(venueFor({ lat: 0, lng: 0 }, DEFAULT)).toEqual(DEFAULT);
    });

    it('returns null when there is no usable venue at all', () => {
        expect(venueFor(null, null)).toBeNull();
        expect(venueFor({ lat: NaN, lng: 5 }, undefined)).toBeNull();
    });
});

describe('describePresence', () => {
    it('distinguishes how each rider got into the queue', () => {
        expect(describePresence({ method: 'pickup' })).toMatch(/arrived by ride/i);
        expect(describePresence({ method: 'auto', distanceMeters: 40 })).toMatch(/40m/);
        expect(describePresence({ method: 'manual' })).toMatch(/confirmed by rider/i);
    });

    it('shows what GPS thought when a rider overrode it', () => {
        // The whole point of recording the method: abuse is visible rather than
        // silent, without anybody having been blocked.
        expect(describePresence({ method: 'manual', distanceMeters: 5100 }))
            .toMatch(/5\.1km/);
    });

    it('says so plainly when nothing was recorded', () => {
        expect(describePresence(null)).toBe('Not recorded');
        expect(describePresence({ method: 'unknown' })).toBe('Not recorded');
    });
});
