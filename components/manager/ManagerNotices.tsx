import React from 'react';
import { Megaphone, StickyNote } from 'lucide-react';
import { NoticeComposer } from './NoticeComposer';
import { BroadcastComposer } from './BroadcastComposer';

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
    </div>
);
