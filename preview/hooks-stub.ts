// Stand-ins for the Firestore-backed hooks in the visual harness. Real ones
// open onSnapshot listeners against a stubbed db.
export const useCurrentEvent = () => ({
  event: { startsAt: null, venue: { address: 'BAPS Mandir, Edison NJ' } },
  eventId: '2026-08-28', hasEvent: true, canWithdraw: true, loading: false,
  // So the calendar's "Rides open" pill is visible in the harness. It is driven
  // by the app's own answer, not by the presence of a date.
  calendarStatus: 'ok' as const,
});
export const submitWeeklyAttendance = async () => undefined;
export const updateAttendanceResponse = async () => ({ success: true });

const avatar = (name: string, bg: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=fff`;

export const usePendingDrivers = () => ({
  pendingDrivers: [
    { id: 'drv1', name: 'Ramesh Patel', phone: '+1 555 0001', carModel: 'Honda Odyssey',
      avatarUrl: avatar('Ramesh Patel', 'FF6B35') },
  ],
  loading: false,
});

export const usePendingRiders = () => ({
  pendingRiders: [
    { id: 'rdr1', name: 'Anita Shah', phone: '+1 555 0044', address: '12 Maple Ave, Edison NJ',
      avatarUrl: avatar('Anita Shah', 'D4AF37') },
    { id: 'rdr2', name: 'Kiran Desai', email: 'kiran@example.com', address: '9 Elm Street, Edison NJ',
      avatarUrl: avatar('Kiran Desai', '5C4033') },
  ],
  loading: false,
});

export const useRoleUpgradeRequests = () => ({
  requests: [
    { id: 'hop1', name: 'Priya Desai', phone: '+1 555 0102',
      avatarUrl: avatar('Priya Desai', '7B3F00'),
      roleUpgrade: { status: 'pending', requestedAt: '2026-08-24T09:00:00.000Z' } },
  ],
  loading: false,
});

export const updateUserStatus = async () => undefined;
export const declineRoleUpgrade = async () => undefined;

/** The rider's own side of the request, on ProfileEditor. */
export const requestRoleUpgrade = async () => undefined;
export const clearRoleUpgradeRequest = async () => undefined;

/** Reports' CSV export. Resolves without downloading anything in the harness. */
export const downloadAttendanceCSV = async () => undefined;
