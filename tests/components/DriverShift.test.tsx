/**
 * The driver's home screen.
 *
 * The defect this replaces is worth restating, because it is the clearest
 * example of the failure mode this repo keeps removing: "Assign Me" was
 * `disabled` whenever no car was chosen, so its click handler never ran, so its
 * `alert('Please select a vehicle first')` was UNREACHABLE CODE. The driver got
 * a grey button and no reason, ever. The first describe block below is entirely
 * about that never coming back.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { DriverShift, type DriverShiftProps } from '../../components/driver/DriverShift';

const vehicles = [
    { id: 'v1', name: 'Grey Odyssey', licensePlate: 'NJ-4821', capacity: 7, color: '#888' },
    { id: 'v2', name: 'Blue Sienna', licensePlate: 'NJ-9001', capacity: 4 },
] as never;

const base: DriverShiftProps = {
    driverName: 'Ramesh Patel',
    onShift: true,
    vehicleName: 'Grey Odyssey',
    vehiclePlate: 'NJ-4821',
    rideContextText: 'Home → Sabha',
    ridesToday: 2, peopleToday: 7, milesToday: 18.4,
    isAssigning: false, isStartingShift: false,
    vehicles, vehiclesLoading: false, vehiclePickerOpen: false, selectingVehicle: false,
    onGoOnShift: vi.fn(), onEndShift: vi.fn(), onFindRiders: vi.fn(),
    onOpenVehiclePicker: vi.fn(), onCloseVehiclePicker: vi.fn(), onSelectVehicle: vi.fn(),
};

const show = (over: Partial<DriverShiftProps> = {}) =>
    render(<DriverShift {...base} {...over} />);

describe('DriverShift — no dead controls', () => {
    it('never renders a disabled primary button when a car is missing', () => {
        show({ vehicleName: undefined, vehiclePlate: undefined });

        const primary = screen.getByRole('button', { name: /pick a car to start/i });
        expect(primary).toBeEnabled();
    });

    it('says what is missing, on the button itself', () => {
        // Not in a tooltip, not in an alert nobody can trigger.
        show({ vehicleName: undefined });
        expect(screen.getByRole('button', { name: /pick a car to start/i })).toBeInTheDocument();
    });

    it('pressing it opens the car picker rather than doing nothing', async () => {
        const user = userEvent.setup();
        const onOpenVehiclePicker = vi.fn();
        show({ vehicleName: undefined, onOpenVehiclePicker });

        await user.click(screen.getByRole('button', { name: /pick a car to start/i }));

        expect(onOpenVehiclePicker).toHaveBeenCalled();
    });

    it('does not try to find riders without a car', async () => {
        const user = userEvent.setup();
        const onFindRiders = vi.fn();
        show({ vehicleName: undefined, onFindRiders });

        await user.click(screen.getByRole('button', { name: /pick a car to start/i }));

        expect(onFindRiders).not.toHaveBeenCalled();
    });
});

describe('DriverShift — off shift', () => {
    it('offers one action', () => {
        show({ onShift: false });
        expect(screen.getByRole('button', { name: /go on shift/i })).toBeInTheDocument();
    });

    it('does not also offer to end a shift that has not started', () => {
        show({ onShift: false });
        expect(screen.queryByRole('button', { name: /end my shift/i })).not.toBeInTheDocument();
    });

    it('shows no second card repeating that you are offline', () => {
        // The old screen rendered an unconditional "No assignments yet" card AND
        // a separate "You are currently offline" card, saying the same thing in
        // different words, one above the other.
        show({ onShift: false });
        expect(screen.queryByText(/no assignments yet/i)).not.toBeInTheDocument();
        expect(screen.getAllByText(/off shift/i)).toHaveLength(1);
    });

    it('does not offer to find riders while off shift', () => {
        show({ onShift: false });
        expect(screen.queryByRole('button', { name: /find my next riders/i })).not.toBeInTheDocument();
    });

    it('starts a shift', async () => {
        const user = userEvent.setup();
        const onGoOnShift = vi.fn();
        show({ onShift: false, onGoOnShift });

        await user.click(screen.getByRole('button', { name: /go on shift/i }));

        expect(onGoOnShift).toHaveBeenCalled();
    });
});

describe('DriverShift — on shift', () => {
    it('shows the car and its plate', () => {
        show();
        expect(screen.getByText('Grey Odyssey')).toBeInTheDocument();
        expect(screen.getByText('NJ-4821')).toBeInTheDocument();
    });

    it('shows which leg is running', () => {
        show();
        expect(screen.getByText('Home → Sabha')).toBeInTheDocument();
    });

    it("keeps today's tally to one quiet line", () => {
        show();
        expect(screen.getByText(/2 runs · 7 people · 18 mi/)).toBeInTheDocument();
    });

    it('gets the singulars right', () => {
        show({ ridesToday: 1, peopleToday: 1 });
        expect(screen.getByText(/1 run · 1 person/)).toBeInTheDocument();
    });

    it('finds riders', async () => {
        const user = userEvent.setup();
        const onFindRiders = vi.fn();
        show({ onFindRiders });

        await user.click(screen.getByRole('button', { name: /find my next riders/i }));

        expect(onFindRiders).toHaveBeenCalled();
    });

    it('cannot be double-tapped while searching', () => {
        show({ isAssigning: true });
        expect(screen.getByRole('button', { name: /finding riders/i })).toBeDisabled();
    });

    it('offers a way off shift', async () => {
        const user = userEvent.setup();
        const onEndShift = vi.fn();
        show({ onEndShift });

        await user.click(screen.getByRole('button', { name: /end my shift/i }));

        expect(onEndShift).toHaveBeenCalled();
    });
});

describe('DriverShift — choosing a car', () => {
    it('is closed until asked for', () => {
        show();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('lists the free cars', () => {
        show({ vehiclePickerOpen: true });
        const dialog = screen.getByRole('dialog', { name: /choose a car/i });
        expect(within(dialog).getByText('Grey Odyssey')).toBeInTheDocument();
        expect(within(dialog).getByText('Blue Sienna')).toBeInTheDocument();
    });

    it('counts PASSENGER seats, not total capacity', () => {
        // A car described as "4 seats" that actually fits three riders is how a
        // family gets left standing on the pavement.
        show({ vehiclePickerOpen: true });
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(/6 passenger seats/)).toBeInTheDocument();
        expect(within(dialog).getByText(/3 passenger seats/)).toBeInTheDocument();
    });

    it('takes a car', async () => {
        const user = userEvent.setup();
        const onSelectVehicle = vi.fn();
        show({ vehiclePickerOpen: true, onSelectVehicle });

        await user.click(screen.getByText('Blue Sienna'));

        expect(onSelectVehicle).toHaveBeenCalledWith(expect.objectContaining({ id: 'v2' }));
    });

    it('says plainly when every car is taken', () => {
        show({ vehiclePickerOpen: true, vehicles: [] });
        expect(screen.getByText(/every car is taken/i)).toBeInTheDocument();
    });

    it('shows a loading state rather than claiming there are none', () => {
        // "Every car is taken" shown before the fleet loads would send a driver
        // home for the evening.
        show({ vehiclePickerOpen: true, vehicles: [], vehiclesLoading: true });
        expect(screen.queryByText(/every car is taken/i)).not.toBeInTheDocument();
        expect(screen.getByText(/looking for free cars/i)).toBeInTheDocument();
    });

    it('cannot be dismissed mid-claim, so a half-finished write is not orphaned', () => {
        show({ vehiclePickerOpen: true, selectingVehicle: true });
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('announces itself as a dialog', () => {
        show({ vehiclePickerOpen: true });
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });
});
