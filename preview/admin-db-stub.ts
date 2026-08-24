// Stand-in for hooks/useAdminDatabase in the visual harness, so the Raw records
// page can be looked at without Firestore.
export type SupportedCollection = 'users' | 'vehicles' | 'rides' | 'settings' | 'auditLogs';

const ROWS: Record<string, Array<Record<string, any>>> = {
    users: [
        // Role fields written out in full, because the table and the detail sheet
        // now read all FOUR of them. The old two rows carried `role` alone, so
        // every row in the harness rendered as "mixed".
        { id: 'u1', name: 'Tonny Stark', email: 'tonnystark83@gmail.com',
          role: 'manager', registeredRole: 'manager',
          roles: ['manager', 'driver', 'student'], activeRole: 'manager',
          accountStatus: 'approved', address: '5 Woodbine St, Roxbury, MA 02119, USA',
          phone: '+1 555 0100', createdAt: '2026-01-04T00:00:00.000Z' },
        { id: 'u2', name: 'Asha Patel', email: 'asha@example.com',
          role: 'driver', registeredRole: 'driver',
          roles: ['driver', 'student'], activeRole: 'driver',
          accountStatus: 'approved', address: '442 E 5th St, Boston, MA 02127, USA',
          phone: '+1 555 0101', createdAt: '2026-02-11T00:00:00.000Z',
          currentVehicleId: 'v1', currentVehicleName: 'Car1', status: 'available' },
        // A Bhulku with a request outstanding — the state the People tab acts on.
        { id: 'u3', name: 'Priya Desai', email: 'priya@example.com',
          role: 'student', registeredRole: 'student',
          roles: ['student'], activeRole: 'student',
          accountStatus: 'approved', address: '9 Elm Street, Edison NJ',
          phone: '+1 555 0102', createdAt: '2026-03-02T00:00:00.000Z',
          roleUpgrade: { status: 'pending', requestedAt: '2026-08-24T09:00:00.000Z' } },
        // The half-written record this whole feature exists to end: `role` says
        // Sarthi, the other three still say Bhulku. Shows the "mixed" badge.
        { id: 'u4', name: 'Half Written', email: 'half@example.com',
          role: 'driver', registeredRole: 'student',
          roles: ['student'], activeRole: 'student',
          accountStatus: 'approved', phone: '+1 555 0103',
          createdAt: '2026-04-09T00:00:00.000Z' },
    ],
    vehicles: [{ id: 'v1', name: 'Car1', status: 'available', capacity: 4 }],
    rides: [], settings: [], auditLogs: [],
};

export function useAdminDatabase(target: SupportedCollection) {
    return {
        documents: ROWS[target] ?? [],
        loading: false,
        error: null as string | null,
        updateAdminDocument: async () => undefined,
        createAdminDocument: async () => undefined,
        deleteAdminDocument: async () => undefined,
        deleteMultipleAdminDocuments: async () => undefined,
    };
}
