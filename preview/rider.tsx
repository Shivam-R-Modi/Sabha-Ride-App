// Every state of the rider's home screen, side by side. See vite.config.ts
// in this folder for why these previews exist.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { RiderHome } from '../components/student/RiderHome';
import { ToastProvider } from '../contexts/ToastContext';
import type { RiderState } from '../src/utils/riderState';

const user = { id: 'u1', name: 'Meera Patel', address: '42 Oak Street, Edison NJ', role: 'student' } as never;
const ride = {
  id: 'r1', status: 'assigned', pickupAddress: '42 Oak Street, Edison NJ',
  timeSlot: '6:45 PM', date: '2026-08-14', etaMinutes: 8,
  driver: { id: 'd1', name: 'Ramesh Patel', phone: '+15550002222',
    avatarUrl: 'https://ui-avatars.com/api/?name=Ramesh+Patel&background=FF6B35&color=fff',
    carModel: 'Odyssey', carColor: 'Silver', plateNumber: 'NJ-4821' },
} as never;

const states: [string, RiderState][] = [
  ['Not answered yet', { kind: 'attendance-unanswered' }],
  ['Can request', { kind: 'can-request' }],
  ['Waiting', { kind: 'waiting-for-driver' }],
  ['Sarthi assigned', { kind: 'driver-assigned', split: null }],
  ['Split across two cars', { kind: 'driver-assigned', split: { totalSeats: 5, assignedSeats: 3, waitingSeats: 2, driverName: 'Ramesh' } }],
  ['Ready to leave', { kind: 'ready-to-leave' }],
  ['In queue home', { kind: 'in-dropoff-queue' }],
  ['Not coming', { kind: 'not-coming' }],
  ['Turned down', { kind: 'dismissed', info: { managerName: 'Ramesh', managerContact: '+15550009999', dismissedAt: '2026-08-12T18:00:00Z' } }],
  ['No sabha', { kind: 'no-sabha' }],
  ['Loading', { kind: 'loading' }],
];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 8, padding: 12 }}>
    {states.map(([label, state]) => (
      <div key={label}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>{label}</p>
        <ToastProvider>
          <RiderHome user={user} state={state} ride={state.kind === 'driver-assigned' ? ride : null} onAttendanceAnswered={() => {}} />
        </ToastProvider>
      </div>
    ))}
  </div>
);
