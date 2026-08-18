/**
 * Reading a message or a code off something that was thrown.
 *
 * `catch (e: unknown)` is correct — a `throw` can carry anything — but it means
 * `e.message` does not compile, and eleven places in this app reached for it
 * anyway. Those were the bulk of the project's standing typecheck errors, and the
 * errors mattered: they were noise that a REAL type error could hide in. One
 * shipped a blank screen past `npm run build` on 2026-08-18 and was only caught
 * because someone happened to read the typecheck output.
 *
 * Deliberately not `(e as Error).message`. That is the same bug with a cast on
 * top: a rejected promise carrying a string, or `throw { code: 'x' }`, gives
 * `undefined` and the user gets "undefined" in a toast.
 *
 * No firebase imports here on purpose, so anything can use it without pulling
 * Firestore in, and so the narrowing rules are testable on their own.
 */

/** Does this look like an object carrying a string `key`? */
function stringProp(value: unknown, key: string): string | null {
    if (typeof value !== 'object' || value === null) return null;
    const found = (value as Record<string, unknown>)[key];
    return typeof found === 'string' && found.length > 0 ? found : null;
}

/**
 * The most useful human-readable string available, or `fallback`.
 *
 * Order matters. A real `Error` wins, then a bare thrown string, then an object
 * that merely happens to carry `message` — which is where Firebase callable
 * errors and hand-thrown object literals land.
 *
 * Never returns `"[object Object]"`: that is worse than the fallback, because it
 * looks like a bug in the app rather than a missing message.
 */
export function messageOf(error: unknown, fallback = ''): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.length > 0) return error;

    const message = stringProp(error, 'message');
    if (message) return message;

    return fallback;
}

/**
 * A Firebase-style error code (`functions/permission-denied`, `auth/weak-password`).
 *
 * Returns null rather than a guess, so callers branch on a code they actually
 * received. `LoginScreen` already switches on these to turn `auth/weak-password`
 * into wording a person can act on.
 */
export function codeOf(error: unknown): string | null {
    return stringProp(error, 'code');
}
