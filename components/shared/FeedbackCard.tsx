import React, { useState } from 'react';
import { MessageSquare, Loader2, Check, Star } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { MAX_FEEDBACK, RATINGS, feedbackDocId } from '../../src/utils/feedback';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../../src/constants/tenancy';
import { codeOf, messageOf } from '../../src/utils/errorText';

/**
 * Telling the owner what you think of the app.
 *
 * Lives in ProfileEditor for the same reason ThemeToggle, InstallAppButton and
 * PushToggle do: Profile is the one destination all three roles share, so putting
 * it there gives every rider, Sarthi and manager the same route with no per-role
 * wiring at all.
 *
 * NOT ANONYMOUS, AND IT SAYS SO
 * -----------------------------
 * Named was the owner's decision, and the form states it above the box rather
 * than in a tooltip. Collecting a complaint about a named volunteer from an
 * unidentifiable source is worse than collecting nothing, and somebody who would
 * rather not be identified deserves to know before they type, not after.
 *
 * The name is NOT stored on the document. It is resolved from `users/{uid}` when a
 * manager reads it — a client-supplied name is unverifiable, and a forged one on a
 * complaint would send a manager to the wrong person. `uid` is the authoritative
 * key and firestore.rules pins it to the caller.
 *
 * ONE PER DAY, AND THE REFUSAL HAS TO READ LIKE A SENTENCE
 * -------------------------------------------------------
 * The document id is `{uid}_{today}` and the rules deny `update`, so a second
 * submission the same day is refused by the database. That is deliberate — see
 * src/utils/feedback.ts — and it makes the error path the part worth care:
 * Firestore returns `permission-denied`, which shown raw reads as "the app is
 * broken" to somebody who simply already sent something today. It is translated
 * below.
 */
export const FeedbackCard: React.FC = () => {
    const { currentUser } = useAuth();
    const [open, setOpen] = useState(false);
    const [rating, setRating] = useState<number | null>(null);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = comment.trim();
    const canSend = !!currentUser && rating !== null && trimmed.length > 0 && !busy;

    const send = async () => {
        if (!canSend || !currentUser) return;
        setBusy(true);
        setError(null);
        try {
            // Local calendar day, matching what the person would call "today".
            const today = new Date().toLocaleDateString('en-CA');
            await setDoc(
                doc(db, 'feedback', feedbackDocId(currentUser.uid, today)),
                {
                    uid: currentUser.uid,
                    rating,
                    comment: trimmed.slice(0, MAX_FEEDBACK),
                    createdAt: new Date().toISOString(),
                    cityId: FOUNDING_CITY_ID,
                    locationId: FOUNDING_LOCATION_ID,
                },
            );
            setSent(true);
        } catch (err: unknown) {
            // The expected refusal, not a fault. `permission-denied` here almost
            // always means the one-per-day document already exists.
            setError(codeOf(err) === 'permission-denied'
                ? 'You have already sent feedback today. Thank you — please come back tomorrow if there is more.'
                : messageOf(err, 'Could not send your feedback. Please try again.'));
        } finally {
            setBusy(false);
        }
    };

    if (sent) {
        return (
            <div className="clay-card p-4 text-left flex items-center gap-4">
                <div className="bg-[rgb(var(--success-bg))] p-2 rounded-xl text-[rgb(var(--success-text))] shrink-0">
                    <Check size={20} />
                </div>
                <div className="min-w-0">
                    <p className="font-bold text-coffee text-sm">Thank you</p>
                    <p className="text-xs text-coffee-500">Your feedback has been sent to the seva team.</p>
                </div>
            </div>
        );
    }

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="clay-card w-full flex items-center gap-4 text-left p-4 btn-feedback"
            >
                <div className="bg-cream-300 p-2 rounded-xl text-saffron-800 shrink-0">
                    <MessageSquare size={20} />
                </div>
                <div className="min-w-0">
                    <p className="font-bold text-coffee text-sm">Give feedback</p>
                    <p className="text-xs text-coffee-500">Tell the seva team what is working and what is not.</p>
                </div>
            </button>
        );
    }

    return (
        <div className="clay-card p-4 text-left space-y-3">
            <div className="flex items-center gap-3">
                <div className="bg-cream-300 p-2 rounded-xl text-saffron-800 shrink-0">
                    <MessageSquare size={20} />
                </div>
                <p className="font-bold text-coffee text-sm">Give feedback</p>
            </div>

            {/* Above the box, deliberately. Somebody who would rather not be
                identified needs to know before they type, not after they send.
                `coffee-700` rather than the `coffee-500` used for the other
                subtitles on this screen: this is the one line on the card a
                person most needs to actually read, so it is not also the faintest
                text on it. Measured against what actually paints behind it —
                `clay-card` is semi-transparent, so that is the page — 8.10:1 in
                light and 10.21:1 in dark. */}
            <p className="text-xs text-coffee-700">
                Sent with your name, so the seva team can follow up with you.
            </p>

            {/* A radiogroup with sr-only radios, the same shape ThemeToggle uses:
                keyboard-reachable and announced, which `display: none` would not
                be. */}
            <fieldset>
                <legend className="text-xs font-bold text-coffee-700 mb-1.5">How is the app working for you?</legend>
                <div role="radiogroup" aria-label="Rating" className="flex gap-1">
                    {RATINGS.map(value => {
                        const chosen = rating !== null && value <= rating;
                        return (
                            <label
                                key={value}
                                title={`${value} out of 5`}
                                className={`flex-1 flex items-center justify-center min-h-11 rounded-xl cursor-pointer transition-colors ${chosen ? 'bg-cream-400 text-saffron-800' : 'bg-cream-300 text-coffee-500 hover:text-coffee'
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="feedback-rating"
                                    value={value}
                                    checked={rating === value}
                                    onChange={() => { setRating(value); setError(null); }}
                                    className="sr-only"
                                    aria-label={`${value} out of 5`}
                                />
                                <Star size={18} aria-hidden="true" />
                            </label>
                        );
                    })}
                </div>
            </fieldset>

            <div>
                <textarea
                    value={comment}
                    onChange={(e) => { setComment(e.target.value); setError(null); }}
                    placeholder="What would you change?"
                    rows={4}
                    maxLength={MAX_FEEDBACK}
                    aria-label="Your feedback"
                    className="w-full px-3 py-2 rounded-xl border border-hairline/20 text-sm leading-relaxed resize-y focus:outline-none focus:border-saffron bg-surface text-coffee"
                />
                <p className="text-[10px] text-coffee-500 mt-0.5">
                    {trimmed.length}/{MAX_FEEDBACK}
                </p>
            </div>

            {error && (
                <p className="text-xs font-semibold text-[rgb(var(--danger-text))]">{error}</p>
            )}

            <div className="flex gap-2">
                <button
                    onClick={send}
                    disabled={!canSend}
                    className="flex-1 clay-button-secondary !text-saffron-800 disabled:opacity-50"
                >
                    {busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : 'Send feedback'}
                </button>
                <button
                    onClick={() => { setOpen(false); setError(null); }}
                    disabled={busy}
                    className="px-4 min-h-11 rounded-full text-xs font-bold text-coffee-500 hover:text-coffee hover:bg-cream-300 transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};
