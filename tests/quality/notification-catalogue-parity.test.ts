/**
 * THE NOTIFICATION CATALOGUE EXISTS TWICE. IT MUST SAY THE SAME THING.
 *
 * `src/constants/notifications.ts` renders the manager's control panel.
 * `functions/src/constants/notifications.ts` is what `sendNotification` actually obeys.
 * Separate tsconfigs, no shared path, so the file is written out in both — the same
 * arrangement as arrival.ts, roles.ts and tenancy.ts.
 *
 * WHAT DRIFT COSTS HERE IS WORSE THAN USUAL, because both directions are silent:
 *
 *   A key on the CLIENT but not the server → the panel shows a switch, the manager
 *   turns it off, the audit row records it, and the notification keeps going out.
 *   Nothing errors. The manager has been told a lie by a control that looks like it
 *   worked.
 *
 *   A key on the SERVER but not the client → a notification nobody can see or manage,
 *   which is the state the whole feature exists to end.
 *
 * Compared BY VALUE, not by parsing text, because both copies are dependency-free
 * TypeScript. Reformatting is free; a changed meaning cannot slip through.
 */

import { describe, it, expect } from 'vitest';
import * as client from '../../src/constants/notifications';
import * as server from '../../functions/src/constants/notifications';

describe('the two copies are the same catalogue', () => {
    it('list the same notifications, in the same order', () => {
        expect(client.NOTIFICATION_KEYS).toEqual(server.NOTIFICATION_KEYS);
    });

    it('agree about every field of every entry', () => {
        // Service and `important` are the two that decide where a row renders and
        // whether it asks twice before going quiet.
        expect(client.NOTIFICATION_CATALOGUE).toEqual(server.NOTIFICATION_CATALOGUE);
    });

    it('agree about the band choices a manager may pick from', () => {
        expect(client.ALERT_BAND_CHOICES).toEqual(server.ALERT_BAND_CHOICES);
        expect(client.DEFAULT_ALERT_BANDS).toEqual(server.DEFAULT_ALERT_BANDS);
        expect(client.MAX_ALERT_BANDS).toBe(server.MAX_ALERT_BANDS);
    });

    it('agree about the nudge cooldown choices', () => {
        expect(client.NUDGE_COOLDOWN_CHOICES).toEqual(server.NUDGE_COOLDOWN_CHOICES);
        expect(client.DEFAULT_NUDGE_COOLDOWN_SEC).toBe(server.DEFAULT_NUDGE_COOLDOWN_SEC);
    });

    it('agree about the reminder defaults', () => {
        expect(client.REMINDER_CADENCES).toEqual(server.REMINDER_CADENCES);
        expect(client.DEFAULT_REMINDER_HOUR).toBe(server.DEFAULT_REMINDER_HOUR);
    });

    it('resolve an identical configuration from identical input', () => {
        // The one function both sides run. A divergence here is the panel showing a
        // manager a different configuration from the one being enforced.
        const cases: unknown[] = [
            undefined,
            null,
            {},
            { enabled: { sarthi_arrived: false }, alertBands: [24, 2], reminderHour: 7 },
            { enabled: 'nonsense', alertBands: 'nonsense', nudgeCooldownSec: 9999 },
        ];
        for (const input of cases) {
            expect(client.resolveNotificationSettings(input))
                .toEqual(server.resolveNotificationSettings(input));
        }
    });
});

describe('the catalogue is internally coherent', () => {
    it('has no duplicate keys', () => {
        expect(new Set(client.NOTIFICATION_KEYS).size).toBe(client.NOTIFICATION_KEYS.length);
    });

    it('puts every entry in exactly one service, and neither is empty', () => {
        // The panel is split in two — sabha settings in Setup, airport settings on the
        // Arrivals board. An entry in neither would render nowhere at all.
        const sabha = client.catalogueFor('sabha');
        const airport = client.catalogueFor('airport');
        expect(sabha.length).toBeGreaterThan(0);
        expect(airport.length).toBeGreaterThan(0);
        expect(sabha.length + airport.length).toBe(client.NOTIFICATION_CATALOGUE.length);
    });

    it('only claims a frequency control for the three that have one', () => {
        // Eleven of the fourteen fire once when something happens. A frequency field
        // rendered against one of those would change nothing.
        const withFrequency = client.NOTIFICATION_CATALOGUE
            .filter(s => s.frequency !== 'none').map(s => s.key);
        expect(withFrequency.sort()).toEqual(
            ['airport-unclaimed', 'ride-reminder', 'sarthi_waiting'],
        );
    });

    it('defaults every notification to ON', () => {
        // Shipping with anything off would silence a notification nobody chose to
        // silence, on an upgrade nobody was told about.
        for (const key of client.NOTIFICATION_KEYS) {
            expect(client.DEFAULT_NOTIFICATION_SETTINGS.enabled[key]).toBe(true);
        }
    });

    it('can express its own shipped defaults through the choices it offers', () => {
        // If a default were not in the choice list, the first save from an untouched
        // panel would silently change behaviour.
        for (const band of client.DEFAULT_ALERT_BANDS) {
            expect(client.ALERT_BAND_CHOICES).toContain(band);
        }
        expect(client.NUDGE_COOLDOWN_CHOICES).toContain(client.DEFAULT_NUDGE_COOLDOWN_SEC);
    });
});
