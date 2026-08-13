/**
 * The rider's Rides tab.
 *
 * Guards the two things a redesign could plausibly break here: that "Details"
 * actually reveals something (it shipped once with no onClick at all, a button
 * that promised a screen which did not exist), and that pagination only offers
 * itself when there is genuinely more to load.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { MyRides } from '../../components/MyRides';
import type { Ride } from '../../types';

const ride = (over: Partial<Ride> = {}): Ride => ({
    id: 'ride-1',
    status: 'completed',
    date: '2026-08-14',
    timeSlot: '6:45 PM',
    pickupAddress: '12 Maple Ave, Edison NJ',
    ...over,
} as Ride);

const withDriver = ride({
    id: 'ride-2',
    status: 'assigned',
    driver: {
        id: 'd1',
        name: 'Ramesh Patel',
        avatarUrl: 'https://example.test/r.png',
        carModel: 'Odyssey',
        carColor: 'Silver',
        plateNumber: 'NJ-4821',
    } as never,
});

describe('MyRides — empty states', () => {
    it('tells a rider with nothing booked where to book', () => {
        render(<MyRides history={[]} upcoming={[]} />);
        expect(screen.getByText(/No upcoming rides/i)).toBeInTheDocument();
        expect(screen.getByText(/Request a pickup from the home screen/i)).toBeInTheDocument();
    });

    it('explains an empty history rather than showing a bare panel', async () => {
        const user = userEvent.setup();
        render(<MyRides history={[]} upcoming={[]} />);

        await user.click(screen.getByRole('button', { name: 'History' }));

        expect(screen.getByText(/No ride history/i)).toBeInTheDocument();
    });
});

describe('MyRides — the two tabs', () => {
    it('opens on upcoming', () => {
        render(<MyRides history={[ride()]} upcoming={[withDriver]} />);
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
    });

    it('switches to history and back', async () => {
        const user = userEvent.setup();
        render(<MyRides history={[ride()]} upcoming={[withDriver]} />);

        await user.click(screen.getByRole('button', { name: 'History' }));
        expect(screen.queryByText('Ramesh Patel')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Upcoming' }));
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
    });
});

describe('MyRides — Details actually reveals something', () => {
    it('is collapsed to begin with', () => {
        render(<MyRides history={[]} upcoming={[withDriver]} />);

        const details = screen.getByRole('button', { name: /Details/i });
        expect(details).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('12 Maple Ave, Edison NJ')).not.toBeInTheDocument();
    });

    it('reveals the pickup address and the vehicle', async () => {
        const user = userEvent.setup();
        render(<MyRides history={[]} upcoming={[withDriver]} />);

        await user.click(screen.getByRole('button', { name: /Details/i }));

        expect(screen.getByRole('button', { name: /Details/i })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('12 Maple Ave, Edison NJ')).toBeInTheDocument();
        expect(screen.getByText(/Silver Odyssey — NJ-4821/)).toBeInTheDocument();
    });

    it('says plainly when there is no driver yet, rather than showing a blank line', async () => {
        const user = userEvent.setup();
        render(<MyRides history={[]} upcoming={[ride({ status: 'requested' })]} />);

        await user.click(screen.getByRole('button', { name: /Details/i }));

        expect(screen.getByText(/No driver assigned yet/i)).toBeInTheDocument();
    });

    it('collapses again', async () => {
        const user = userEvent.setup();
        render(<MyRides history={[]} upcoming={[withDriver]} />);

        await user.click(screen.getByRole('button', { name: /Details/i }));
        await user.click(screen.getByRole('button', { name: /Details/i }));

        expect(screen.queryByText('12 Maple Ave, Edison NJ')).not.toBeInTheDocument();
    });
});

describe('MyRides — loading more history', () => {
    it('offers Load More only when there is more', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        render(
            <MyRides history={[ride()]} upcoming={[]} onLoadMore={onLoadMore} hasMoreHistory />,
        );

        await user.click(screen.getByRole('button', { name: 'History' }));
        await user.click(screen.getByRole('button', { name: /Load More/i }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('hides Load More at the end of the list', async () => {
        const user = userEvent.setup();
        render(<MyRides history={[ride()]} upcoming={[]} onLoadMore={vi.fn()} hasMoreHistory={false} />);

        await user.click(screen.getByRole('button', { name: 'History' }));

        expect(screen.queryByRole('button', { name: /Load More/i })).not.toBeInTheDocument();
    });

    it('cannot be double-tapped while a page is in flight', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        render(
            <MyRides
                history={[ride()]}
                upcoming={[]}
                onLoadMore={onLoadMore}
                hasMoreHistory
                loadingMore
            />,
        );

        await user.click(screen.getByRole('button', { name: 'History' }));
        const button = screen.getByRole('button', { name: /Loading/i });
        expect(button).toBeDisabled();
    });
});
