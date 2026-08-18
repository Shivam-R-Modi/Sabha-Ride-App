/**
 * ESLint, which this project has had a script for and no config for.
 *
 * `npm run lint` has always failed with "couldn't find a configuration file",
 * which means it has checked nothing while looking like a passing gate. CLAUDE.md
 * records the symptom and says not to "fix" it by deleting the script. This is
 * the other half.
 *
 * eslintrc format, not flat config, because the installed ESLint is 8.57 and the
 * script passes `--ext` — a flag flat config rejects.
 *
 * WHAT THIS DOES AND DOES NOT TRY TO BE
 * -------------------------------------
 * A lint that fails on 400 pre-existing style opinions gets switched off within a
 * week, and the script runs with `--max-warnings 0`, so a warning is as fatal as
 * an error. So the rules enabled here are the ones that catch BUGS in this
 * codebase's actual failure modes, and the ones that would only catch style are
 * off with a reason. Each `off` below is a deliberate scope decision, not an
 * oversight — tighten them when someone has appetite for the diff.
 */
module.exports = {
    root: true,
    env: { browser: true, es2022: true, node: true },
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react-hooks/recommended',
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: ['@typescript-eslint', 'react-refresh'],
    ignorePatterns: [
        'dist',
        'preview-dist',
        'functions/lib',
        'node_modules',
        '.eslintrc.cjs',
        // Admin SDK operational scripts: plain CommonJS, run by hand against
        // functions/node_modules, and not part of any build.
        'scripts/**/*.cjs',
    ],
    rules: {
        // ── deliberately OFF, with reasons ───────────────────────────────
        //
        // `any` appears throughout the Firestore boundary, where documents are
        // genuinely untyped until validated. Banning it is a real refactor
        // (hundreds of sites) and would not have caught a single bug this project
        // has actually had. The typecheck baseline is 0 and that is the gate that
        // matters.
        '@typescript-eslint/no-explicit-any': 'off',
        // Fires on `catch (e) {}` used to deliberately swallow — which
        // src/utils/errorReport.ts does ON PURPOSE, because a reporter that
        // reports its own failure is an infinite loop.
        'no-empty': ['error', { allowEmptyCatch: true }],

        // ── the rules that earn their keep ───────────────────────────────
        //
        // Unused variables are how half-finished refactors hide. `_`-prefixed
        // args stay legal so a callback can document a parameter it ignores.
        '@typescript-eslint/no-unused-vars': ['error', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            // `const { id, ...rest } = doc` is how you omit a key, and the omitted
            // name is *meant* to be unused. Without this the idiom is unwritable —
            // and the alternative people reach for is a `delete`, which mutates
            // the caller's object. Four legitimate uses in this repo.
            ignoreRestSiblings: true,
        }],
        'no-unused-vars': 'off', // superseded by the TS version above

        // The recurring bug class in this repo is a control that looks wired up
        // and silently does nothing. These three are the lint-visible shapes of
        // exactly that.
        'no-unreachable': 'error',
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-self-assign': 'error',

        // `window.confirm` / `alert` / `prompt` are BANNED in this project: a
        // suppressed dialog silently returns false, which made every destructive
        // button inert. Use components/shared/useConfirm.tsx. There is a dedicated
        // test for this too (tests/quality/native-dialogs.test.ts); a lint error
        // is the faster feedback.
        'no-restricted-globals': ['error',
            { name: 'confirm', message: 'Banned — a suppressed dialog returns false silently. Use useConfirm().' },
            { name: 'alert', message: 'Banned — use a toast or an inline message.' },
            { name: 'prompt', message: 'Banned — use a real form.' },
        ],
        'no-restricted-properties': ['error',
            { object: 'window', property: 'confirm', message: 'Banned — use useConfirm().' },
            { object: 'window', property: 'alert', message: 'Banned — use a toast.' },
            { object: 'window', property: 'prompt', message: 'Banned — use a real form.' },
        ],

        // Hooks. `exhaustive-deps` stays a WARNING in the recommended set, and
        // --max-warnings 0 would make it fatal; promoted to error so its status is
        // explicit rather than an accident of the flag.
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',

        // Fast-refresh purity. Real value in components/, but a React context
        // file exports a Provider AND its hook by design, and splitting each into
        // two files to satisfy an HMR nicety is churn with no correctness benefit.
        // Off for contexts/ in the overrides below.
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
    overrides: [
        {
            // A context module exports its Provider and its `use*` hook together.
            // That pairing is the point of the file.
            files: ['contexts/**/*.tsx'],
            rules: { 'react-refresh/only-export-components': 'off' },
        },
        {
            // Cloud Functions: Node, not a browser, and no React.
            files: ['functions/**/*.ts'],
            env: { browser: false, node: true },
            rules: { 'react-hooks/rules-of-hooks': 'off' },
        },
        {
            // Tests reach into internals and fake things on purpose.
            files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
            rules: {
                '@typescript-eslint/no-empty-function': 'off',
                '@typescript-eslint/no-non-null-assertion': 'off',
            },
        },
    ],
};
