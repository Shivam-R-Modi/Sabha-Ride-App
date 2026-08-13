// Stand-ins for the Firestore-backed hooks in the visual harness. Real ones
// open onSnapshot listeners against a stubbed db.
export const useCurrentEvent = () => ({
  event: { startsAt: null, venue: { address: 'BAPS Mandir, Edison NJ' } },
  eventId: '2026-08-14', hasEvent: true, canWithdraw: true, loading: false,
});
export const submitWeeklyAttendance = async () => undefined;
export const updateAttendanceResponse = async () => ({ success: true });
