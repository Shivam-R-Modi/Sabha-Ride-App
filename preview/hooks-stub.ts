// Stand-ins for the Firestore-backed hooks in the visual harness. Real ones
// open onSnapshot listeners against a stubbed db.
export const useCurrentEvent = () => ({
  event: { startsAt: null, venue: { address: 'BAPS Mandir, Edison NJ' } },
  eventId: '2026-08-14', hasEvent: true, canWithdraw: true, loading: false,
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

export const updateUserStatus = async () => undefined;
