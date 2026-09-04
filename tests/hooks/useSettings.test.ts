/**
 * `useSettings` copies `settings/main` into React state, and it is the copying that
 * broke.
 *
 * `requestsOpenTime` was declared on `AppSettings`, written by
 * `updateRequestsOpenTime`, returned by the hook and read by the server — but the state
 * object built from the snapshot never copied it off the document. So it was
 * permanently `undefined`, and the manager's "Requests open at" input rendered blank
 * over a setting that was working perfectly.
 *
 * WHY THIS FILE AND NOT JUST THE COMPONENT TEST. There is a
 * `tests/components/RideWindowControl.test.tsx` asserting the manager sees the saved
 * time, and it passes — but it MOCKS this hook, so deleting the field from the snapshot
 * again leaves it green. Verified by mutation. A screen test cannot see a bug in the
 * hook it stubs out, which is exactly why the original defect had no failing test to
 * find it: every consumer was mocked.
 *
 * So the assertion here is deliberately narrow and unfashionable: **every field the
 * document carries reaches state.** It is the kind of test that looks like it is
 * testing an assignment statement, and the assignment statement is what was missing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

let stored: Record<string, unknown> | undefined;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}),
    setDoc: vi.fn(),
    onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
        next({ exists: () => stored !== undefined, data: () => stored });
        return () => undefined;
    },
}));

import { useSettings } from '../../hooks/useSettings';

const VENUE = { lat: 42.34, lng: -71.09, address: '360 Huntington Ave, Boston, MA 02115' };

beforeEach(() => {
    vi.clearAllMocks();
    stored = undefined;
});

describe('what reaches state from the document', () => {
    it('carries requestsOpenTime — the field that was silently dropped', async () => {
        stored = { sabhaLocation: VENUE, requestsOpenTime: '07:30' };
        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.requestsOpenTime).toBe('07:30');
    });

    it('carries every other field it declares, so none can be forgotten the same way', async () => {
        stored = {
            sabhaLocation: VENUE,
            sabhaStartTime: '20:30',
            sabhaEndTime: '22:00',
            requestsOpenTime: '09:00',
            lastUpdated: '2026-09-01T00:00:00.000Z',
            updatedBy: 'mgr_1',
        };
        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.sabhaLocation).toEqual(VENUE);
        expect(result.current.sabhaStartTime).toBe('20:30');
        expect(result.current.sabhaEndTime).toBe('22:00');
        expect(result.current.requestsOpenTime).toBe('09:00');
        expect(result.current.settings.lastUpdated).toBe('2026-09-01T00:00:00.000Z');
        expect(result.current.settings.updatedBy).toBe('mgr_1');
    });

    it('reports loading as finished, so a consumer can tell "absent" from "not yet"', async () => {
        // The other half of the same bug: `undefined` meant both, so
        // RideWindowControl could not distinguish them and left its input blank.
        stored = { sabhaLocation: VENUE };
        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.requestsOpenTime).toBeUndefined();
    });
});

describe('when the document is missing or thin', () => {
    it('falls back to the shipped venue and times rather than rendering nothing', async () => {
        stored = undefined;
        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.sabhaLocation.address).toMatch(/Huntington/);
        expect(result.current.sabhaStartTime).toBeTruthy();
        expect(result.current.sabhaEndTime).toBeTruthy();
    });

    it('fills in only the missing times, keeping what is there', async () => {
        stored = { sabhaLocation: VENUE, sabhaStartTime: '18:00' };
        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.sabhaStartTime).toBe('18:00');
        expect(result.current.sabhaEndTime).toBeTruthy();
    });
});
