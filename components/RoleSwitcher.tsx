import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import { Shield, Car, GraduationCap, ChevronDown } from 'lucide-react';

const roleConfig: Record<UserRole, { label: string; icon: React.ReactNode; color: string }> = {
    manager: {
        label: 'Manager',
        icon: <Shield size={16} />,
        color: 'text-purple-600'
    },
    driver: {
        label: 'Driver',
        icon: <Car size={16} />,
        color: 'text-blue-600'
    },
    student: {
        label: 'Student',
        icon: <GraduationCap size={16} />,
        color: 'text-green-600'
    }
};

export const RoleSwitcher: React.FC = () => {
    const { activeRole, setActiveRole, getAvailableRoles, userProfile } = useAuth();
    const availableRoles = getAvailableRoles();

    // Don't show switcher if only one role available (students)
    if (availableRoles.length <= 1) {
        return null;
    }

    const [isOpen, setIsOpen] = React.useState(false);
    const currentConfig = activeRole ? roleConfig[activeRole] : null;

    const handleRoleSelect = (role: UserRole) => {
        setActiveRole(role);
        setIsOpen(false);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 hover:bg-white shadow-sm border border-gold/20 transition-all duration-200"
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
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Dropdown */}
                    <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gold/20 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-2 border-b border-cream-dark">
                            <p className="text-xs text-mocha/60 font-medium uppercase tracking-wide px-2">Switch Role</p>
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
                                        <span className={isActive ? 'text-saffron' : config.color}>
                                            {config.icon}
                                        </span>
                                        <span className="font-medium text-sm">{config.label}</span>
                                        {isActive && (
                                            <span className="ml-auto text-xs bg-saffron/20 text-saffron px-2 py-0.5 rounded-full">
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
