// Every Airport Seva screen, side by side. See vite.config.ts in this folder for
// why these previews exist — the app cannot boot without Firebase credentials, so
// without this nothing here would ever be LOOKED at before it shipped.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ToastProvider } from '../contexts/ToastContext';
import { NavigationProvider } from '../contexts/NavigationContext';
import { ArrivalBoard } from '../components/airport/ArrivalBoard';
import { RoleSelection } from '../components/auth/RoleSelection';
import { AirportShell } from '../components/airport/AirportShell';
import { ArrivalCard } from '../components/airport/ArrivalCard';
import { ArrivalStatusCard } from '../components/airport/ArrivalStatusCard';
import { ArrivalRequestForm } from '../components/airport/ArrivalRequestForm';
import type { AirportPickup } from '../types';

const soon = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

const BASE = {
    id: 'p1',
    requesterUid: 'rider_1',
    requesterName: 'Ramesh',
    direction: 'arrival',
    arrivalDate: '2026-09-20',
    arrivalTime: '22:00',
    arrivalAt: soon(9),
    airportCode: 'BOS',
    airline: 'Emirates',
    flightNumber: 'EK237',
    terminal: 'E',
    isInternational: true,
    partySize: 2,
    largeBags: 4,
    cabinBags: 2,
    dropoffAddress: '360 Huntington Ave, Boston, MA 02115',
    dropoffLat: 42.34,
    dropoffLng: -71.09,
    hasUsWorkingPhone: false,
    meetingPointNote: 'By the exit doors at arrivals, holding a sign with my name',
    needsStopOnTheWay: 'A shop for a SIM card',
    passenger: {
        name: 'Ramesh Patel',
        dateOfBirth: '2007-04-11',
        phone: '+16175550123',
        altPhone: '+919876500000',
        whatsappOn: 'primary',
        email: 'ramesh@example.com',
        familyContact: {
            name: 'Bhavna Patel', relationship: 'Mother',
            phone: '+919876543210', hasWhatsapp: true, preferredLanguage: 'Gujarati',
        },
    },
    status: 'open',
    retainUntil: soon(24 * 365 * 7),
    createdAt: soon(-200),
    updatedAt: soon(-200),
} as unknown as AirportPickup;

const pickup = (over: Partial<AirportPickup>) => ({ ...BASE, ...over } as AirportPickup);

/** Every urgency band and every claim state, so none of them ships unlooked-at. */
const cards: Array<[string, AirportPickup]> = [
    ['Unclaimed — plenty of time', pickup({ arrivalAt: soon(200) })],
    ['Unclaimed — within 2 days', pickup({ arrivalAt: soon(30) })],
    ['Unclaimed — within a day', pickup({ arrivalAt: soon(20) })],
    ['Unclaimed — landing soon', pickup({ arrivalAt: soon(5) })],
    ['Unclaimed — already landed', pickup({ arrivalAt: soon(-2) })],
    ['Claimed by me', pickup({ status: 'claimed', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark' })],
    ['Claimed by somebody else', pickup({ status: 'claimed', claimedByUid: 'other', claimedByName: 'Nilesh' })],
    ['Flight moved after the claim', pickup({ status: 'claimed', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark', arrivalTimeChangedAt: soon(-1) })],
    ['Met — family already told', pickup({ status: 'met', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark', metAt: soon(-1), familyNotifiedAt: soon(-1) })],
    ['No family contact — no WhatsApp button', pickup({ status: 'claimed', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark', passenger: { ...BASE.passenger, familyContact: null } })],
    ['Completed', pickup({ status: 'completed', claimedByUid: 'preview_1', claimedByName: 'Tonny Stark', completedAt: soon(-1) })],
];

const statuses: Array<[string, AirportPickup]> = [
    ['Waiting for a Sarthi', pickup({})],
    ['A Sarthi is coming', pickup({ status: 'claimed', claimedByName: 'Nilesh' })],
    ['Met', pickup({ status: 'met', claimedByName: 'Nilesh' })],
    ['Not found', pickup({ status: 'no_show', claimedByName: 'Nilesh' })],
];

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '10px 16px 4px' }}>
        {children}
    </p>
);

/** One card per state, each with its own open panel so the detail is visible. */
const OpenCard: React.FC<{ arrival: AirportPickup; coordinator?: boolean }> = ({ arrival, coordinator }) => {
    const [open, setOpen] = React.useState(true);
    return (
        <ArrivalCard
            arrival={arrival}
            isCoordinator={coordinator ?? false}
            open={open}
            onToggle={() => setOpen(o => !o)}
        />
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
    <ThemeProvider>
        <ToastProvider>
            <NavigationProvider>
                {/* One column at a narrow viewport, several at a wide one. Narrow is
                    the useful width: the screenshot pipeline here returns a cached
                    frame after a JS-driven scroll (docs/STATUS.md records the same
                    trap), so anything worth looking at has to land on FIRST paint —
                    and a 440px window with one column puts a whole card on screen. */}
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 8, padding: 12, alignItems: 'start' }}>
                    <div>
                        <Label>Newcomer app — the whole of Airport Seva</Label>
                        <AirportShell />
                    </div>

                    <div>
                        <Label>Signup — step 0, where are you</Label>
                        <RoleSelection onSelectRole={() => undefined} />
                    </div>

                    <div>
                        <Label>The board — month grid</Label>
                        <ArrivalBoard />
                    </div>

                    <div>
                        <Label>Traveller — request form</Label>
                        <ArrivalRequestForm onSubmitted={() => undefined} />
                    </div>

                    {statuses.map(([label, arrival]) => (
                        <div key={label}>
                            <Label>Traveller — {label}</Label>
                            <ArrivalStatusCard arrival={arrival} onCancelled={() => undefined} />
                        </div>
                    ))}

                    {cards.map(([label, arrival]) => (
                        <div key={label} style={{ padding: '0 12px' }}>
                            <Label>Card — {label}</Label>
                            <OpenCard arrival={arrival} coordinator={label.includes('somebody else')} />
                        </div>
                    ))}
                </div>
            </NavigationProvider>
        </ToastProvider>
    </ThemeProvider>,
);
