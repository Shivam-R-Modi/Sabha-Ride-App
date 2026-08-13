import React from 'react';
import { Sun, Moon, Smartphone } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemePreference } from '../../src/utils/theme';

const OPTIONS: { value: ThemePreference; label: string; hint: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'Day', hint: 'Always light', Icon: Sun },
    { value: 'dark', label: 'Night', hint: 'Always dark', Icon: Moon },
    { value: 'system', label: 'Auto', hint: 'Follow this device', Icon: Smartphone },
];

/**
 * Day / night / follow-the-device.
 *
 * A radiogroup rather than three buttons, and a real `<input type="radio">`
 * rather than a styled div, so arrow keys move between the choices and a screen
 * reader announces "2 of 3 selected" — which is what a segmented control is
 * supposed to do and what a div-with-onClick never does.
 */
export const ThemeToggle: React.FC = () => {
    const { preference, setPreference } = useTheme();

    return (
        <fieldset className="w-full">
            <legend className="text-sm font-medium text-coffee mb-2">Appearance</legend>

            <div
                role="radiogroup"
                aria-label="Appearance"
                className="flex gap-1 p-1 rounded-2xl bg-cream-300/60 border border-hairline/10"
            >
                {OPTIONS.map(({ value, label, hint, Icon }) => {
                    const isSelected = preference === value;
                    return (
                        <label
                            key={value}
                            title={hint}
                            className={`flex-1 flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl cursor-pointer
                                transition-colors min-h-11 ${isSelected
                                    ? 'bg-surface text-saffron-800 shadow-sm'
                                    : 'text-coffee-500 hover:text-coffee'
                                }`}
                        >
                            <input
                                type="radio"
                                name="theme-preference"
                                value={value}
                                checked={isSelected}
                                onChange={() => setPreference(value)}
                                // Visually hidden, NOT display:none — a hidden input is
                                // removed from the tab order and from the accessibility
                                // tree, which would make this keyboard-unreachable.
                                className="sr-only"
                            />
                            <Icon size={18} aria-hidden="true" />
                            <span className="text-xs font-bold">{label}</span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
};
