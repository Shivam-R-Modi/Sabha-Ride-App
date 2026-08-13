/**
 * Vitest setup for component tests.
 *
 * Until now nothing in this repo ever rendered a component — all 70 client tests
 * were pure logic. That was fine while the UI was stable; it is not fine
 * alongside a redesign, because the one thing that must survive the redesign is
 * that every screen still does what it did.
 *
 * The rule for every test in tests/components: assert on TEXT, ROLES and
 * BEHAVIOUR, never on class names. A test that asserts `clay-card` fails the
 * moment the surface treatment changes, which is exactly the change these tests
 * are supposed to be indifferent to.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// jsdom implements neither, and several screens call them on mount.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => { },
        removeListener: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

if (!window.scrollTo) {
    window.scrollTo = (() => { }) as unknown as typeof window.scrollTo;
}
