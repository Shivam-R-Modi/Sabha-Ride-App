/**
 * The two services, and where each one lands.
 *
 * Airport Seva is a second service behind the same login rather than a feature
 * inside the ride app, so the shell needs one place that knows which tab a service
 * opens on.
 *
 * SERVICE_HOME is what makes sharing the `TabView` union safe. `setService` sends
 * `currentTab` here, so a sabha `switch (currentTab)` can never receive an airport
 * value and vice versa — and the mobile dock always has an item that matches, rather
 * than showing nothing selected until the first tap.
 */

import type { Service, TabView } from '../../types';

export const SERVICE_HOME: Record<Service, TabView> = {
    sabha: 'home',
    airport: 'airport-board',
};

/**
 * Where the launcher sends a Bhulku.
 *
 * A rider has no board to look at — `airport-board` is a Sarthi's screen — so
 * sending them there would open the service on a page they cannot use. Read through
 * `serviceHome` below rather than indexing SERVICE_HOME directly.
 */
const RIDER_AIRPORT_HOME: TabView = 'airport-request';

export function serviceHome(service: Service, canSeeBoard: boolean): TabView {
    if (service === 'airport' && !canSeeBoard) return RIDER_AIRPORT_HOME;
    return SERVICE_HOME[service];
}

export const SERVICE_LABEL: Record<Service, string> = {
    sabha: 'Sabha Seva',
    airport: 'Airport Seva',
};

/** The key the chosen service is remembered under, so it is not a tap every session. */
export const SERVICE_STORAGE_KEY = 'active_service';
