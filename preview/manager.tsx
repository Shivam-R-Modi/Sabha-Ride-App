// The manager's new screens. See vite.config.ts in this folder.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { DriverPicker } from '../components/manager/DriverPicker';
import { ManagerPeople } from '../components/manager/ManagerPeople';
import { SabhaCalendar } from '../components/manager/SabhaCalendar';
import { ManagerReports } from '../components/manager/ManagerReports';
import { NotificationSettings } from '../components/manager/NotificationSettings';
import { LocationSettings } from '../components/manager/LocationSettings';
import { HallManagement } from '../components/manager/HallManagement';
import { RequestTable } from '../components/manager/RequestTable';
import type { StudentRequest } from '../types';
import { ToastProvider } from '../contexts/ToastContext';
import type { Driver } from '../types';

const drivers = [
  { id: 'd1', name: 'Ramesh Patel', phone: '+1 555 0001', currentVehicleName: 'Grey Odyssey',
    currentVehiclePlate: 'NJ-4821', capacity: 7, ridesCompletedToday: 2,
    avatarUrl: 'https://ui-avatars.com/api/?name=Ramesh+Patel&background=FF6B35&color=fff' },
  { id: 'd2', name: 'Bhavesh Joshi', phone: '+1 555 0002', currentVehicleName: 'Blue Sienna',
    currentVehiclePlate: 'NJ-9001', capacity: 4, ridesCompletedToday: 0,
    avatarUrl: 'https://ui-avatars.com/api/?name=Bhavesh+Joshi&background=D4AF37&color=fff' },
  { id: 'd3', name: 'Nisha Trivedi', phone: '+1 555 0003', currentVehicleName: 'Red Civic',
    currentVehiclePlate: 'NJ-2210', capacity: 3, ridesCompletedToday: 4,
    avatarUrl: 'https://ui-avatars.com/api/?name=Nisha+Trivedi&background=5C4033&color=fff' },
] as unknown as Driver[];

/**
 * The waiting queue. Never rendered outside a sign-in until now, which is exactly the
 * gap this folder exists for.
 *
 * The fixture is the awkward evening on purpose — a party of eight no vehicle can take
 * whole, a rider who asked not to be split, two halls named, a long wait — because
 * those are the rows that wrap badly and the ones nobody sees until a Friday.
 */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const requests = [
  { id: 'req-1', name: 'Anita Shah', address: '12 Maple Ave, Boston', seats: 1,
    requestTime: minutesAgo(4), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Anita+Shah&background=FF6B35&color=fff' },
  { id: 'req-2', name: 'Bhavin Desai', address: '88 Chestnut Hill Ave, Brighton', seats: 8,
    groupSeatsTotal: 8, requestTime: minutesAgo(52), requestedTimeSlot: '7:00 PM',
    status: 'pending', locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Bhavin+Desai&background=D4AF37&color=fff' },
  { id: 'req-3', name: 'Chirag Mehta', address: '3 Elm Street, Somerville', seats: 7,
    keepTogether: true, requestTime: minutesAgo(96), requestedTimeSlot: '7:00 PM',
    status: 'pending', locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Chirag+Mehta&background=5C4033&color=fff' },
  { id: 'req-4', name: 'Deepa Joshi', address: '140 Main Street, Woburn', seats: 1,
    requestTime: minutesAgo(31), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Deepa+Joshi&background=FF6B35&color=fff' },
  { id: 'req-5', name: 'Esha Patel', address: '22 Winn Street, Woburn', seats: 2,
    requestTime: minutesAgo(12), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Esha+Patel&background=D4AF37&color=fff' },
  { id: 'req-6', name: 'Falguni Rao', address: '5 Boylston Place, Boston', seats: 2,
    requestTime: minutesAgo(7), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Falguni+Rao&background=5C4033&color=fff' },
  { id: 'req-7', name: 'Gaurav Sheth', address: '61 Beacon Street, Somerville', seats: 4,
    requestTime: minutesAgo(19), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'boston-huntington', locationName: 'Sabha',
    avatarUrl: 'https://ui-avatars.com/api/?name=Gaurav+Sheth&background=FF6B35&color=fff' },
  // At the OTHER hall, so the "2 waiting at Elm Street" line has something to say.
  { id: 'req-8', name: 'Hetal Shah', address: '9 Highland Ave, Somerville', seats: 2,
    requestTime: minutesAgo(22), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'somerville', locationName: 'Elm Street',
    avatarUrl: 'https://ui-avatars.com/api/?name=Hetal+Shah&background=D4AF37&color=fff' },
  { id: 'req-9', name: 'Ishan Vyas', address: '41 College Ave, Somerville', seats: 1,
    requestTime: minutesAgo(9), requestedTimeSlot: '7:00 PM', status: 'pending',
    locationId: 'somerville', locationName: 'Elm Street',
    avatarUrl: 'https://ui-avatars.com/api/?name=Ishan+Vyas&background=5C4033&color=fff' },
  // NAMES NO HALL, on purpose. A cached client that predates the picker files this, and
  // with two halls open dispatch refuses it — so it belongs to no hall's board and the
  // warning beside the picker is the only place it appears.
  { id: 'req-10', name: 'Jigar Amin', address: '7 Park Drive, Boston', seats: 1,
    requestTime: minutesAgo(64), requestedTimeSlot: '7:00 PM', status: 'pending',
    avatarUrl: 'https://ui-avatars.com/api/?name=Jigar+Amin&background=FF6B35&color=fff' },
] as unknown as StudentRequest[];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16, padding: 12 }}>
    <div style={{ gridColumn: '1 / -1' }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Request Center — carloads, and the flat list behind the toggle</p>
      <div style={{ height: 720, display: 'flex' }}>
        <ToastProvider>
          <RequestTable
            requests={requests}
            loading={false}
            onAssign={() => undefined}
            onDismiss={() => undefined}
            onBulkAssign={() => undefined}
          />
        </ToastProvider>
      </div>
    </div>
    <div>
      {/* Never rendered outside a sign-in until now — and the reason it exists is that
          opening the second hall turned LocationSettings' address editor into a dead
          control. Two active halls plus a retired one, from the firestore stub. */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Sabha locations — add, move, open, close</p>
      <ToastProvider><HallManagement /></ToastProvider>
    </div>
    <div>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>People — approvals</p>
      <ToastProvider><ManagerPeople /></ToastProvider>
    </div>
    <div>
      {/* Added because this is the screen a full-page spinner was reported on,
          and it had never been rendered outside a sign-in. */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Reports — frame first, figures after</p>
      <ToastProvider><ManagerReports /></ToastProvider>
    </div>
    <div>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Sabha calendar — one card, twelve weeks behind it</p>
      <ToastProvider><SabhaCalendar /></ToastProvider>
    </div>
    <div>
      {/* Added with the locations change: this screen now writes to TWO places — the
          hall dispatch routes by, and settings/main which an un-refreshed phone still
          reads for the address it shows a rider. It had never been rendered outside a
          sign-in, and the fixture in firestore-stub.ts was unused until it appeared
          here. */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Venue — one hall, and it is the one dispatch uses</p>
      <ToastProvider><LocationSettings /></ToastProvider>
    </div>
    <div>
      {/* Both halves side by side, which is the one thing the real app deliberately
          never shows: sabha settings live in Setup and airport settings on the
          Arrivals board, two navigations and a service switch apart. Seeing them
          together here is how the split gets checked. */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Notifications — sabha half (one muted)</p>
      <NotificationSettings service="sabha" />
    </div>
    <div>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Notifications — airport half, with the band picker</p>
      <NotificationSettings service="airport" />
    </div>
    <div style={{ position: 'relative', minHeight: 700 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Sarthi picker — replaces the silent pick</p>
      <DriverPicker open onClose={() => {}} riderName="Anita Shah" seats={4}
        drivers={drivers} loading={false} assigningId={null} onPick={() => {}} />
    </div>
  </div>
);
