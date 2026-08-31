import React, { useState } from 'react';
import { Bell, CalendarDays, Clock, MapPin } from 'lucide-react';
import { SabhaCalendar } from './SabhaCalendar';
import { RideWindowControl } from './RideWindowControl';
import { LocationSettings } from './LocationSettings';
import { NotificationSettings } from './NotificationSettings';
import { Disclosure, type DisclosureProps } from '../shared/Disclosure';

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
 *
 * CHANGED 2026-08-18: Fleet and Raw records LEFT this page for the sidebar. What
 * remains is the three things that describe a sabha — when it is, when rides run,
 * and where it is. Fleet is an operational list touched most weeks, and the record
 * editor is a destructive tool; neither was configuration, and burying the
 * dangerous one in an accordion never made it safer, only harder to find. The
 * warning it carried moved with it, into components/manager/ManagerRecords.tsx.
 *
 * The `danger` treatment the row supported went with Raw records — it was the only
 * caller. Restore it from git if a genuinely destructive setting lands here.
 *
 * The row itself moved out on 2026-08-24, to components/shared/Disclosure.tsx, so
 * the notice board could open one notice at a time using the same thing rather
 * than a second accordion that would drift from this one.
 */

export const ManagerSetup: React.FC = () => {
    // One at a time. These are long forms; two open at once means scrolling past
    // one to reach the other, which is the pile this replaces.
    const [openId, setOpenId] = useState<string | null>(null);
    const toggle = (id: string) => setOpenId(current => (current === id ? null : id));

    const sections: (Omit<DisclosureProps, 'open' | 'onToggle'> & { id: string })[] = [
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
            id: 'notifications',
            icon: <Bell size={20} />,
            title: 'Notifications',
            summary: 'Which messages go out, and how often',
            // SABHA ONLY. The airport rows live on the Arrivals board, in the service
            // where somebody is already thinking about them — see the note in
            // NotificationSettings.tsx. `catalogueFor` decides the split, so neither
            // half can quietly lose an entry.
            children: <NotificationSettings service="sabha" />,
        },
        {
            id: 'venue',
            icon: <MapPin size={20} />,
            title: 'Venue',
            summary: 'Where drivers are routed to',
            children: <LocationSettings />,
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

            {sections.map(({ id, ...section }) => (
                <Disclosure
                    key={id}
                    {...section}
                    open={openId === id}
                    onToggle={() => toggle(id)}
                />
            ))}
        </div>
    );
};
