import React from 'react';
import { User, Ride, Driver, DriverAssignment, StudentRequest, RideGroup } from './types';

// --- Icons & Motifs ---

export const LotusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12,2.5c0,0-1.2,2.4-1.2,3.8c0,1,0.5,1.8,1.2,1.8s1.2-0.8,1.2-1.8C13.2,4.9,12,2.5,12,2.5z M12,21.5c-4.2,0-7.8-2.6-9.3-6.4c1.8,1.5,4.1,2.4,6.7,2.4c1.1,0,2.2-0.2,3.2-0.5c-0.2,0.1-0.4,0.3-0.6,0.5C12,17.5,12,21.5,12,21.5z M4.5,13c0-2.5,1.5-4.7,3.6-5.8c-0.6,1.4-1,3,1,4.6c0,0.4,0,0.8,0.1,1.2C7.2,13,7.2,13,7.2,13L4.5,13z M19.5,13c0-2.5-1.5-4.7,3.6-5.8c0.6,1.4,1,3,1,4.6c0,0.4,0,0.8-0.1,1.2C16.8,13,16.8,13,16.8,13L19.5,13z" />
  </svg>
);

export const DiyaIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2c.5 2 2.5 4 2.5 6S12.5 12 12 12s-2.5-2-2.5-4S11.5 4 12 2z" fill="#FF6B35" stroke="none" />
    <path d="M4 12c0 4.4 3.6 8 8 8s8-3.6 8-8c0-1.1-.2-2.1-.6-3H4.6c-.4.9-.6 1.9-.6 3z" />
  </svg>
);

export const LotusLoader: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <div className="flex flex-col items-center justify-center animate-in fade-in duration-500">
    <div className="relative" style={{ width: size, height: size }}>
      <LotusIcon className="w-full h-full text-saffron animate-pulse-slow drop-shadow-sm" />
      <div className="absolute inset-0 border-2 border-gold/20 rounded-full animate-spin-slow"></div>
    </div>
  </div>
);

export const OmWatermark: React.FC = () => (
  <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center opacity-[0.03]">
    <svg viewBox="0 0 500 500" className="w-[80vw] h-[80vw] text-coffee">
      <text x="50%" y="50%" textAnchor="middle" fontSize="400" fontFamily="serif" dy=".3em">ॐ</text>
    </svg>
  </div>
);

// --- Auth Mocks ---
export const MOCK_ADMIN_PHONE = '1111111111';
export const MOCK_APPROVED_DRIVER_PHONE = '9999999999';
export const MOCK_PENDING_DRIVER_PHONE = '8888888888';
export const MOCK_STUDENT_PHONE = '5550000000';

// --- Mock Data ---

export const CURRENT_USER: User = {
  id: 'u1',
  name: 'Aarav Patel',
  address: '123 Lotus Lane, Edison, NJ',
  avatarUrl: 'https://picsum.photos/100/100',
  phone: '555-0100',
};

export const MOCK_DRIVER: Driver = {
  id: 'd1',
  name: 'Rajesh Kumar',
  address: '101 Driver Lane, Edison, NJ',
  carModel: 'Toyota Sienna',
  carColor: 'Silver',
  plateNumber: 'ABC-1234',
  phone: '555-0199',
  avatarUrl: 'https://picsum.photos/101/101',
  capacity: 7,
  status: 'active'
};

export const MOCK_ALL_DRIVERS: Driver[] = [
  { ...MOCK_DRIVER, id: 'd1', name: 'Rajesh Kumar', capacity: 7, status: 'available', currentVehicleId: 'v1' },
  { id: 'd2', name: 'Sanjay Shah', address: '202 Driver Rd, Edison, NJ', carModel: 'Honda Odyssey', carColor: 'Blue', plateNumber: 'XYZ-987', phone: '555-0200', avatarUrl: 'https://ui-avatars.com/api/?name=Sanjay+Shah&background=random', capacity: 7, status: 'available', currentVehicleId: 'v2' },
  { id: 'd3', name: 'Amit Patel', address: '303 Driver Ct, Edison, NJ', carModel: 'Toyota Camry', carColor: 'White', plateNumber: 'LMN-456', phone: '555-0201', avatarUrl: 'https://ui-avatars.com/api/?name=Amit+Patel&background=random', capacity: 4, status: 'available', currentVehicleId: 'v3' },
  { id: 'd4', name: 'Priya Desai', address: '404 Driver Blvd, Edison, NJ', carModel: 'Tesla Model Y', carColor: 'Red', plateNumber: 'TES-123', phone: '555-0202', avatarUrl: 'https://ui-avatars.com/api/?name=Priya+Desai&background=random', capacity: 4, status: 'available', currentVehicleId: 'v4' },
  { id: 'd5', name: 'Vikram Singh', address: '505 Driver Way, Edison, NJ', carModel: 'Ford Explorer', carColor: 'Black', plateNumber: 'FRD-555', phone: '555-0203', avatarUrl: 'https://ui-avatars.com/api/?name=Vikram+Singh&background=random', capacity: 6, status: 'available', currentVehicleId: 'v5' },
  { id: 'd6', name: 'Rohan Gupta', address: '606 Driver Ln, Edison, NJ', carModel: 'Honda Pilot', carColor: 'Grey', plateNumber: 'HND-777', phone: '555-0204', avatarUrl: 'https://ui-avatars.com/api/?name=Rohan+Gupta&background=random', capacity: 7, status: 'available', currentVehicleId: 'v6' },
];

export const MOCK_PEERS: User[] = [
  { id: 'u2', name: 'Priya S.', address: '45 Oak St, Edison', avatarUrl: 'https://picsum.photos/102/102', phone: '555-0102' },
  { id: 'u3', name: 'Dev M.', address: '78 Maple Ave, Edison', avatarUrl: 'https://picsum.photos/103/103', phone: '555-0103' },
];

export const MOCK_HISTORY: Ride[] = [
  {
    id: 'r_prev1',
    date: '2023-10-20T17:00:00',
    timeSlot: '5:30 PM',
    status: 'completed',
    pickupAddress: '123 Lotus Lane',
    driver: MOCK_DRIVER,
    peers: MOCK_PEERS,
    isReadyToLeave: true,
  },
  {
    id: 'r_prev2',
    date: '2023-10-13T17:00:00',
    timeSlot: '6:00 PM',
    status: 'completed',
    pickupAddress: '123 Lotus Lane',
    driver: MOCK_DRIVER,
    peers: [],
    isReadyToLeave: true,
  }
];

export const VENUE_ADDRESS = "BAPS Shri Swaminarayan Mandir, Edison";

export const UNASSIGNED_STUDENTS: User[] = [
  { id: 'u99', name: 'Rohan G.', address: '101 Pine Rd, Edison', avatarUrl: 'https://picsum.photos/108/108', phone: '555-0199' },
  { id: 'u98', name: 'Kavya P.', address: '202 Birch Ln, Edison', avatarUrl: 'https://picsum.photos/109/109', phone: '555-0198' },
];

export const MOCK_PICKUP_ASSIGNMENT: DriverAssignment = {
  id: 'da_1',
  type: 'pickup',
  date: '2023-11-03',
  status: 'active',
  passengers: [
    { ...MOCK_PEERS[0], stopStatus: 'completed', sequenceOrder: 1, eta: '5:15 PM', notes: 'Waiting at main gate' },
    { ...MOCK_PEERS[1], stopStatus: 'pending', sequenceOrder: 2, eta: '5:30 PM' },
    { ...CURRENT_USER, stopStatus: 'pending', sequenceOrder: 3, eta: '5:45 PM' },
  ],
  totalDistance: '12.5 mi',
  totalTime: '45 min',
  venueAddress: VENUE_ADDRESS
};

export const MOCK_DROPOFF_ASSIGNMENT: DriverAssignment = {
  id: 'da_2',
  type: 'dropoff',
  date: '2023-11-03',
  status: 'pending',
  passengers: [
    { ...MOCK_PEERS[0], stopStatus: 'pending', sequenceOrder: 1, eta: '8:45 PM' },
    { ...MOCK_PEERS[1], stopStatus: 'pending', sequenceOrder: 2, eta: '9:00 PM' },
    { ...CURRENT_USER, stopStatus: 'pending', sequenceOrder: 3, eta: '9:15 PM' },
  ],
  totalDistance: '12.8 mi',
  totalTime: '50 min',
  venueAddress: VENUE_ADDRESS
};

// --- Boston Mock Data for Clustering Test ---

const BOSTON_ADDRESSES = [
  "1 City Hall Sq, Boston, MA 02201 (City Hall)",
  "75 State St, Boston, MA 02109 (Financial District)",
  "100 Cambridge St, Boston, MA 02114 (Beacon Hill)",
  "131 Cambridge St, Boston, MA 02114 (Old West Church)",
  "141 Cambridge St, Boston, MA 02114 (First Harrison Gray Otis House)",
  "307 Hanover St, Boston, MA 02113 (North End - Carmelina's)",
  "77 N Washington St, Boston, MA 02114 (North End/West End)",
  "30 Penniman Rd, Boston, MA 02134 (Allston)",
  "430 Faneuil St, Boston, MA 02135 (Brighton)",
  "109 Newbury St, Boston, MA 02116 (Back Bay - Brooks Brothers)",
  "115 Newbury St, Boston, MA 02116 (Back Bay - See Eyewear)",
  "117 Newbury St, Boston, MA 02116 (Back Bay - Faherty)",
  "121 Newbury St, Boston, MA 02116 (Back Bay - Santa Maria Novella)",
  "123 Newbury St, Boston, MA 02116 (Back Bay - Diptyque)",
  "127-129 Newbury St, Boston, MA 02116 (Back Bay - The Rug Company)",
  "131 Newbury St, Boston, MA 02116 (Back Bay - Winston Flowers)",
  "135 Newbury St, Boston, MA 02116 (Back Bay - Suit Shop)",
  "137 Newbury St, Boston, MA 02116 (Back Bay - L'Elite Bridal)",
  "139 Newbury St, Boston, MA 02116 (Back Bay - Byredo)",
  "141 Newbury St, Boston, MA 02116 (Back Bay - Allen Edmonds)",
  "143 Newbury St, Boston, MA 02116 (Back Bay - Veronica Beard)",
  "147 Newbury St, Boston, MA 02116 (Back Bay - Saltie Girl)",
  "700 Boylston St, Boston, MA 02116 (Back Bay - BPL Central Library)",
  "2 Boylston St, Boston, MA 02116 (Chinatown Library)",
  "52 Academy Hill Rd, Brighton, MA 02135 (Brighton Municipal Court)",
  "3 City Square, Charlestown, MA 02129 (Charlestown Municipal Court)",
  "510 Washington St, Dorchester, MA 02124 (Dorchester Municipal Court)",
  "37 Meridian St, East Boston, MA 02128 (East Boston Municipal Court)",
  "85 Warren St, Roxbury, MA 02119 (Roxbury Municipal Court)",
  "535 East Broadway, South Boston, MA 02127 (South Boston Municipal Court)"
];

const getMockCoordinates = (address: string): { x: number, y: number } => {
  const lower = address.toLowerCase();
  if (lower.includes('back bay') || lower.includes('newbury') || lower.includes('boylston')) {
    return { x: 20 + Math.random() * 20, y: 60 + Math.random() * 20 };
  }
  if (lower.includes('city hall') || lower.includes('state st') || lower.includes('cambridge st') || lower.includes('chinatown')) {
    return { x: 45 + Math.random() * 10, y: 45 + Math.random() * 10 };
  }
  if (lower.includes('north end') || lower.includes('hanover') || lower.includes('charlestown') || lower.includes('east boston') || lower.includes('washington')) {
    return { x: 60 + Math.random() * 20, y: 20 + Math.random() * 20 };
  }
  if (lower.includes('allston') || lower.includes('brighton') || lower.includes('faneuil') || lower.includes('penniman')) {
    return { x: 5 + Math.random() * 10, y: 40 + Math.random() * 20 };
  }
  if (lower.includes('dorchester') || lower.includes('roxbury') || lower.includes('south boston') || lower.includes('broadway')) {
    return { x: 60 + Math.random() * 20, y: 70 + Math.random() * 20 };
  }
  return { x: Math.random() * 100, y: Math.random() * 100 };
};

export const MOCK_PENDING_REQUESTS: StudentRequest[] = BOSTON_ADDRESSES.map((address, i) => ({
  id: `sr_${i}`,
  name: `Student ${i + 1}`,
  address: address,
  phone: '555-0100',
  avatarUrl: `https://ui-avatars.com/api/?name=Student+${i}&background=random`,
  requestTime: new Date(Date.now() - Math.random() * 3600000).toISOString(),
  requestedTimeSlot: i % 2 === 0 ? '5:30 PM' : '6:00 PM',
  status: 'pending',
  coordinates: getMockCoordinates(address)
}));

export const MOCK_OPTIMIZED_GROUPS: RideGroup[] = [];