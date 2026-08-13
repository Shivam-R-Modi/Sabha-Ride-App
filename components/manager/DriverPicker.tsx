import React from 'react';
import { Car, Loader2, Phone } from 'lucide-react';
import { Sheet } from '../shared/Sheet';
import type { Driver } from '../../types';

/**
 * Which driver takes this request.
 *
 * WHAT THIS REPLACES
 * ------------------
 *     const available = availableDrivers.find(d => d.status === 'available');
 *     if (available) await assignRideToDriver(requestId, available);
 *
 * "Assign" picked whoever happened to be FIRST IN THE ARRAY and never said who.
 * The manager tapped a button and a rider was handed to a driver chosen by
 * Firestore's ordering — no proximity, no seats free, no say. The only way to
 * find out who got them was to switch tabs and look.
 *
 * A manager assigning by hand is doing it precisely because they know something
 * the automatic path does not: this driver lives near that family, that one is
 * about to finish. Taking the choice away removes the entire reason the button
 * exists.
 */

interface DriverPickerProps {
    open: boolean;
    onClose: () => void;
    /** Who is being assigned, so the manager can see they picked the right row. */
    riderName?: string;
    seats: number;
    drivers: Driver[];
    loading: boolean;
    assigningId: string | null;
    onPick: (driver: Driver) => void;
}

/** Passenger seats, not capacity — the driver occupies one. */
const passengerSeats = (driver: Driver): number | null => {
    const capacity = driver.capacity;
    return typeof capacity === 'number' && capacity > 0 ? Math.max(0, capacity - 1) : null;
};

export const DriverPicker: React.FC<DriverPickerProps> = ({
    open, onClose, riderName, seats, drivers, loading, assigningId, onPick,
}) => (
    <Sheet
        open={open}
        onClose={onClose}
        title={riderName ? `Who takes ${riderName}?` : 'Choose a driver'}
        variant="sheet"
        dismissible={assigningId === null}
    >
        <p className="text-sm text-coffee-500 mb-4">
            {seats === 1 ? '1 seat needed' : `${seats} seats needed`}
        </p>

        {loading ? (
            <div className="flex flex-col items-center justify-center py-10">
                <Loader2 className="animate-spin w-7 h-7 text-saffron" />
                <p className="text-sm text-coffee-500 mt-3">Finding drivers on shift…</p>
            </div>
        ) : drivers.length === 0 ? (
            <div className="text-center py-10">
                <Car size={36} className="mx-auto text-coffee-500 mb-3" />
                <p className="text-coffee font-medium">No driver is on shift</p>
                <p className="text-sm text-coffee-500 mt-1">
                    Nobody can be assigned until someone goes on shift and takes a car.
                </p>
            </div>
        ) : (
            <div className="space-y-3">
                {drivers.map(driver => {
                    const free = passengerSeats(driver);
                    // Only claimed when the fleet data actually says so. A grey
                    // "won't fit" on a driver whose capacity is simply unknown
                    // would stop a manager using a car that would have worked.
                    const tooSmall = free !== null && free < seats;

                    return (
                        <button
                            key={driver.id}
                            onClick={() => onPick(driver)}
                            disabled={assigningId !== null}
                            className="w-full clay-card p-4 flex items-center gap-4 text-left min-h-11
                                       hover:shadow-md transition-all disabled:opacity-50"
                        >
                            <img
                                src={driver.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.name)}&background=FF6B35&color=fff`}
                                alt=""
                                className="w-11 h-11 rounded-xl shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-coffee truncate">{driver.name}</p>
                                <p className="text-sm text-coffee-500 truncate">
                                    {driver.currentVehicleName || driver.carModel || 'No car taken'}
                                    {driver.currentVehiclePlate || driver.plateNumber
                                        ? ` · ${driver.currentVehiclePlate || driver.plateNumber}`
                                        : ''}
                                </p>
                                <p className="text-xs text-coffee-500 mt-0.5">
                                    {free === null
                                        ? 'Seats unknown'
                                        : `${free} passenger ${free === 1 ? 'seat' : 'seats'}`}
                                    {' · '}
                                    {driver.ridesCompletedToday ?? 0} runs today
                                </p>
                            </div>

                            <div className="shrink-0 flex flex-col items-end gap-1">
                                {assigningId === driver.id
                                    ? <Loader2 className="animate-spin text-saffron" size={18} />
                                    : tooSmall && (
                                        // A warning, not a block. The manager may
                                        // know the party is splitting anyway.
                                        <span className="text-[10px] font-bold px-2 py-1 rounded-lg
                                                         bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]">
                                            Only {free}
                                        </span>
                                    )}
                                {driver.phone && (
                                    <span className="text-[10px] text-coffee-500 flex items-center gap-1">
                                        <Phone size={10} /> {driver.phone}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        )}
    </Sheet>
);
