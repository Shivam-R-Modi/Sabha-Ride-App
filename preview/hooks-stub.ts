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

/**
 * The notice board, with an image, so it can actually be LOOKED at.
 *
 * `useNotices` was not stubbed, so NoticeBoard rendered nothing in the harness —
 * and it sits on every dashboard. The image path in particular had never been seen
 * at any width here, which is how it shipped cropped.
 *
 * A PORTRAIT data-URI on purpose: a phone photo is portrait, and portrait is the
 * shape `object-cover max-h-72` mangled. Inline rather than a file so the harness
 * needs no asset and no network.
 */
const portraitFlyer = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
     <rect width="100%" height="100%" fill="#d9c6a8"/>
     <circle cx="450" cy="420" r="200" fill="#8a6a45"/>
     <rect x="150" y="700" width="600" height="380" rx="24" fill="#8a6a45"/>
     <text x="450" y="1150" font-size="54" text-anchor="middle" fill="#4a3520">900 x 1200</text>
   </svg>`);

export const useNotices = () => ({
  notices: [
    {
      id: 'n1',
      title: 'What I couldn\u2019t do, and won\u2019t',
      body: 'What I couldn\u2019t do, and won\u2019t\n\nPressing the actual button needs an approved-manager session, and that means a Google sign-in. I won\u2019t type your password into a login form \u2014 that\u2019s a line I hold regardless of who asks.',
      imageUrl: portraitFlyer,
      imagePath: 'notices/n1/flyer.svg',
      createdAt: '2026-08-24T20:17:03.000Z',
      createdByUid: 'mgr_1',
    },
    {
      id: 'n2',
      body: '\ud83c\udf89 Welcome to Boston! \ud83c\uddfa\ud83c\uddf8\nCongratulations on your admission\u2014we\u2019re sure your family is incredibly proud of your achievement!',
      createdAt: '2026-08-24T20:03:37.000Z',
      createdByUid: 'mgr_1',
    },
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
