/**
 * The real verdict logic, with the DEVICE ZONE forced from the query string.
 *
 * `?zone=Asia/Kolkata` shows the abroad state; no param leaves the machine's own zone.
 * Without this the harness can only ever render one of the two, because the screen reads
 * `Intl` once at mount — so on a Mac in New York the dimmed card and its explanation
 * were unviewable, which is exactly the kind of state this repo keeps shipping defects
 * into. Mirrors `?role=driver` in auth-stub.tsx.
 *
 * `likelyInUsa` is re-exported UNCHANGED, so what the harness draws is decided by the
 * real zone table and not by a stub agreeing with itself.
 */
export { likelyInUsa } from '../src/utils/whereabouts';

export function deviceTimeZone(): string | undefined {
    const forced = new URLSearchParams(window.location.search).get('zone');
    if (forced) return forced;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}
