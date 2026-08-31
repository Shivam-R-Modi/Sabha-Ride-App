/**
 * THE AIRPORT SEVA TABLES EXIST TWICE. THEY MUST SAY THE SAME THING.
 *
 * `src/` and `functions/` have separate tsconfigs and no shared path, so the
 * transition table, the urgency thresholds, the airport zones and the field caps are
 * written out in both — the same arrangement as roles.ts, schedule.ts and tenancy.ts,
 * each of which carries a comment asking the next person to keep them in step. A
 * comment is a hope; this is a check. The owner's standing instruction on this repo
 * is "no parity so no future problems".
 *
 * Unlike `role-table-parity.test.ts`, which has to parse source text because one of
 * its six copies is `firestore.rules` and another is a `.cjs` script, both copies
 * here are dependency-free TypeScript. So they are IMPORTED and compared by value,
 * which is exact — reformatting is free and a changed meaning cannot slip through a
 * regex.
 *
 * WHAT DRIFT COSTS, in the two directions:
 *
 *   Client MORE permissive than the server → a Claim button renders, is tapped, and
 *   comes back failed-precondition. A dead control, this repo's signature defect.
 *
 *   Client LESS permissive → an action the server would allow is never offered. A
 *   capability that silently disappears. Harder to notice, and it has happened here
 *   before: `useUsers` once queried `role == 'driver'` and listed nobody, so "assign
 *   to any driver" could only ever say none were available.
 */

import { describe, it, expect } from 'vitest';
import * as client from '../../src/utils/arrival';
import * as server from '../../functions/src/utils/arrival';

describe('the two copies are the same table', () => {
    it('agree about which actions each status allows', () => {
        expect(client.ALLOWED_FROM).toEqual(server.ALLOWED_FROM);
    });

    it('agree about the status each action leaves behind', () => {
        expect(client.RESULT_OF).toEqual(server.RESULT_OF);
    });

    it('agree about which statuses are terminal', () => {
        expect(client.TERMINAL).toEqual(server.TERMINAL);
    });

    it('agree about what has already been alerted, including the legacy shape', () => {
        // `alertedBandHours` reads BOTH the number written now and the old
        // `alertsSent` map. A divergence would mean one side re-alerting a pickup the
        // other considers already handled.
        for (const data of [
            {}, { lastAlertedBandHours: 10 }, { alertsSent: { '48h': 'x', '24h': 'x' } },
            { lastAlertedBandHours: 2, alertsSent: { '48h': 'x' } },
            { alertsSent: { nonsense: 'x' } },
        ]) {
            expect(client.alertedBandHours(data)).toBe(server.alertedBandHours(data));
        }
    });

    it('agree about every airport code and its zone', () => {
        expect(client.AIRPORTS).toEqual(server.AIRPORTS);
    });

    it('agree about every field cap', () => {
        const caps = (m: typeof client) => ({
            MAX_NAME: m.MAX_NAME,
            MAX_SHORT_TEXT: m.MAX_SHORT_TEXT,
            MAX_NOTES: m.MAX_NOTES,
            MAX_ADDRESS: m.MAX_ADDRESS,
            MAX_PARTY_SIZE: m.MAX_PARTY_SIZE,
            MAX_BAGS: m.MAX_BAGS,
            MAX_DAYS_AHEAD: m.MAX_DAYS_AHEAD,
            // The digit envelope the server refuses a phone number outside. The
            // `Object.keys` check below catches one side GROWING a constant; this
            // catches the two disagreeing about its value, which is the drift that
            // would let a number pass the form and be refused by the callable.
            MIN_PHONE_DIGITS: m.MIN_PHONE_DIGITS,
            MAX_PHONE_DIGITS: m.MAX_PHONE_DIGITS,
        });
        expect(caps(client)).toEqual(caps(server as unknown as typeof client));
    });

    it('agree about the collection names', () => {
        expect(client.PICKUPS_COLLECTION).toBe(server.PICKUPS_COLLECTION);
        expect(client.PROFILES_COLLECTION).toBe(server.PROFILES_COLLECTION);
    });

    it('export exactly the same names, so neither grows a helper the other lacks', () => {
        // The check that catches the next divergence before it is a behaviour bug: a
        // function added to one side and not the other.
        expect(Object.keys(client).sort()).toEqual(Object.keys(server).sort());
    });
});

describe('the two copies behave the same, not just look the same', () => {
    const HOUR = 60 * 60 * 1000;

    it('canRun answers identically for every action and status pair', () => {
        // The value comparison above would pass even if one side's `canRun` had a
        // typo in its lookup. This exercises the function.
        for (const action of Object.keys(client.ALLOWED_FROM) as client.ArrivalAction[]) {
            for (const status of ['open', 'claimed', 'met', 'completed', 'cancelled', 'no_show'] as client.ArrivalStatus[]) {
                expect(
                    client.canRun(action, status),
                    `canRun(${action}, ${status})`,
                ).toBe(server.canRun(action as server.ArrivalAction, status as server.ArrivalStatus));
            }
        }
    });

    it('bandFor agrees across every boundary and either side of it', () => {
        for (const hours of [-5, 0, 1, 2, 3, 9, 10, 11, 23, 24, 25, 47, 48, 49, 100]) {
            expect(client.bandFor(hours * HOUR), `${hours}h`)
                .toBe(server.bandFor(hours * HOUR));
        }
    });

    it('urgencyOf agrees, which is what keeps the chip and the alert consistent', () => {
        const now = new Date('2026-09-01T12:00:00Z');
        for (const hours of [-1, 0, 5, 10, 11, 24, 25, 48, 49, 200]) {
            const at = new Date(now.getTime() + hours * HOUR).toISOString();
            expect(client.urgencyOf(at, now), `${hours}h`).toBe(server.urgencyOf(at, now));
        }
    });

    it('airportZone agrees, including for a code neither has heard of', () => {
        for (const code of ['BOS', 'ORD', 'LAX', 'bos', 'ZZZ', '']) {
            expect(client.airportZone(code, 'America/New_York'), code)
                .toBe(server.airportZone(code, 'America/New_York'));
        }
    });
});
