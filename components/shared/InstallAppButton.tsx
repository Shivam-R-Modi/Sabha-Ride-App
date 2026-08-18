import React from 'react';
import { Download, Share } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';

/**
 * The permanent way back to installing, for everyone who dismissed the banner
 * or never saw it.
 *
 * The banner asks once and then stays quiet, which is the right manners but
 * leaves no route back — and on iOS there is no browser-provided prompt to fall
 * back on. So this lives in Profile, the one destination all three roles share
 * (the same reasoning that put ThemeToggle there), and in the desktop sidebar.
 *
 * Renders NOTHING when installing is impossible or already done. A permanently
 * visible "Install app" on a browser that cannot install is precisely the dead
 * control this repo keeps removing.
 */
export const InstallAppButton: React.FC<{
    variant?: 'card' | 'sidebar';
    collapsed?: boolean;
}> = ({ variant = 'card', collapsed = false }) => {
    const { availability, canInstall, install, reveal } = usePwaInstall();

    if (!canInstall) return null;

    // On iOS there is nothing to call, so the click re-opens the banner holding
    // the steps rather than pretending to install.
    const onClick = availability === 'prompt' ? install : reveal;
    const Icon = availability === 'prompt' ? Download : Share;
    const label = availability === 'prompt' ? 'Install app' : 'Add to Home Screen';

    if (variant === 'sidebar') {
        return (
            <button
                onClick={onClick}
                title={collapsed ? label : undefined}
                className={`w-full flex items-center gap-2 py-3 px-4 bg-cream-400 hover:bg-cream-300 text-coffee-700 rounded-xl text-xs font-bold transition-all btn-feedback ${collapsed ? 'justify-center px-0' : 'justify-center'
                    }`}
            >
                <Icon size={16} />
                {!collapsed && label}
            </button>
        );
    }

    return (
        <button
            onClick={onClick}
            className="clay-card w-full flex items-center gap-4 text-left p-4 btn-feedback"
        >
            <div className="bg-cream-300 p-2 rounded-xl text-saffron shrink-0">
                <Icon size={20} />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-bold text-coffee">{label}</p>
                <p className="text-xs text-coffee-500">
                    {availability === 'prompt'
                        ? 'Opens like an app, without the address bar'
                        : 'Show me how — it takes two taps'}
                </p>
            </div>
        </button>
    );
};
