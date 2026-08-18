/**
 * Client-side crash reporting, without a third-party processor.
 *
 * WHY NOT SENTRY
 * --------------
 * Two reasons, and the second is the deciding one.
 *
 * 1. It is a new dependency for something twenty lines of Firestore can do.
 * 2. This app holds the names, phone numbers and home addresses of a
 *    congregation that includes minors. An error reporter is exactly the kind of
 *    tool that hoovers up state, breadcrumbs and URLs and posts them to somebody
 *    else's servers. Adding a vendor here is a data-processing decision with
 *    legal weight — it belongs in docs/compliance/privacy-and-data.md and in a
 *    conversation with whoever is accountable for the congregation's data, not
 *    in a package.json diff.
 *
 * So reports go to Firestore, which the project already owns and already
 * accounts for. Managers can read them; nobody else can.
 *
 * WHAT IS DELIBERATELY NOT COLLECTED
 * ----------------------------------
 * No names, no phone numbers, no addresses, no coordinates, and no query string
 * or hash — a URL is the classic accidental leak, so only `pathname` is kept.
 * The `uid` IS kept: it is the only way to help a specific person who reports
 * "the app broke", and it is already the primary key of this system rather than
 * new information about them.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { messageOf } from './errorText';

/** Truncation limits. A stack is diagnostic, not an archive. */
export const MAX_MESSAGE = 500;
export const MAX_STACK = 2000;

/**
 * Most reports one page load may send.
 *
 * A render loop can throw thousands of times a second. Uncapped, one broken
 * screen on one phone would write until it filled the collection and the bill —
 * turning a display bug into an outage. Five is enough to diagnose anything; the
 * sixth would say nothing the first five did not.
 */
export const MAX_PER_SESSION = 5;

export interface ClientErrorReport {
    kind: 'render' | 'window' | 'promise';
    message: string;
    stack: string | null;
    path: string;
    bundle: string | null;
    userAgent: string;
    uid: string | null;
}

/** A stable signature for "the same crash again". */
export function signatureOf(report: Pick<ClientErrorReport, 'kind' | 'message' | 'stack'>): string {
    return `${report.kind}|${report.message}|${(report.stack ?? '').slice(0, 200)}`;
}

/**
 * Which JS bundle was actually running.
 *
 * This is the single most useful field here, and it is the reason it exists: on
 * 2026-08-17 a bug was reported against a build that had already been fixed and
 * deployed, and there was no way to tell from the report which bundle the browser
 * had. Read from the loaded module script rather than baked in at build time, so
 * it reports what is RUNNING rather than what was compiled.
 */
export function bundleOf(doc: Pick<Document, 'querySelector'>): string | null {
    const src = doc.querySelector('script[type=module]')?.getAttribute('src');
    return src ? src.split('/').pop() ?? null : null;
}

/**
 * Shape a report, dropping anything sensitive.
 *
 * Pure, and the only place redaction happens, so a test can prove a query string
 * never survives.
 */
export function buildErrorReport(
    kind: ClientErrorReport['kind'],
    error: unknown,
    context: { pathname: string; userAgent: string; uid: string | null; bundle: string | null },
): ClientErrorReport {
    const err = error instanceof Error ? error : null;
    // Same narrowing rule as everywhere else — see src/utils/errorText.ts.
    const raw = messageOf(error, 'Unknown error');

    return {
        kind,
        message: raw.slice(0, MAX_MESSAGE),
        stack: err?.stack ? err.stack.slice(0, MAX_STACK) : null,
        // pathname ONLY. `search` and `hash` are where ids and tokens end up.
        path: context.pathname.split('?')[0]!.split('#')[0]!,
        bundle: context.bundle,
        userAgent: context.userAgent.slice(0, 300),
        uid: context.uid,
    };
}

const seen = new Set<string>();
let sent = 0;

/** Test seam. Nothing else should need this. */
export function resetReportingForTests(): void {
    seen.clear();
    sent = 0;
}

/**
 * Should this report be written, or has it been said already?
 *
 * Pure so the caps are testable without a Firestore.
 */
export function shouldSend(signature: string): boolean {
    if (sent >= MAX_PER_SESSION) return false;
    if (seen.has(signature)) return false;
    seen.add(signature);
    sent += 1;
    return true;
}

/**
 * Fire-and-forget. NEVER throws, and never reports its own failure.
 *
 * A reporter that can throw turns one bug into two, and a reporter that reports
 * its own errors is an infinite loop that bills by the write.
 */
export async function reportClientError(
    kind: ClientErrorReport['kind'],
    error: unknown,
): Promise<void> {
    try {
        const report = buildErrorReport(kind, error, {
            pathname: window.location.pathname,
            userAgent: navigator.userAgent,
            uid: auth.currentUser?.uid ?? null,
            bundle: bundleOf(document),
        });

        if (!shouldSend(signatureOf(report))) return;

        await addDoc(collection(db, 'clientErrors'), {
            ...report,
            at: serverTimestamp(),
        });
    } catch {
        // Intentionally silent. See above.
    }
}

/**
 * Catch what an ErrorBoundary cannot: errors outside React's render tree, and
 * rejected promises nobody awaited. Those are most of what actually breaks in
 * production — a failed callable, a listener that throws — and before this they
 * vanished into a console nobody was reading.
 *
 * Returns a detach function; safe to call more than once.
 */
export function installGlobalErrorReporting(target: Window = window): () => void {
    const onError = (e: ErrorEvent) => { void reportClientError('window', e.error ?? e.message); };
    const onRejection = (e: PromiseRejectionEvent) => { void reportClientError('promise', e.reason); };

    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);

    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
}
