/**
 * Choosing who takes a rider.
 *
 * This replaces `availableDrivers.find(d => d.status === 'available')` — the
 * button picked whoever was FIRST IN THE ARRAY and never said who. A manager
 * assigning by hand is doing it precisely because they know something the
 * automatic path does not; taking the choice away removed the reason the button
 * existed.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { DriverPicker } from '../../components/manager/DriverPicker';
import type { Driver } from '../../types';

const driver = (over: Partial<Driver> = {}): Driver => ({
    id: 'd1', userId: 'd1', name: 'Ramesh Patel', phone: '+15550001111',
    currentCarId: null, currentLocation: null, homeLocation: null,
    status: 'available', activeRideId: null,
    ridesCompletedToday: 2, totalStudentsToday: 5, totalDistanceToday: 12,
    currentVehicleName: 'Grey Odyssey', currentVehiclePlate: 'NJ-4821', capacity: 4,
    ...over,
} as Driver);

const show = (over: Partial<React.ComponentProps<typeof DriverPicker>> = {}) =>
    render(
        <DriverPicker
            open
            onClose={vi.fn()}
            riderName="Anita Shah"
            seats={2}
            drivers={[driver()]}
            loading={false}
            assigningId={null}
            onPick={vi.fn()}
            {...over}
        />,
    );

describe('DriverPicker — the manager chooses', () => {
    it('names who is being assigned, so the right row is obvious', () => {
        show();
        expect(screen.getByRole('dialog', { name: /who takes anita shah/i })).toBeInTheDocument();
    });

    it('says how many seats are needed', () => {
        show({ seats: 3 });
        expect(screen.getByText('3 seats needed')).toBeInTheDocument();
    });

    it('gets the singular right', () => {
        show({ seats: 1 });
        expect(screen.getByText('1 seat needed')).toBeInTheDocument();
    });

    it('shows each driver, their car and their plate', () => {
        show();
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
        expect(screen.getByText(/Grey Odyssey · NJ-4821/)).toBeInTheDocument();
    });

    it('reports PASSENGER seats, not capacity', () => {
        // A car listed as "4 seats" that fits three riders is how a family gets
        // left on the pavement.
        show({ drivers: [driver({ capacity: 4 })] });
        expect(screen.getByText(/3 passenger seats/)).toBeInTheDocument();
    });

    it('hands back the driver that was tapped', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        show({
            drivers: [driver(), driver({ id: 'd2', name: 'Bhavesh Joshi' })],
            onPick,
        });

        await user.click(screen.getByText('Bhavesh Joshi'));

        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'd2' }));
    });
});

describe('DriverPicker — capacity warnings', () => {
    it('flags a car that cannot take the whole party', () => {
        show({ seats: 5, drivers: [driver({ capacity: 4 })] });
        expect(screen.getByText(/Only 3/)).toBeInTheDocument();
    });

    it('warns rather than blocks — the manager may be splitting them anyway', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        show({ seats: 5, drivers: [driver({ capacity: 4 })], onPick });

        await user.click(screen.getByText('Ramesh Patel'));

        expect(onPick).toHaveBeenCalled();
    });

    it('makes no capacity claim when the fleet data does not say', () => {
        // A grey "won't fit" on a driver whose capacity is simply unknown would
        // stop a manager using a car that would have worked.
        show({ seats: 5, drivers: [driver({ capacity: undefined })] });
        expect(screen.getByText(/Seats unknown/)).toBeInTheDocument();
        expect(screen.queryByText(/^Only/)).not.toBeInTheDocument();
    });
});

describe('DriverPicker — nothing to choose from', () => {
    it('says plainly when nobody is on shift', () => {
        show({ drivers: [] });
        expect(screen.getByText(/No driver is on shift/i)).toBeInTheDocument();
    });

    it('shows loading rather than claiming there is nobody', () => {
        show({ drivers: [], loading: true });
        expect(screen.queryByText(/No driver is on shift/i)).not.toBeInTheDocument();
        expect(screen.getByText(/finding drivers on shift/i)).toBeInTheDocument();
    });
});

describe('DriverPicker — mid-assignment', () => {
    it('cannot be dismissed while a write is in flight', () => {
        show({ assigningId: 'd1' });
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('disables the rows so a second driver cannot be tapped', () => {
        show({ assigningId: 'd1', drivers: [driver(), driver({ id: 'd2', name: 'Bhavesh' })] });
        const dialog = screen.getByRole('dialog');
        within(dialog).getAllByRole('button')
            .filter(b => /Ramesh|Bhavesh/.test(b.textContent ?? ''))
            .forEach(b => expect(b).toBeDisabled());
    });
});
