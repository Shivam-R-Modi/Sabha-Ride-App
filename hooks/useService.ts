import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import {
    canSwitchService, resolveService, serviceHome, tabBelongsTo,
} from '../src/constants/service';
import type { Service, UserRole } from '../types';

/**
 * Which service this person is in, and how a manager leaves it.
 *
 * HERE RATHER THAN IN NavigationContext, which is where it started. That provider had to
 * read `useAuth()` to derive the service, and the cost showed up immediately: every test
 * that renders a NavigationProvider suddenly needed an auth mock, including the PWA
 * install prompt's, which has nothing to do with who is signed in. The provider holds raw
 * state; this composes it with the profile.
 *
 * The profile arrives through an onSnapshot in AuthContext, so a change to `isArriving`
 * written anywhere — including by `updateAirportPickup` when a traveller's pickup
 * completes — flows through here and re-renders the shell into the other service with
 * nobody tapping anything.
 */
export function useService(): {
    service: Service;
    /**
     * The role everything renders from — `activeRole` if the RoleSwitcher has been
     * used, otherwise the recorded one.
     *
     * RETURNED rather than left for the caller to re-derive. App.tsx had its own copy
     * of this expression, and it is now load-bearing in a second place: which Airport
     * Seva you get depends on it, so two copies could disagree about whether to render
     * the board or the newcomer's form.
     */
    role: UserRole;
    canSwitch: boolean;
    switchService: (to: Service) => void;
} {
    const { userProfile, activeRole } = useAuth();
    const { currentTab, setCurrentTab, serviceOverride, setServiceOverride } = useNavigation();

    const service = resolveService(userProfile, serviceOverride);
    const canSwitch = canSwitchService(userProfile);
    const role: UserRole = (activeRole || userProfile?.role || 'student') as UserRole;

    /**
     * Keep `currentTab` inside the current service. AN INVARIANT, NOT A TRANSITION.
     *
     * The first version of this compared against the previous service and reset on a
     * change. That missed the case where there never is one: an arriving traveller whose
     * profile is already loaded renders once, with `service` already 'airport' and
     * `currentTab` still at its 'home' default — so the mobile dock, which highlights
     * `currentTab === item.id`, lit nothing at all. That is the exact defect the reset was
     * written to prevent, surviving inside the fix for it. Caught by
     * tests/components/serviceRouting.test.tsx.
     *
     * Asking whether the tab belongs here is right on the first render and every later
     * one, whoever changed the service. Idempotent, so more than one caller of this hook
     * costs nothing.
     */
    useEffect(() => {
        if (tabBelongsTo(currentTab, service, role)) return;
        setCurrentTab(serviceHome(service, role));
    }, [service, role, currentTab, setCurrentTab]);

    return {
        service,
        role,
        canSwitch,
        // Ignored for anybody who cannot switch, so the control not rendering and the
        // override not applying are the same decision rather than two that can drift.
        switchService: (to: Service) => { if (canSwitch) setServiceOverride(to); },
    };
}
