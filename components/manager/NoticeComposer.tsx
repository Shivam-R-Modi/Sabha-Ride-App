import React, { useRef, useState } from 'react';
import { Send, Loader2, AlertCircle, ImagePlus, Trash2, X } from 'lucide-react';
import { publishNotice, deleteNotice } from '../../src/utils/cloudFunctions';
import { describeImageProblem, uploadNoticeImage } from '../../src/utils/noticeImage';
import { messageOf } from '../../src/utils/errorText';
import { useNotices } from '../../hooks/useNotices';
import { NOTICE_TITLE_MAX, noticeHeading } from '../../src/utils/notice';
import { useConfirm } from '../shared/useConfirm';
import { useToast } from '../../contexts/ToastContext';

const MAX = 4000;

/**
 * Write a notice, and take one down.
 *
 * The body is plain text — line breaks and emoji are the formatting, and they are
 * preserved end to end. Nothing here is parsed as markup; see NoticeBoard.
 *
 * THE TITLE IS REQUIRED, added 2026-08-24 with the collapsed board. Every notice
 * is a row showing its title now, so a notice without one has nothing to be a row
 * of. It was tempting to derive the row from the body's first line and ask for
 * nothing — the placeholder below has always taught that shape, and both notices
 * live at the time did follow it — but a body written as one paragraph has no
 * first line to speak of, and the row would then show a sentence sliced at 80
 * characters. `noticeHeading` still does exactly that for those two, because they
 * cannot be asked for a title retrospectively.
 *
 * Removal goes through `useConfirm`, not `window.confirm`, which is banned in
 * this repo: a suppressed dialog returns false, so every destructive button
 * silently did nothing.
 */
export const NoticeComposer: React.FC = () => {
    const { notices } = useNotices();
    const { ask, confirmDialog } = useConfirm();
    const { success, error: toastError } = useToast();

    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [showUntil, setShowUntil] = useState('');
    const [push, setPush] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const pickFile = (chosen: File | undefined) => {
        setError(null);
        if (!chosen) return setFile(null);
        const problem = describeImageProblem(chosen);
        if (problem) {
            // Checked here for a readable message; storage.rules enforces it.
            setError(problem);
            setFile(null);
            return;
        }
        setFile(chosen);
    };

    const publish = async () => {
        setBusy(true);
        setError(null);
        try {
            const image = file ? await uploadNoticeImage(file) : { imagePath: null, imageUrl: null };
            await publishNotice({
                title: title.trim(), body: body.trim(), ...image,
                showUntil: showUntil || null, push,
            });
            setTitle(''); setBody(''); setShowUntil(''); setPush(false); setFile(null);
            if (fileInput.current) fileInput.current.value = '';
            success('Notice posted.');
        } catch (err) {
            setError(messageOf(err, 'Could not post the notice.'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id: string) => {
        const yes = await ask({
            title: 'Remove this notice?',
            message: 'It disappears from every dashboard, and its image is deleted.',
            confirmLabel: 'Remove',
            destructive: true,
        });
        if (!yes) return;
        try {
            await deleteNotice(id);
            success('Notice removed.');
        } catch (err) {
            toastError(messageOf(err, 'Could not remove the notice.'));
        }
    };

    const tooLong = body.length > MAX;
    const titleTooLong = title.length > NOTICE_TITLE_MAX;
    // Both fields gate the button, and the counters below say which one is over.
    // A disabled button with nothing explaining it is the dead control this repo
    // keeps removing.
    const empty = body.trim().length === 0 || title.trim().length === 0;

    return (
        <div className="space-y-4">
            <label className="block">
                <span className="text-xs font-semibold text-coffee-700">Title</span>
                <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Sabha this week"
                    className="mt-1 w-full min-w-0 px-3 py-2 rounded-xl border-2 border-hairline/30 bg-surface text-sm text-coffee"
                />
                {/* Says what it is FOR, not just what it is. A manager cannot see
                    the rider's board from here. */}
                <span className="text-xs text-coffee-500">
                    Shown on the board when the notice is closed. Everything below is
                    hidden until someone opens it.
                </span>
            </label>

            <label className="block">
                <span className="text-xs font-semibold text-coffee-700">Notice</span>
                <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={8}
                    placeholder={'✨ Simple Yet Supreme ✨\n\nWrite it exactly as you want it read.\nLine breaks and emoji are kept.'}
                    className="mt-1 w-full min-w-0 px-3 py-2 rounded-xl border-2 border-hairline/30 bg-surface text-sm text-coffee"
                />
            </label>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={() => fileInput.current?.click()}
                    className="shrink-0 whitespace-nowrap flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-hairline/30 text-coffee-700 text-sm font-bold btn-feedback"
                >
                    <ImagePlus size={16} /> {file ? 'Change image' : 'Add an image'}
                </button>
                {file && (
                    <span className="text-xs text-coffee-500 flex items-center gap-2 min-w-0">
                        <span className="truncate">{file.name}</span>
                        <button onClick={() => pickFile(undefined)} aria-label="Remove image" className="shrink-0">
                            <X size={14} />
                        </button>
                    </span>
                )}
                <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    onChange={e => pickFile(e.target.files?.[0])}
                    className="sr-only"
                />
            </div>

            <label className="block">
                <span className="text-xs font-semibold text-coffee-700">Show until</span>
                <input
                    type="date"
                    value={showUntil}
                    onChange={e => setShowUntil(e.target.value)}
                    className="mt-1 w-full min-w-0 px-3 py-2 rounded-xl border-2 border-hairline/30 bg-surface text-sm text-coffee"
                />
                {/* Says what actually happens, because it is not reversible. */}
                <span className="text-xs text-coffee-500">
                    After this day the notice and its image are deleted. Leave it blank to keep it
                    until you remove it.
                </span>
            </label>

            <label className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={push}
                    onChange={e => setPush(e.target.checked)}
                    className="mt-1 w-5 h-5 shrink-0"
                />
                <span className="text-xs text-coffee-700">
                    Also send a notification. It goes to everyone who turned notifications on and
                    counts towards the daily broadcast limit.
                </span>
            </label>

            <div className="flex items-center justify-between gap-3">
                <span className={`text-xs ${tooLong || titleTooLong ? 'text-[rgb(var(--danger-text))]' : 'text-coffee-500'}`}>
                    Title {title.length} / {NOTICE_TITLE_MAX} · {body.length} / {MAX}
                </span>
                <button
                    onClick={publish}
                    disabled={busy || empty || tooLong || titleTooLong}
                    className="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 bg-saffron text-white rounded-xl text-sm font-bold disabled:opacity-50 btn-feedback"
                >
                    {busy ? <><Loader2 size={16} className="animate-spin" /> Posting…</> : <><Send size={16} /> Post notice</>}
                </button>
            </div>

            {error && (
                <p className="text-xs text-[rgb(var(--danger-text))] flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
                </p>
            )}

            {notices.length > 0 && (
                <div className="pt-2 space-y-2">
                    <h3 className="text-xs font-bold text-coffee-500 uppercase tracking-wider">On the board now</h3>
                    {notices.map(notice => (
                        <div key={notice.id} className="clay-card p-3 flex items-start gap-3">
                            {/* The heading, not three clamped lines of body — this
                                list answers "what does everyone see right now?",
                                and what they see is the collapsed row. */}
                            <p className="text-xs font-bold text-coffee-700 flex-1 min-w-0 truncate">
                                {noticeHeading(notice)}
                            </p>
                            <button
                                onClick={() => remove(notice.id)}
                                aria-label="Remove notice"
                                className="shrink-0 p-2 text-coffee-500 hover:text-[rgb(var(--danger-text))]"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {confirmDialog}
        </div>
    );
};
