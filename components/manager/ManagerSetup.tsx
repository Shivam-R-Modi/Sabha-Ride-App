import React, { useState } from 'react';
import { CalendarDays, Clock, MapPin, Car, Database, ChevronDown, AlertTriangle } from 'lucide-react';
import { SabhaCalendar } from './SabhaCalendar';
import { RideWindowControl } from './RideWindowControl';
import { LocationSettings } from './LocationSettings';
import { FleetManagement } from './FleetManagement';
import { DatabaseConsole } from './DatabaseConsole';

/**
 * Everything a manager configures, as named sections rather than a pile.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Two toolbar icons and a modal. The 🚗 icon opened Fleet Management. The 📍
 * icon — a map pin, meaning "settings" — opened a modal that stacked the sabha
 * calendar, the ride window and the venue location into ONE scrolling column,
 * three unrelated jobs with nothing separating them. The Database Console was a
 * third peer tab alongside Friday-evening dispatch.
 *
 * Each section is collapsed by default and remembers nothing: these are things
 * you come here to change deliberately, so opening the page should show you the
 * menu, not the middle of a form.
 */

interface SectionProps {
    id: string;
    icon: React.ReactNode;
    title: string;
    summary: string;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    /** Draws the warning treatment and an explanation before the content. */
    danger?: string;
}

const Section: React.FC<SectionProps> = ({
    icon, title, summary, open, onToggle, children, danger,
}) => (
    <section className="clay-card p-0 overflow-hidden">
        <button
            onClick={onToggle}
            aria-expanded={open}
            className="w-full flex items-center gap-4 p-4 text-left min-h-11 hover:bg-cream-300/40
                       transition-colors"
        >
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
                ${danger
                    ? 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]'
                    : 'bg-cream-300 text-saffron'}`}>
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <h2 className="font-header font-bold text-coffee leading-tight">{title}</h2>
                <p className="text-xs text-coffee-500 mt-0.5">{summary}</p>
            </div>
            <ChevronDown
                size={20}
                aria-hidden="true"
                className={`text-coffee-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
        </button>

        {open && (
            <div className="border-t border-hairline/10 p-4 animate-in fade-in duration-150">
                {danger && (
                    <div className="flex items-start gap-3 mb-4 p-3 rounded-xl
                                    bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]">
                        <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-sm leading-snug">{danger}</p>
                    </div>
                )}
                {children}
            </div>
        )}
    </section>
);

export const ManagerSetup: React.FC = () => {
    // One at a time. These are long forms; two open at once means scrolling past
    // one to reach the other, which is the pile this replaces.
    const [openId, setOpenId] = useState<string | null>(null);
    const toggle = (id: string) => setOpenId(current => (current === id ? null : id));

    const sections: Omit<SectionProps, 'open' | 'onToggle'>[] = [
        {
            id: 'calendar',
            icon: <CalendarDays size={20} />,
            title: 'Sabha calendar',
            summary: 'Move a sabha, cancel one, or add a one-off',
            children: <SabhaCalendar />,
        },
        {
            id: 'window',
            icon: <Clock size={20} />,
            title: 'Ride window',
            summary: 'When riders can request, and when drop-off opens',
            children: <RideWindowControl />,
        },
        {
            id: 'venue',
            icon: <MapPin size={20} />,
            title: 'Venue',
            summary: 'Where drivers are routed to',
            children: <LocationSettings />,
        },
        {
            id: 'fleet',
            icon: <Car size={20} />,
            title: 'Fleet',
            summary: 'The cars drivers can take out',
            children: <FleetManagement />,
        },
        {
            id: 'database',
            icon: <Database size={20} />,
            title: 'Raw records',
            summary: 'Advanced — edit documents directly',
            danger:
                'These are the live records, edited without any of the checks the rest of the ' +
                'app applies. They include riders’ names, phone numbers and home addresses. ' +
                'There is no undo.',
            children: <DatabaseConsole />,
        },
    ];

    return (
        <div className="px-4 pt-6 pb-6 space-y-4 max-w-3xl mx-auto animate-in fade-in duration-300">
            <header>
                <h1 className="text-2xl font-header font-bold text-coffee">Setup</h1>
                <p className="text-sm text-coffee-500">
                    Everything that shapes how rides run.
                </p>
            </header>

            {sections.map(section => (
                <Section
                    key={section.id}
                    {...section}
                    open={openId === section.id}
                    onToggle={() => toggle(section.id)}
                />
            ))}
        </div>
    );
};
