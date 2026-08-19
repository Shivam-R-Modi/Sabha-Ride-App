import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useNotices } from '../../hooks/useNotices';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { isLongForCard } from '../../src/utils/agenda';
import type { Notice } from '../../types';

/**
 * Long text in a dashboard card, collapsed until asked for.
 *
 * A full agenda runs to 2000 characters. Rendered whole it filled a phone and
 * pushed the thing each dashboard exists FOR below the fold — the rider's request
 * button, the Sarthi's "go on shift". Shipped that way once; the screenshots made
 * it obvious.
 *
 * The clamp and the button come from ONE call to `isLongForCard`, so text can
 * never be clipped without a control to open it. That is the failure mode worth
 * designing against here: silently truncated text reads as the notice itself being
 * short, and nobody goes looking for the rest.
 */
const LongText: React.FC<{ text: string }> = ({ text }) => {
    const [open, setOpen] = useState(false);
    const collapsible = isLongForCard(text);

    return (
        <>
            {/* `whitespace-pre-line` is what keeps the flyer's line breaks; the
                clamp counts rendered lines, so the two work together. */}
            <p
                className={`text-sm text-coffee-700 whitespace-pre-line leading-relaxed${
                    collapsible && !open ? ' line-clamp-6' : ''
                }`}
            >
                {text}
            </p>
            {collapsible && (
                <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    aria-expanded={open}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-saffron-800 min-h-11"
                >
                    {open ? 'Show less' : 'Read more'}
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            )}
        </>
    );
};

/**
 * Manager-authored notices, on every dashboard.
 *
 * The body is rendered as PLAIN TEXT with `whitespace-pre-line`. It is never
 * parsed as markdown or HTML: nothing in this app renders authored content as
 * markup, `dangerouslySetInnerHTML` appears nowhere, and a manager-typed flyer on
 * every family's dashboard is the last place to introduce that. Emoji and line
 * breaks carry the formatting, which is what the real notices use anyway.
 *
 * Renders NOTHING when there is nothing to say — an empty panel headed "Notices"
 * is furniture.
 */
const NoticeCard: React.FC<{ notice: Notice }> = ({ notice }) => {
    // No <img> in this app had an onError before this one. A notice image is
    // remote and sits on every dashboard, so a broken one would be a visible
    // failure with no explanation — the shape this repo keeps removing. On error
    // the image is dropped and the words remain, which is the part that matters.
    const [imageFailed, setImageFailed] = useState(false);

    return (
        <article className="clay-card p-4 text-left">
            {notice.imageUrl && !imageFailed && (
                <img
                    src={notice.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setImageFailed(true)}
                    className="w-full rounded-2xl mb-3 object-cover max-h-72"
                />
            )}
            <LongText text={notice.body} />
        </article>
    );
};

/**
 * The upcoming sabha's agenda.
 *
 * This is the last mile of a pipeline that was already complete and went
 * nowhere: a manager types an agenda in the Sabha Calendar, `editOccurrence`
 * writes it to `events/{date}`, the recurrence resolver carries it,
 * `updateRideTypeContext` publishes it onto `system/rideContext`, and
 * `useCurrentEvent` reads it — and then no component in the app rendered it. So
 * the field existed, was carried correctly through four layers, and was invisible
 * to every rider and Sarthi. Exactly the failure this repo keeps removing.
 *
 * It sits in the notice board rather than in a panel of its own so there is ONE
 * place people look for "what is happening", which was the point of the board.
 * Labelled, because an agenda is not a notice: it belongs to a specific sabha and
 * changes every week.
 */
const AgendaCard: React.FC<{ agenda: string }> = ({ agenda }) => (
    <article className="clay-card p-4 text-left">
        <p className="text-[10px] font-bold uppercase tracking-wider text-saffron-800 mb-1.5">
            Sabha agenda
        </p>
        {/* Plain text, same as a notice body. Line breaks survive; markup does not
            exist here. */}
        <LongText text={agenda} />
    </article>
);

export const NoticeBoard: React.FC<{
    /**
     * Rendered instead of nothing when the board is empty.
     *
     * Dashboards pass nothing, so they keep rendering `null` — an empty panel
     * headed "Notices" is furniture. The manager's own Notices tab passes a line,
     * because there the emptiness is the answer to a question they just asked
     * ("what does everyone see right now?") rather than a gap on their homepage.
     */
    whenEmpty?: React.ReactNode;
}> = ({ whenEmpty }) => {
    const { notices, loading } = useNotices();
    const { event, loading: eventLoading } = useCurrentEvent();

    // `rideContext` carries the agenda of the sabha the app is working towards, so
    // this rolls over on its own once an evening is past — no stale agenda sits
    // here waiting for the nightly sweep to clear the document.
    const agenda = (event?.agenda ?? '').trim();

    const showNotices = !loading && notices.length > 0;
    const showAgenda = !eventLoading && agenda !== '';

    // Nothing to say renders nothing. An empty panel headed "Notices" is
    // furniture, and that judgement has to survive the agenda being added — an
    // agenda-only week and a notices-only week both have to work.
    if (!showNotices && !showAgenda) return <>{whenEmpty ?? null}</>;

    return (
        <section className="space-y-3" aria-label="Notices and sabha agenda">
            {showAgenda && <AgendaCard agenda={agenda} />}
            {showNotices && notices.map(notice => <NoticeCard key={notice.id} notice={notice} />)}
        </section>
    );
};
