import React, { useState } from 'react';
import { Send, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { managerBroadcast } from '../../src/utils/cloudFunctions';
import { messageOf } from '../../src/utils/errorText';

const MAX = 200;

/**
 * One message to every phone in the congregation.
 *
 * The warning is not decoration. This is the only action in the app that reaches
 * everyone at once, it lands on lock screens, and it cannot be recalled. Every
 * other notification body in this app is written by code and reviewed; this one
 * is whatever a manager types, so the only place to say "be careful" is here.
 *
 * The server fixes the title and only accepts the body — a free-text title would
 * let a broadcast impersonate a system push.
 */
export const BroadcastComposer: React.FC = () => {
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const send = async () => {
        setSending(true);
        setError(null);
        try {
            await managerBroadcast(body.trim());
            setSent(true);
            setBody('');
        } catch (err) {
            setError(messageOf(err, 'Could not send the message.'));
        } finally {
            setSending(false);
        }
    };

    const tooLong = body.length > MAX;
    const empty = body.trim().length === 0;

    return (
        <div className="space-y-3">
            <div className="clay-card p-4 bg-[rgb(var(--warning-bg))] border border-[rgb(var(--warning))]/25">
                <p className="text-sm font-bold text-coffee flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0" /> This reaches everyone
                </p>
                <p className="text-xs text-coffee-700 mt-1">
                    It appears on the lock screen of every person who turned notifications on,
                    and it cannot be taken back. Please do not include anyone&apos;s name,
                    address or phone number.
                </p>
            </div>

            <label className="block">
                <span className="text-xs font-semibold text-coffee-700">Message</span>
                <textarea
                    value={body}
                    onChange={e => { setBody(e.target.value); setSent(false); }}
                    rows={3}
                    placeholder="No sabha this week — the hall is unavailable."
                    className="mt-1 w-full min-w-0 px-3 py-2 rounded-xl border-2 border-hairline/30 bg-surface text-sm text-coffee"
                />
            </label>

            <div className="flex items-center justify-between gap-3">
                <span className={`text-xs ${tooLong ? 'text-[rgb(var(--danger-text))]' : 'text-coffee-500'}`}>
                    {body.length} / {MAX}
                </span>
                <button
                    onClick={send}
                    disabled={sending || empty || tooLong}
                    className="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 bg-saffron text-white rounded-xl text-sm font-bold disabled:opacity-50 btn-feedback"
                >
                    {sending
                        ? <><Loader2 size={16} className="animate-spin" /> Sending…</>
                        : <><Send size={16} /> Send to everyone</>}
                </button>
            </div>

            {error && (
                <p className="text-xs text-[rgb(var(--danger-text))] flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
                </p>
            )}
            {sent && !error && (
                <p className="text-xs text-[rgb(var(--success-text))] flex items-center gap-2">
                    <CheckCircle2 size={14} className="shrink-0" /> Sent.
                </p>
            )}
        </div>
    );
};
