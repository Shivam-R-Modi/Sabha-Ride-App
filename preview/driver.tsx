// Every state of the driver's shift card. See vite.config.ts in this folder.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { DriverShift, type DriverShiftProps } from '../components/driver/DriverShift';

const vehicles = [
  { id: 'v1', name: 'Grey Odyssey', licensePlate: 'NJ-4821', capacity: 7, color: '#6B7280' },
  { id: 'v2', name: 'Blue Sienna', licensePlate: 'NJ-9001', capacity: 4, color: '#2563EB' },
] as never;

const base: DriverShiftProps = {
  driverName: 'Ramesh Patel',
  avatarUrl: 'https://ui-avatars.com/api/?name=Ramesh+Patel&background=FF6B35&color=fff',
  onShift: true, vehicleName: 'Grey Odyssey', vehiclePlate: 'NJ-4821',
  rideContextText: 'Home → Sabha',
  ridesToday: 2, peopleToday: 7, milesToday: 18.4,
  isAssigning: false, isStartingShift: false,
  vehicles, vehiclesLoading: false, vehiclePickerOpen: false, selectingVehicle: false,
  onGoOnShift: () => {}, onEndShift: () => {}, onFindRiders: () => {},
  onOpenVehiclePicker: () => {}, onCloseVehiclePicker: () => {}, onSelectVehicle: () => {},
};

const states: [string, Partial<DriverShiftProps>][] = [
  ['Off shift', { onShift: false }],
  ['On shift, car chosen', {}],
  ['On shift, NO car — was a grey dead button', { vehicleName: undefined, vehiclePlate: undefined }],
  ['Finding riders', { isAssigning: true }],
  ['First run of the night', { ridesToday: 0, peopleToday: 0, milesToday: 0 }],
];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 8, padding: 12 }}>
    {states.map(([label, over]) => (
      <div key={label}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 16px' }}>{label}</p>
        <DriverShift {...base} {...over} />
      </div>
    ))}
  </div>
);
