import React from 'react';
import { Car, Plane } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { hasGrantedRole } from '../../src/roles';
import { LotusIcon } from '../../constants';
import type { Service } from '../../types';

/**
 * Which seva. Shown once, then remembered.
 *
 * Airport Seva is a second service behind the same login, not a feature inside the
 * ride app — a different journey, a different lifecycle, a different way of being
 * assigned. This screen is what makes that legible: you pick one and you are inside
 * it, and switching is a menu item rather than a tab you might land on by accident.
 *
 * NOT SHOWN EVERY SESSION. The choice persists, so this appears on a first visit and
 * after a sign-out. Making it a gate on every launch would add a tap to every Friday
 * evening for the 95% case, which is the ride app.
 *
 * Rendered ABOVE the shell — no sidebar, no bottom nav — because neither nav means
 * anything until a service is chosen. It sits after the whole auth cascade in App, so
 * everybody reaching it is signed in, verified, profiled and approved.
 */
export const ServiceLauncher: React.FC = () => {
    const { userProfile } = useAuth();
    const { setService } = useNavigation();

    // A Sarthi lands on the board; a Bhulku lands on the request form. Passed through
    // rather than decided inside setService so the context stays unaware of roles.
    const canSeeBoard = hasGrantedRole(userProfile, 'driver');

    const choose = (service: Service) => setService(service, canSeeBoard);

    const cards: Array<{
        service: Service;
        title: string;
        blurb: string;
        icon: typeof Car;
    }> = [
        {
            service: 'sabha',
            title: 'Sabha Seva',
            icon: Car,
            blurb: 'Lifts to sabha and home again.',
        },
        {
            service: 'airport',
            title: 'Airport Seva',
            icon: Plane,
            // No weekday, no time of day: tests/quality/schedule-not-hardcoded.test.ts
            // scans this directory and a sabha's schedule is a rule, not a constant.
            blurb: 'Collecting people arriving in the USA.',
        },
    ];

    return (
        <div className="min-h-screen bg-cream flex items-center justify-center p-6">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex bg-gradient-to-br from-saffron to-saffron-dark p-3 rounded-2xl shadow-lg mb-4">
                        <LotusIcon className="w-7 h-7 text-white" />
                    </div>
                    <h1 className="text-2xl font-header font-bold text-coffee">
                        {userProfile?.name ? `Jai Swaminarayan, ${userProfile.name}` : 'Jai Swaminarayan'}
                    </h1>
                    <p className="text-coffee-500 mt-1">Which seva today?</p>
                </div>

                {/* A list, so a screen reader announces "2 items" rather than two
                    unrelated buttons — and so the same markup works at any width. */}
                <ul className="space-y-4" aria-label="Choose a seva">
                    {cards.map(({ service, title, blurb, icon: Icon }) => (
                        <li key={service}>
                            <button
                                type="button"
                                onClick={() => choose(service)}
                                className="clay-card w-full p-5 flex items-center gap-4 text-left transition-transform active:scale-[0.99]"
                            >
                                <span className="bg-gradient-to-br from-saffron to-saffron-dark p-3 rounded-xl shadow-md shrink-0">
                                    <Icon className="w-6 h-6 text-white" aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block font-header font-bold text-coffee">{title}</span>
                                    <span className="block text-sm text-coffee-500">{blurb}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>

                <p className="text-center text-xs text-coffee-500 mt-6">
                    You can switch between them at any time from the menu.
                </p>
            </div>
        </div>
    );
};
