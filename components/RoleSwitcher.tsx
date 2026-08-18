import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import { Shield, Car, GraduationCap, ChevronDown } from 'lucide-react';

const roleConfig: Record<UserRole, { label: string; icon: React.ReactNode; color: string }> = {
    manager: {
        label: 'Manager',
        icon: <Shield size={16} />,
        color: 'text-coffee'
    },
    driver: {
        label: 'Driver',
        icon: <Car size={16} />,
        color: 'text-[rgb(var(--info-text))]'
    },
    student: {
        label: 'Student',
        icon: <GraduationCap size={16} />,
        color: 'text-[rgb(var(--success-text))]'
    }
};

export const RoleSwitcher: React.FC = () => {
    const { activeRole, setActiveRole, getAvailableRoles } = useAuth();
    const availableRoles = getAvailableRoles();

    // Every hook runs before the early return below. It used to sit after it,
    // which is a `react-hooks/rules-of-hooks` violation: `availableRoles` comes
    // from the live user document, so this component rendered ZERO hooks for a
    // rider with one role and ONE the moment a manager granted them `driver`.
    //
    // MEASURED, so the next person does not have to guess: React 19 tolerates
    // this today. Going from the early return to calling `useState` throws
    // nothing and logs nothing — the state is simply re-initialised. So this was
    // latent fragility, not a live crash, and the fix is cheap insurance rather
    // than an incident. It is still worth doing: hook order that depends on data
    // is behaviour React explicitly does not support, and StrictMode's double
    // render and future concurrent features are exactly where it would surface.
    //
    // Found by `npm run lint` on the day the project first had a config to run.
    const [isOpen, setIsOpen] = React.useState(false);

    // Nothing to switch between, so nothing to show. Safe here: the hooks above
    // have already run, so the count is the same either way.
    if (availableRoles.length <= 1) {
        return null;
    }

    const currentConfig = activeRole ? roleConfig[activeRole] : null;

    const handleRoleSelect = (role: UserRole) => {
        setActiveRole(role);
        setIsOpen(false);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 min-h-11 rounded-xl bg-[rgb(var(--surface)/0.8)] hover:bg-surface shadow-sm border border-gold/20 transition-all duration-200"
            >
                {currentConfig && (
                    <>
                        <span className={currentConfig.color}>{currentConfig.icon}</span>
                        <span className="font-medium text-coffee text-sm">{currentConfig.label}</span>
                    </>
                )}
                <ChevronDown size={14} className={`text-mocha transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-dropdown"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Dropdown.
                        right-0, not left-0. In the mobile header this control
                        sits hard against the right edge, so aligning the menu's
                        LEFT edge to it pushed a 192px panel 50px past the
                        viewport on a 375px phone — the "Active" badge and the
                        right of every row were simply off-screen. Aligning the
                        right edges instead makes it open inward.
                        No change on desktop: in the sidebar the trigger is also
                        192px wide, so both alignments land in the same place. */}
                    <div className="absolute top-full right-0 mt-2 w-48 bg-surface rounded-xl shadow-xl border border-gold/20 overflow-hidden z-dropdown animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-2 border-b border-cream-dark">
                            <p className="text-xs text-coffee-500 font-medium uppercase tracking-wide px-2">Switch Role</p>
                        </div>
                        <div className="p-1">
                            {availableRoles.map((role) => {
                                const config = roleConfig[role];
                                const isActive = role === activeRole;

                                return (
                                    <button
                                        key={role}
                                        onClick={() => handleRoleSelect(role)}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${isActive
                                                ? 'bg-saffron/10 text-saffron'
                                                : 'hover:bg-cream text-coffee'
                                            }`}
                                    >
                                        <span className={isActive ? 'text-saffron-800' : config.color}>
                                            {config.icon}
                                        </span>
                                        <span className="font-medium text-sm">{config.label}</span>
                                        {isActive && (
                                            <span className="ml-auto text-xs bg-saffron/20 text-saffron-800 px-2 py-0.5 rounded-full">
                                                Active
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
