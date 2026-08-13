import { defineConfig, type UserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    // Component tests render JSX, so the test transform needs the React plugin
    // too — not just the dev/build config.
    //
    // The cast is a version-skew workaround, not a silenced bug: vitest 1.6
    // bundles Vite 5's `Plugin` type while this project runs Vite 6, so the two
    // structurally identical types do not unify. It behaves correctly at
    // runtime — the component tests below only run because of this plugin.
    plugins: [react() as unknown as NonNullable<UserConfig['plugins']>[number]],
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.test.{ts,tsx}'],
        // Rules tests need the Firestore emulator running, so they are not part
        // of the default run. Use `npm run test:rules`, which starts the
        // emulator around them via `firebase emulators:exec`.
        exclude: ['node_modules/**', 'tests/rules/**'],
        setupFiles: ['tests/setup.ts'],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
});
