/**
 * Turning whatever is in `settings/notifications` into a configuration.
 *
 * EVERY ASSERTION HERE IS ABOUT FAILING OPEN, because that is the one property this
 * function exists to guarantee. It is read inside `dispatch`, inside a completing
 * ride, inside a claimed pickup and inside two scheduled jobs — a throw would take
 * those down with it, and a wrong `false` would swallow "Your Sarthi is outside
 * waiting for you" with no error anywhere.
 *
 * A config bug that SENDS something somebody muted is a nuisance. A config bug that
 * SILENCES something is a volunteer parked outside and a child indoors. The whole
 * matrix below is written so that only an explicit, well-formed `false` can ever
 * produce silence.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveNotificationSettings,
    resolveAlertBands,
    DEFAULT_ALERT_BANDS,
    DEFAULT_NUDGE_COOLDOWN_SEC,
    DEFAULT_REMINDER_HOUR,
    NOTIFICATION_KEYS,
} from '../../src/constants/notifications';

describe('when there is nothing to read', () => {
    it.each([undefined, null, '', 0, 'nonsense', []])('%s gives the shipped defaults', (raw) => {
        const settings = resolveNotificationSettings(raw);
        for (const key of NOTIFICATION_KEYS) expect(settings.enabled[key]).toBe(true);
        expect(settings.alertBands).toEqual([...DEFAULT_ALERT_BANDS]);
        expect(settings.nudgeCooldownSec).toBe(DEFAULT_NUDGE_COOLDOWN_SEC);
        expect(settings.reminderHour).toBe(DEFAULT_REMINDER_HOUR);
        expect(settings.reminderCadence).toBe('daily');
    });

    it('never throws, whatever it is handed', () => {
        for (const raw of [Symbol('x'), () => {}, NaN, Infinity, { enabled: null }]) {
            expect(() => resolveNotificationSettings(raw as unknown)).not.toThrow();
        }
    });
});

describe('only an explicit false switches anything off', () => {
    it('honours a real false', () => {
        expect(resolveNotificationSettings({ enabled: { notice: false } }).enabled.notice)
            .toBe(false);
    });

    it.each([undefined, null, 0, '', 'false', NaN])(
        '%s is NOT off — it is "nobody has said otherwise"', (value) => {
            // The bug this shape prevents: a falsy check would read a missing key, a
            // null from a partial write, or the STRING "false" from a hand-edit as a
            // manager's decision to go silent.
            expect(resolveNotificationSettings({ enabled: { notice: value } }).enabled.notice)
                .toBe(true);
        });

    it('leaves every other notification alone', () => {
        const settings = resolveNotificationSettings({ enabled: { notice: false } });
        for (const key of NOTIFICATION_KEYS.filter(k => k !== 'notice')) {
            expect(settings.enabled[key], key).toBe(true);
        }
    });

    it('ignores a key that is not in the catalogue', () => {
        const settings = resolveNotificationSettings({ enabled: { made_up: false } });
        expect(settings.enabled).not.toHaveProperty('made_up');
    });
});

describe('the alert bands', () => {
    it('keeps only values a manager could actually have chosen', () => {
        expect(resolveAlertBands([48, 99, 24, -3, 'soon'])).toEqual([48, 24]);
    });

    it('sorts widest-first, because bandFor depends on it', () => {
        expect(resolveAlertBands([2, 48, 10])).toEqual([48, 10, 2]);
    });

    it('removes duplicates', () => {
        expect(resolveAlertBands([24, 24, 2])).toEqual([24, 2]);
    });

    it('caps the list, so "a bit more warning" cannot become a pager', () => {
        expect(resolveAlertBands([48, 24, 12, 10, 6, 2, 1])).toHaveLength(6);
    });

    it('treats an EMPTY result as a broken save, not as "never alert"', () => {
        // Turning the escalation off is what the airport-unclaimed switch is for, and
        // the panel says so. An empty array arriving here is far more likely to be a
        // half-written document — and guessing wrong leaves a traveller in an
        // arrivals hall with nobody coming.
        expect(resolveAlertBands([])).toEqual([...DEFAULT_ALERT_BANDS]);
        expect(resolveAlertBands(['nonsense', 99])).toEqual([...DEFAULT_ALERT_BANDS]);
    });
});

describe('the reminder hour', () => {
    it('accepts any hour of the day', () => {
        expect(resolveNotificationSettings({ reminderHour: 0 }).reminderHour).toBe(0);
        expect(resolveNotificationSettings({ reminderHour: 23 }).reminderHour).toBe(23);
    });

    it.each([24, -1, 9.5, '10', null])('%s falls back to 10am', (value) => {
        expect(resolveNotificationSettings({ reminderHour: value }).reminderHour).toBe(10);
    });
});

describe('the nudge cooldown', () => {
    it('accepts a value from the choice list', () => {
        expect(resolveNotificationSettings({ nudgeCooldownSec: 300 }).nudgeCooldownSec).toBe(300);
    });

    it('rejects one that is not, rather than letting a Sarthi buzz every second', () => {
        expect(resolveNotificationSettings({ nudgeCooldownSec: 1 }).nudgeCooldownSec).toBe(60);
    });
});
