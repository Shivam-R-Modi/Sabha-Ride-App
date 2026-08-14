/**
 * The fleet screen's Release action.
 *
 * Two defects this covers, both found on 2026-08-14 with a three-car fleet that
 * had zero available cars:
 *
 * 1. **No way to free a held car.** A vehicle goes `in_use` when a driver picks
 *    it and is only freed by that driver finishing. Delete is refused while
 *    `in_use`, and the edit form does not touch status — so a driver who stopped
 *    without finishing left the car held with no route back through the UI.
 *
 * 2. **The holder was never shown.** `useVehicles` mapped `currentDriverName`
 *    from a document field of that name, which nothing writes — every writer sets
 *    `assignedDriverName`. So the row said "In Use" and named nobody, which is
 *    what made a perfectly ordinary soft release look like data corruption.
 *
 * These assert the CALL, not the button. This codebase's recurring bug is a
 * control that looks wired up and does nothing, so rendering a Release button is
 * not the thing worth proving.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const managerReleaseVehicle = vi.fn(async () => ({ success: true, vehicleId: 'veh_1', previousHolder: 'driver_1' }));
vi.mock('../../src/utils/cloudFunctions', () => ({
    managerReleaseVehicle: (...a: any[]) => managerReleaseVehicle(...a as []),
}));

let vehicles: any[] = [];
vi.mock('../../hooks/useFirestore', () => ({
    useVehicles: () => ({ vehicles, loading: false, error: null }),
    deleteVehicle: vi.fn(async () => undefined),
}));

import { FleetManagement } from '../../components/manager/FleetManagement';

const HELD = {
    id: 'veh_1', name: 'Car3', color: 'blue', licensePlate: 'vbc-213',
    capacity: 4, status: 'in_use', currentDriverName: 'Tonny Stark', currentDriverId: 'driver_1',
};
const FREE = {
    id: 'veh_2', name: 'Car2', color: 'grey', licensePlate: 'oti-123',
    capacity: 4, status: 'available',
};

const releaseButton = () => screen.queryByRole('button', { name: /release car3 back to the fleet/i });

beforeEach(() => {
    vi.clearAllMocks();
    vehicles = [HELD, FREE];
});

describe('FleetManagement — the Release control appears where it can act', () => {
    it('offers Release on a held car', () => {
        render(<FleetManagement />);
        expect(releaseButton()).toBeInTheDocument();
    });

    it('does NOT offer it on an available car', () => {
        // A Release that cannot do anything is the dead control this codebase
        // keeps removing.
        vehicles = [FREE];
        render(<FleetManagement />);
        expect(screen.queryByRole('button', { name: /release car2/i })).toBeNull();
    });

    it('shows who is holding the car', () => {
        render(<FleetManagement />);
        expect(screen.getByText(/held by tonny stark/i)).toBeInTheDocument();
    });

    it('says so plainly when a held car has no driver recorded', () => {
        // The orphan case. No driver-side path can ever free this one, so the
        // row must not simply be blank.
        vehicles = [{ ...HELD, currentDriverName: undefined, currentDriverId: undefined }];
        render(<FleetManagement />);
        expect(screen.getByText(/no driver is recorded/i)).toBeInTheDocument();
    });
});

describe('FleetManagement — Release asks first, then actually releases', () => {
    it('asks for confirmation before doing anything', async () => {
        const user = userEvent.setup();
        render(<FleetManagement />);

        await user.click(releaseButton()!);

        expect(await screen.findByText(/release car3\?/i)).toBeInTheDocument();
        expect(managerReleaseVehicle).not.toHaveBeenCalled();
    });

    it('names the holder in the question', async () => {
        // "Release Car3?" and "Release Car3 from Tonny Stark?" are different
        // decisions, and only one of them can be made safely from a list.
        const user = userEvent.setup();
        render(<FleetManagement />);

        await user.click(releaseButton()!);

        expect(await screen.findByText(/tonny stark is holding this car/i)).toBeInTheDocument();
    });

    it('calls the callable once confirmed', async () => {
        const user = userEvent.setup();
        render(<FleetManagement />);

        await user.click(releaseButton()!);
        await user.click(await screen.findByRole('button', { name: /^release$/i }));

        await waitFor(() => expect(managerReleaseVehicle).toHaveBeenCalledWith('veh_1'));
    });

    it('does nothing at all when cancelled', async () => {
        const user = userEvent.setup();
        render(<FleetManagement />);

        await user.click(releaseButton()!);
        // useConfirm labels its dismiss "Go back", not "Cancel".
        await user.click(await screen.findByRole('button', { name: /go back/i }));

        expect(managerReleaseVehicle).not.toHaveBeenCalled();
    });

    it('confirms in the UI when it worked', async () => {
        const user = userEvent.setup();
        render(<FleetManagement />);

        await user.click(releaseButton()!);
        await user.click(await screen.findByRole('button', { name: /^release$/i }));

        expect(await screen.findByText(/car3 is back in the fleet/i)).toBeInTheDocument();
    });

    it('surfaces the server\'s refusal rather than swallowing it', async () => {
        // The server refuses while the driver is mid-run, and that reason is the
        // only thing telling the manager what to do instead.
        managerReleaseVehicle.mockRejectedValueOnce(
            new Error('Tonny Stark is on a run with 3 ride(s). Release their riders first.'),
        );
        const user = userEvent.setup();
        render(<FleetManagement />);

        await user.click(releaseButton()!);
        await user.click(await screen.findByRole('button', { name: /^release$/i }));

        expect(await screen.findByText(/on a run with 3 ride/i)).toBeInTheDocument();
    });
});
