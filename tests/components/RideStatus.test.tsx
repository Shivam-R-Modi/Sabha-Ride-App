/**
 * The card a rider looks at to answer "is someone coming for me?".
 *
 * Every status the ride document can hold must produce a card that says
 * something true. The failure to guard against is a status falling through to a
 * blank card — the rider then cannot tell "no driver yet" from "the app is
 * broken", and both look like being forgotten.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { RideStatusCard } from '../../components/RideStatus';
import type { Ride, RideStatus } from '../../types';

const driver = {
    id: 'drv-1',
    name: 'Ramesh Patel',
    phone: '+15550002222',
    avatarUrl: 'https://example.test/r.png',
    carModel: 'Odyssey',
    carColor: 'Silver',
    plateNumber: 'NJ-4821',
};

/**
 * Overrides are loosely typed on purpose. These tests deliberately build rides
 * the domain types do not fully describe — a driver with no phone, a ride with
 * peers — because those are the shapes production actually holds.
 */
const ride = (over: Record<string, unknown> = {}): Ride => ({
    id: 'ride-1',
    status: 'assigned',
    pickupAddress: '12 Maple Ave, Edison NJ',
    timeSlot: '6:45 PM',
    date: '2026-08-14',
    driver,
    ...over,
} as unknown as Ride);

describe('RideStatusCard — waiting', () => {
    it('tells a rider with no driver yet that they have been heard', () => {
        render(<RideStatusCard ride={ride({ status: 'requested', driver: undefined })} />);
        expect(screen.getByText(/Request Received/i)).toBeInTheDocument();
        expect(screen.getByText(/Coordinating with nearby sevaks/i)).toBeInTheDocument();
    });
});

describe('RideStatusCard — a driver is coming', () => {
    it('names the driver, the car and the plate', () => {
        render(<RideStatusCard ride={ride()} />);
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
        expect(screen.getByText(/Silver Odyssey/)).toBeInTheDocument();
        expect(screen.getByText('NJ-4821')).toBeInTheDocument();
    });

    it('offers a way to reach them', () => {
        const { container } = render(<RideStatusCard ride={ride()} />);
        expect(container.querySelector('a[href="tel:+15550002222"]')).toBeTruthy();
        expect(container.querySelector('a[href="sms:+15550002222"]')).toBeTruthy();
    });

    it('hides the text button rather than showing an inert one when the number is unknown', () => {
        // A control that cannot work must not be on screen. This one used to
        // have no onClick at all.
        const { container } = render(
            <RideStatusCard ride={ride({ driver: { ...driver, phone: '' } })} />,
        );
        expect(container.querySelector('a[href^="sms:"]')).toBeNull();
    });

    it('shows the pickup point and the time', () => {
        render(<RideStatusCard ride={ride()} />);
        expect(screen.getByText('12 Maple Ave, Edison NJ')).toBeInTheDocument();
        expect(screen.getByText('6:45 PM')).toBeInTheDocument();
    });

    it('shows an ETA when there is one, and no empty ETA chip when there is not', () => {
        const { rerender } = render(<RideStatusCard ride={ride({ etaMinutes: 8 })} />);
        expect(screen.getByText(/ETA: 8 min/)).toBeInTheDocument();

        rerender(<RideStatusCard ride={ride()} />);
        expect(screen.queryByText(/ETA:/)).not.toBeInTheDocument();
    });
});

describe('RideStatusCard — every status says something', () => {
    const statuses: RideStatus[] = [
        'assigned',
        'driver_en_route',
        'arriving',
        'in_progress',
        'completed',
        'cancelled',
    ];

    it.each(statuses)('%s renders a labelled card, never a blank one', (status) => {
        const { container } = render(<RideStatusCard ride={ride({ status })} />);
        expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
    });

    it('gives each status its own words', () => {
        const labels = new Map<RideStatus, RegExp>([
            ['assigned', /Driver Assigned/i],
            ['driver_en_route', /Driver En Route/i],
            ['arriving', /Arriving Soon/i],
            ['in_progress', /In Progress/i],
            ['completed', /Completed/i],
            ['cancelled', /Cancelled/i],
        ]);

        for (const [status, label] of labels) {
            const { unmount } = render(<RideStatusCard ride={ride({ status })} />);
            expect(screen.getByText(label)).toBeInTheDocument();
            unmount();
        }
    });
});

describe('RideStatusCard — who else is in the car', () => {
    it('shows fellow riders when there are any', () => {
        const peers = [
            { id: 'p1', name: 'Nisha', avatarUrl: 'https://example.test/n.png' },
            { id: 'p2', name: 'Kiran', avatarUrl: 'https://example.test/k.png' },
        ];
        render(<RideStatusCard ride={ride({ peers })} />);

        expect(screen.getByText(/Riding with/i)).toBeInTheDocument();
        expect(screen.getByTitle('Nisha')).toBeInTheDocument();
        expect(screen.getByTitle('Kiran')).toBeInTheDocument();
    });

    it('says nothing about fellow riders when travelling alone', () => {
        render(<RideStatusCard ride={ride()} />);
        expect(screen.queryByText(/Riding with/i)).not.toBeInTheDocument();
    });
});
