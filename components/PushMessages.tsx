import { useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { onForegroundMessage } from '../src/utils/pushClient';

/**
 * Push that arrives while the app is open.
 *
 * FCM suppresses the system notification when the tab is focused, so without
 * this a Sarthi looking at the route screen never learns a new assignment
 * landed — the message is delivered and silently dropped.
 *
 * Routed to a toast rather than raising an OS banner over an app the user is
 * already reading. The toast is `aria-live` and does not steal focus, and a
 * second banner from a focused page is redundant — some browsers drop it anyway.
 *
 * Renders nothing. It exists for the subscription.
 */
export const PushMessages: React.FC = () => {
    const { info } = useToast();

    useEffect(() => {
        let stop: (() => void) | undefined;
        let cancelled = false;

        // The unsubscriber matters: React.StrictMode double-invokes effects in
        // development, so without it every message would appear twice.
        onForegroundMessage(({ title, body }) => {
            info(body ? `${title} — ${body}` : title);
        }).then(unsubscribe => {
            if (cancelled) unsubscribe();
            else stop = unsubscribe;
        }).catch(() => {
            // Push being unavailable is not an error worth showing anyone.
        });

        return () => { cancelled = true; stop?.(); };
    }, [info]);

    return null;
};
