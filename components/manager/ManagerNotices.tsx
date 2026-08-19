import React from 'react';
import { Megaphone, StickyNote, Eye } from 'lucide-react';
import { NoticeComposer } from './NoticeComposer';
import { BroadcastComposer } from './BroadcastComposer';
import { NoticeBoard } from '../shared/NoticeBoard';

/**
 * The two ways a manager says something to the congregation.
 *
 * They are deliberately side by side, because the choice between them is the
 * point: a NOTICE stays somewhere people can look, a BROADCAST interrupts them
 * once and leaves no trace. Putting them on separate screens would hide that
 * choice and the broadcast would get used for everything.
 */
const Panel: React.FC<{
    icon: React.ReactNode;
    title: string;
    summary: string;
    children: React.ReactNode;
}> = ({ icon, title, summary, children }) => (
    <section className="clay-card p-4">
        <div className="flex items-start gap-3 mb-4">
            <div className="w-11 h-11 shrink-0 rounded-2xl bg-cream-300 text-saffron flex items-center justify-center">
                {icon}
            </div>
            <div className="min-w-0">
                <h2 className="font-header font-bold text-coffee">{title}</h2>
                <p className="text-xs text-coffee-500">{summary}</p>
            </div>
        </div>
        {children}
    </section>
);

export const ManagerNotices: React.FC = () => (
    <div className="px-4 pt-6 pb-6 space-y-4 max-w-3xl mx-auto animate-in fade-in duration-300">
        <header>
            <h1 className="text-2xl font-header font-bold text-coffee">Notices</h1>
            <p className="text-sm text-coffee-500">
                Put something on everyone's dashboard, or send a one-off message.
            </p>
        </header>

        <Panel
            icon={<StickyNote size={20} />}
            title="Notice board"
            summary="Stays on every dashboard until its date passes"
        >
            <NoticeComposer />
        </Panel>

        <Panel
            icon={<Megaphone size={20} />}
            title="Send a message"
            summary="Interrupts everyone once. Nothing is kept"
        >
            <BroadcastComposer />
        </Panel>

        {/* The same component every rider and Sarthi renders, not a mock-up of it.
            A preview that drifts from the real thing is worse than none.

            It is here as well as on the manager dashboard because the dashboard
            cannot be relied on for this: managers land on the Waiting tab, and the
            board lives in the OTHER tab's scroll region — the Waiting tab is a
            fixed-height queue that anything above would shrink. This is the one
            place the answer is always available, next to the box that writes it. */}
        <Panel
            icon={<Eye size={20} />}
            title="What everyone sees"
            summary="The board as it looks on a rider's or Sarthi's dashboard"
        >
            <NoticeBoard
                whenEmpty={
                    <p className="text-sm text-coffee-500 italic">
                        Nothing on the board right now. Post a notice above, or set this
                        week's agenda in Setup → Sabha Calendar.
                    </p>
                }
            />
        </Panel>
    </div>
);
