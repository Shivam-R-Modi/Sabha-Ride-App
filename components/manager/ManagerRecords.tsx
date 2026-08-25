import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { DatabaseConsole } from './DatabaseConsole';
import { MemberExportCard } from './MemberExportCard';

/**
 * The raw record editor, and the warning that has to travel with it.
 *
 * WHY THIS FILE EXISTS RATHER THAN ROUTING STRAIGHT TO DatabaseConsole
 * -------------------------------------------------------------------
 * Two things were attached to this tool by its old home — a collapsed row inside
 * Setup's accordion — and both would have been lost by promoting the console to a
 * nav destination on its own:
 *
 * 1. THE WARNING. Setup rendered a `danger` note above the content: these are the
 *    live records, edited without any of the checks the rest of the app applies,
 *    including riders' names, phone numbers and home addresses, with no undo.
 *    That is a warning at a trust boundary for children's personal data, so it
 *    does not get dropped because the layout changed — it gets more prominent,
 *    since a nav item is far easier to reach by accident than an accordion.
 *
 * 2. THE PADDING. DatabaseConsole's root is `space-y-6 pb-12` with NO horizontal
 *    padding — it relied on the accordion's `p-4`. Rendered directly it would run
 *    to both viewport edges, unlike every other manager page.
 *
 * The nav also places this LAST, behind a divider, for the same reason the warning
 * exists. See getNavItems in components/Layout.tsx.
 */
export const ManagerRecords: React.FC = () => (
    <div className="px-4 pt-6 pb-6 space-y-4 max-w-3xl mx-auto animate-in fade-in duration-300">
        <header>
            <h1 className="text-2xl font-header font-bold text-coffee">Raw records</h1>
            <p className="text-sm text-coffee-500">
                Advanced — edit documents directly.
            </p>
        </header>

        {/* Same wording as the note Setup used to show, kept verbatim so the
            warning a manager already recognises does not silently change. */}
        <div
            role="note"
            className="flex items-start gap-3 p-4 rounded-2xl
                       bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]"
        >
            <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm leading-snug">
                These are the live records, edited without any of the checks the rest of the
                app applies. They include riders’ names, phone numbers and home addresses.
                There is no undo.
            </p>
        </div>

        {/* The one exception to the warning above, and it is worth stating rather
            than leaving a manager to assume the whole page is unguarded. Tapping a
            name is NOT a raw edit: it goes through managerSetUserRole, which moves
            all four role fields together, refuses a run already under way, hands
            back the car and writes an audit row. The pencil beside it is still the
            unguarded editor, which is why the role fields are read-only there. */}
        <div
            role="note"
            className="flex items-start gap-3 p-4 rounded-2xl
                       bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]"
        >
            <ShieldCheck size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm leading-snug">
                Except roles. Tap somebody’s <strong>name</strong> to see their record and
                change them between Bhulku and Sarthi — that route is checked, refuses
                while a run is under way, and is written to the audit log.
            </p>
        </div>

        {/* Above the raw editor, not below: downloading a list is the thing a manager
            comes here to do most often, and the console underneath is the thing they
            should have to scroll to. */}
        <MemberExportCard />

        <DatabaseConsole />
    </div>
);
