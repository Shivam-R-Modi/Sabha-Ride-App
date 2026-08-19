import React, { useState } from 'react';
import { useNotices } from '../../hooks/useNotices';
import type { Notice } from '../../types';

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
        <article className="clay-card-notice p-4 text-left">
            {notice.imageUrl && !imageFailed && (
                <img
                    src={notice.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setImageFailed(true)}
                    className="w-full rounded-2xl mb-3 object-cover max-h-72"
                />
            )}
            <p className="text-sm text-coffee-700 whitespace-pre-line leading-relaxed">
                {notice.body}
            </p>
        </article>
    );
};

export const NoticeBoard: React.FC = () => {
    const { notices, loading } = useNotices();

    if (loading || notices.length === 0) return null;

    return (
        <section className="space-y-3" aria-label="Notices">
            {notices.map(notice => <NoticeCard key={notice.id} notice={notice} />)}
        </section>
    );
};
