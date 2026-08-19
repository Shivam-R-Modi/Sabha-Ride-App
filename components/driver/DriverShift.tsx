import React from 'react';
import { Car, Users, ChevronRight, Loader2, Navigation, Moon } from 'lucide-react';
import { Sheet } from '../shared/Sheet';
import type { Vehicle } from '../../types';

/**
 * The driver's home screen: what shift am I on, and what happens next.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A status card with a nested toggle, a stats row, a ride-type card, an error
 * banner, a grey "Assign Me", an empty-state card that rendered UNCONDITIONALLY
 * — including directly beneath that button — a "Done for Today" button, and,
 * when offline, a SECOND card saying the same thing as the first in different
 * words. Nine blocks, several contradicting each other.
 *
 * THREE THINGS WORTH NOT UNDOING
 * ------------------------------
 * 1. NO DISABLED PRIMARY BUTTON. "Assign Me" used to be `disabled` whenever no
 *    car was chosen — which meant its click handler never ran, which meant its
 *    `alert('Please select a vehicle first')` was UNREACHABLE CODE. The driver
 *    got a grey button and no reason, ever. Now the button says what to do next
 *    and does it: "Pick a car to start".
 *
 * 2. A CAR IS PART OF BEING ON SHIFT, not a separate concern. You cannot drive
 *    without one, so choosing one is step one of going on shift rather than a
 *    sub-panel with its own "Select Car" button.
 *
 * 3. NO EMPTY STATE. The button IS the empty state. A card explaining that you
 *    have no assignment, sitting under a button that gets you one, is noise.
 */

export interface DriverShiftProps {
    driverName: string;
    avatarUrl?: string;
    onShift: boolean;
    vehicleName?: string;
    vehiclePlate?: string;
    /** Server-published label for the current leg, e.g. "Home → Sabha". */
    rideContextText?: string;
    ridesToday: number;
    peopleToday: number;
    milesToday: number;

    isAssigning: boolean;
    isStartingShift: boolean;

    vehicles: Vehicle[];
    vehiclesLoading: boolean;
    vehiclePickerOpen: boolean;
    selectingVehicle: boolean;

    onGoOnShift: () => void;
    onEndShift: () => void;
    onFindRiders: () => void;
    onOpenVehiclePicker: () => void;
    onCloseVehiclePicker: () => void;
    onSelectVehicle: (vehicle: Vehicle) => void;
    /**
     * Rendered directly under the name, before the shift card.
     *
     * A slot rather than an import, because this component has no business
     * knowing about notices. It exists because DriverShift owns the PAGE — its
     * own `px-4 pt-6` wrapper and the `<header>` with the Sarthi's name — so
     * anything placed around it in DriverDashboard lands either above the page
     * header, flush against the app chrome, or after the whole card. The notice
     * board sat in the first of those and looked dumped there, while the page had
     * no title above the fold. RiderHome puts it after its header; this makes the
     * two screens match.
     */
    afterHeader?: React.ReactNode;
}

export const DriverShift: React.FC<DriverShiftProps> = ({
    driverName, avatarUrl, onShift, vehicleName, vehiclePlate, rideContextText,
    ridesToday, peopleToday, milesToday,
    isAssigning, isStartingShift,
    vehicles, vehiclesLoading, vehiclePickerOpen, selectingVehicle,
    onGoOnShift, onEndShift, onFindRiders,
    onOpenVehiclePicker, onCloseVehiclePicker, onSelectVehicle,
    afterHeader,
}) => {
    const hasCar = Boolean(vehicleName);

    return (
        <div className="px-4 pt-6 pb-6 space-y-5 animate-in fade-in duration-300">
            <header className="flex items-center gap-3">
                {avatarUrl && (
                    <img
                        src={avatarUrl}
                        alt=""
                        className="w-11 h-11 rounded-full object-cover border-2 border-surface shadow-sm"
                    />
                )}
                {/* Name only. A status line here would repeat what the card
                    immediately below already says — off shift states it
                    outright, on shift shows the running leg, the car and a
                    button to collect riders. Saying it twice is how the old
                    screen ended up with two cards explaining the same thing. */}
                <h1 className="text-xl font-header font-bold text-coffee leading-tight min-w-0">
                    {driverName}
                </h1>
            </header>

            {afterHeader}

            {onShift ? (
                <div className="clay-card-accent">
                    {/* The leg the server says is running. Only shown on shift,
                        where it changes what the next tap will do. */}
                    {rideContextText && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-saffron-800 mb-3">
                            {rideContextText}
                        </p>
                    )}

                    <button
                        onClick={onOpenVehiclePicker}
                        className="w-full flex items-center gap-3 p-3 rounded-2xl bg-[rgb(var(--surface)/0.6)]
                                   border border-hairline/10 text-left hover:bg-surface transition-colors
                                   min-h-11"
                    >
                        <div className="w-10 h-10 rounded-xl bg-cream-300 flex items-center justify-center
                                        text-saffron shrink-0">
                            <Car size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold text-coffee-500 uppercase tracking-wider">
                                Your car
                            </p>
                            <p className="text-sm font-bold text-coffee truncate">
                                {vehicleName ?? 'No car chosen'}
                            </p>
                            {vehiclePlate && (
                                <p className="text-[11px] text-coffee-500 font-mono">{vehiclePlate}</p>
                            )}
                        </div>
                        <span className="text-xs font-semibold text-saffron-800 shrink-0">
                            {hasCar ? 'Change' : 'Choose'}
                        </span>
                    </button>

                    {/* Never disabled. When there is no car this is what to do
                        next, and pressing it does that thing. */}
                    <button
                        onClick={hasCar ? onFindRiders : onOpenVehiclePicker}
                        disabled={isAssigning}
                        className="clay-button-primary w-full mt-4 disabled:opacity-60"
                    >
                        {isAssigning ? (
                            <><Loader2 className="animate-spin" size={18} /> Finding riders…</>
                        ) : hasCar ? (
                            <><Navigation size={18} /> Find my next riders</>
                        ) : (
                            <><Car size={18} /> Pick a car to start</>
                        )}
                    </button>

                    {/* Quiet, because it is a summary and not a decision. */}
                    <p className="text-xs text-coffee-500 text-center mt-4">
                        Today: {ridesToday} {ridesToday === 1 ? 'run' : 'runs'} ·{' '}
                        {peopleToday} {peopleToday === 1 ? 'person' : 'people'} ·{' '}
                        {milesToday.toFixed(0)} mi
                    </p>
                </div>
            ) : (
                <div className="clay-card">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-cream-300 flex items-center justify-center
                                        text-coffee-500 shrink-0">
                            <Moon size={22} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h2 className="font-header font-bold text-coffee text-lg leading-tight">
                                You're off shift
                            </h2>
                            <p className="text-sm text-coffee-500 mt-1 leading-snug">
                                Go on shift to pick a car and start collecting riders.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onGoOnShift}
                        disabled={isStartingShift}
                        className="clay-button-primary w-full mt-5 disabled:opacity-60"
                    >
                        {isStartingShift
                            ? <><Loader2 className="animate-spin" size={18} /> Starting…</>
                            : 'Go on shift'}
                    </button>
                </div>
            )}

            {onShift && (
                <button onClick={onEndShift} className="clay-button-secondary w-full">
                    End my shift
                </button>
            )}

            <Sheet
                open={vehiclePickerOpen}
                onClose={onCloseVehiclePicker}
                title="Choose a car"
                variant="sheet"
                dismissible={!selectingVehicle}
            >
                {vehiclesLoading ? (
                    <div className="flex flex-col items-center justify-center py-10">
                        <Loader2 className="animate-spin w-7 h-7 text-saffron" />
                        <p className="text-sm text-coffee-500 mt-3">Looking for free cars…</p>
                    </div>
                ) : vehicles.length === 0 ? (
                    <div className="text-center py-10">
                        <Car size={36} className="mx-auto text-coffee-500 mb-3" />
                        <p className="text-coffee font-medium">Every car is taken</p>
                        <p className="text-sm text-coffee-500 mt-1">
                            Ask a coordinator to add one, or wait for a driver to finish.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {vehicles.map(vehicle => (
                            <button
                                key={vehicle.id}
                                onClick={() => onSelectVehicle(vehicle)}
                                disabled={selectingVehicle}
                                className="w-full clay-card p-4 flex items-center gap-4 text-left
                                           hover:shadow-md transition-all disabled:opacity-50 min-h-11"
                            >
                                <div
                                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: vehicle.color || 'rgb(var(--accent))' }}
                                >
                                    <Car size={20} className="text-white/90" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-coffee">{vehicle.name}</p>
                                    <p className="text-sm text-coffee-500 font-mono">{vehicle.licensePlate}</p>
                                    <p className="text-xs text-coffee-500 flex items-center gap-1 mt-1">
                                        {/* Passenger seats, not total capacity — the
                                            driver occupies one, and a car described as
                                            "4 seats" that fits three riders is how a
                                            family gets left behind. */}
                                        <Users size={12} />
                                        {Math.max(0, (vehicle.capacity ?? 1) - 1)} passenger seats
                                    </p>
                                </div>
                                {selectingVehicle
                                    ? <Loader2 className="animate-spin text-saffron shrink-0" size={18} />
                                    : <ChevronRight size={18} className="text-coffee-500 shrink-0" />}
                            </button>
                        ))}
                    </div>
                )}
            </Sheet>
        </div>
    );
};
