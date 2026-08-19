// The manager's new screens. See vite.config.ts in this folder.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { DriverPicker } from '../components/manager/DriverPicker';
import { ManagerPeople } from '../components/manager/ManagerPeople';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16, padding: 12 }}>
    <div>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>People — approvals</p>
      <ToastProvider><ManagerPeople /></ToastProvider>
    </div>
    <div style={{ position: 'relative', minHeight: 700 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>Sarthi picker — replaces the silent pick</p>
      <DriverPicker open onClose={() => {}} riderName="Anita Shah" seats={4}
        drivers={drivers} loading={false} assigningId={null} onPick={() => {}} />
    </div>
  </div>
);
