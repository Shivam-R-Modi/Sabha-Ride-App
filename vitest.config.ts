import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.test.{ts,tsx}'],
        // Rules tests need the Firestore emulator running, so they are not part
        // of the default run. Use `npm run test:rules`, which starts the
        // emulator around them via `firebase emulators:exec`.
        exclude: ['node_modules/**', 'tests/rules/**'],
        setupFiles: [],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
});
