import { defineConfig } from 'vitest/config';

/**
 * Firestore security-rules tests. Run via `npm run test:rules`, which wraps
 * these in `firebase emulators:exec` so the emulator is up for the duration.
 *
 * Separate from the main config because these need a node environment (not
 * jsdom) and must not run in the default `npm test`, where the emulator is not
 * running and every test would fail for the wrong reason.
 */
export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/rules/**/*.test.ts'],
        // Rules evaluation against the emulator is slower than pure unit tests,
        // and the suite serialises on a single emulator instance.
        testTimeout: 20000,
        hookTimeout: 30000,
        fileParallelism: false,
    },
});
