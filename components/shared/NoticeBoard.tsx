import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useNotices } from '../../hooks/useNotices';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import { isLongForCard } from '../../src/utils/agenda';
import { noticeHeading } from '../../src/utils/notice';
import { pruneSeenNotices, readSeenNotices, writeSeenNotices } from '../../src/utils/seenNotices';
import { formatDate } from '../../src/utils/formatters';
import { Disclosure } from './Disclosure';
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
 *
 * THE AGENDA IS NOW ITS ONLY CALLER. Notices are collapsed rows, and the row IS
 * the disclosure — a "Read more" inside an opened notice would be a second one,
 * two controls deep, for the same text.
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
 * The sabha agenda, as a plain always-open card.
 *
 * It keeps this shape while notices became rows because it is not a notice: it has
 * no title to put on a row, there is only ever one of it, and it describes the
 * evening people are about to attend — which is worth reading without being asked
 * for. Collapsing a single unnamed thing behind a chevron would hide it for no gain.
 *
 * The agenda used to carry a "SABHA AGENDA" label and its own component. Both are
 * gone at the owner's request: the flyer text already says what it is, so the
 * label was repeating the content.
 */
const BoardCard: React.FC<{ text: string }> = ({ text }) => (
    <article className="clay-card p-4 text-left">
        <LongText text={text} />
    </article>
);

/**
 * One notice, as a row that opens.
 *
 * Collapsed it shows its heading and the day it was posted — never the body. That
 * is the whole point: a stack of full notices is the wall of text this replaced,
 * and a truncated body as a heading reads as though the notice were that short.
 *
 * The image lives INSIDE the panel, so a text-only notice renders no `<img>` at
 * all and a flyer costs nothing until someone opens it. `loading="lazy"` stays
 * anyway, for the case where several are opened in a session.
 */
const NoticeRow: React.FC<{
    notice: Notice;
    open: boolean;
    unseen: boolean;
    onToggle: () => void;
}> = ({ notice, open, unseen, onToggle }) => {
    // No <img> in this app had an onError before this one. A notice image is
    // remote, so a broken one would be a visible failure with no explanation —
    // the shape this repo keeps removing. On error the image is dropped and the
    // words remain, which is the part that matters.
    const [imageFailed, setImageFailed] = useState(false);

    return (
        <Disclosure
            title={noticeHeading(notice)}
            summary={postedOn(notice.createdAt)}
            trailing={unseen ? <NewBadge /> : undefined}
            open={open}
            onToggle={onToggle}
        >
            {notice.imageUrl && !imageFailed && (
                <img
                    src={notice.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setImageFailed(true)}
                    // FULL WIDTH, NATURAL HEIGHT, NO CEILING. A notice image is
                    // the message, not decoration, so it is shown entire.
                    //
                    // It used to be a cover fit under a 288px ceiling: capped, then
                    // cut to fill, so a flyer lost its edges and a portrait photo
                    // lost its top and bottom with nothing on screen to say
                    // anything was missing. It then briefly had a 70vh ceiling with
                    // a contain fit, which never cropped but did shrink a tall
                    // flyer below the size it was sent at. The owner's call was to
                    // drop the ceiling as well and show the image at full size.
                    //
                    // No object-fit is set here at all, deliberately: with no
                    // height constraint the box already IS the image's aspect
                    // ratio, so there is nothing to fit, and an inert utility would
                    // read as though something were being handled.
                    //
                    // THE UTILITY NAMES ARE SPELLED OUT IN PROSE ABOVE, NOT AS
                    // CLASSES, and that is not fussiness. Tailwind scans this file
                    // as plain TEXT, comments included, so naming a utility here
                    // re-emits its rule into the shipped stylesheet — the same trap
                    // recorded at DatabaseConsole.tsx. Writing the three superseded
                    // ones literally added three dead rules to the bundle for
                    // classes nothing renders, which is precisely how a reverted
                    // decision quietly comes back. What keeps cropping away is the
                    // assertions in tests/quality/notice-card-plain.test.ts, which
                    // strip comments before matching.
                    //
                    // The accepted consequence: a very tall flyer makes for a long
                    // scroll inside the opened row.
                    className="w-full h-auto rounded-2xl mb-3"
                />
            )}
            {/* No clamp and no "Read more" here. Opening the row was the ask. */}
            <p className="text-sm text-coffee-700 whitespace-pre-line leading-relaxed">
                {notice.body}
            </p>
        </Disclosure>
    );
};

/**
 * Unopened, on this device.
 *
 * `--accent-tint-badge-1` is the token pair that exists for exactly this, already
 * used this way by the sabha calendar. A saturated fill would compete with the
 * primary action the board now sits below.
 */
const NewBadge: React.FC = () => (
    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider
                     bg-[rgb(var(--accent-tint-badge-1))] text-saffron-800 px-2 py-1 rounded-lg">
        New
    </span>
);

/**
 * `createdAt` is written server-side as an ISO string and has been since the
 * feature shipped — but this renders on every dashboard, and `parseISO('')`
 * followed by `format` throws a RangeError rather than returning anything. One
 * malformed document would blank a rider's home screen. The date is the least
 * important thing on the row, so it is the thing that gives way.
 */
function postedOn(createdAt: string | undefined): string | undefined {
    if (!createdAt) return undefined;
    try {
        return formatDate(createdAt);
    } catch {
        return undefined;
    }
}

/**
 * Manager-authored notices and the upcoming sabha's agenda, on the rider's and
 * Sarthi's dashboards and in the manager's Notices tab.
 *
 * THE AGENDA'S LAST MILE. A manager types it in the Sabha Calendar,
 * `editOccurrence` writes it to `events/{date}`, the recurrence resolver carries
 * it, `updateRideTypeContext` publishes it onto `system/rideContext`, and
 * `useCurrentEvent` reads it — and before this nothing rendered it. Four layers of
 * correct plumbing to a screen that did not exist, so a manager could write an
 * agenda no rider or Sarthi could ever see.
 *
 * It is rendered here rather than in a panel of its own so there is ONE place
 * people look for what is happening, which was the point of the board.
 *
 * ONE OPEN AT A TIME, and that is why `openId` lives here rather than a boolean
 * inside each row: with a single value there is no state to synchronise and no way
 * for two rows to disagree about being open. Opening the second one closes the
 * first because there is only one slot to be in.
 */
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

    const [openId, setOpenId] = useState<string | null>(null);
    const [seen, setSeen] = useState<string[]>(() => readSeenNotices());

    // `rideContext` carries the agenda of the sabha the app is working towards, so
    // this rolls over on its own once an evening is past — no stale agenda sits
    // here waiting for the nightly sweep to clear the document.
    const agenda = (event?.agenda ?? '').trim();

    const showNotices = !loading && notices.length > 0;
    const showAgenda = !eventLoading && agenda !== '';

    /**
     * `seen` is the one source of truth and storage MIRRORS it, rather than each
     * caller writing its own idea of the list.
     *
     * The first version had every update read the current `seen`, append, and
     * write — and dropped a mark. Opening two rows before React re-rendered gave
     * the second handler the same stale array the first one saw, so it wrote
     * `['n2']` over `['n1']` and the first notice went back to being New. Found in
     * the browser, not by a test: the unit tests click, assert, click, and React
     * re-renders in between every time.
     *
     * Both updaters below return `prev` UNCHANGED when nothing moved, so the
     * reference is the change signal — which is what lets the mirror skip the
     * write of the value it just read on mount, and what stops the prune effect
     * looping on its own output.
     */
    const written = useRef(seen);
    useEffect(() => {
        if (written.current === seen) return;
        written.current = seen;
        writeSeenNotices(seen);
    }, [seen]);

    // Drop the ids of notices that no longer exist. Expired ones are deleted
    // server-side, so without this the key grows for the life of the install and
    // never shrinks.
    useEffect(() => {
        if (loading) return;
        const live = notices.map(n => n.id);
        setSeen(prev => {
            const pruned = pruneSeenNotices(prev, live);
            return pruned.length === prev.length ? prev : pruned;
        });
    }, [loading, notices]);

    const toggle = (notice: Notice) => {
        const opening = openId !== notice.id;
        setOpenId(opening ? notice.id : null);
        if (!opening) return;
        // Marked on OPEN, not on close and not on a timer: the badge answers
        // "have I looked at this", and the answer becomes yes the moment it is
        // on screen.
        setSeen(prev => (prev.includes(notice.id) ? prev : [...prev, notice.id]));
    };

    // Nothing to say renders nothing. An empty panel headed "Notices" is
    // furniture, and that judgement has to survive the agenda being added — an
    // agenda-only week and a notices-only week both have to work. It is also why
    // the "Notices" heading below lives in HERE and not in the dashboards: placed
    // there it would render on the empty weeks this guard exists to keep quiet.
    if (!showNotices && !showAgenda) return <>{whenEmpty ?? null}</>;

    return (
        <section className="space-y-3" aria-label="Notices and sabha agenda">
            {/* Agenda first: it belongs to the evening people are about to attend. */}
            {showAgenda && <BoardCard text={agenda} />}
            {showNotices && (
                <>
                    <h2 className="text-xs font-bold text-coffee-500 uppercase tracking-widest">
                        Notices
                    </h2>
                    {notices.map(notice => (
                        <NoticeRow
                            key={notice.id}
                            notice={notice}
                            open={openId === notice.id}
                            unseen={!seen.includes(notice.id)}
                            onToggle={() => toggle(notice)}
                        />
                    ))}
                </>
            )}
        </section>
    );
};
