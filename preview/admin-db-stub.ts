// Stand-in for hooks/useAdminDatabase in the visual harness, so the Raw records
// page can be looked at without Firestore.
export type SupportedCollection = 'users' | 'vehicles' | 'rides' | 'settings' | 'auditLogs';

const ROWS: Record<string, Array<Record<string, any>>> = {
    users: [
        { id: 'u1', name: 'Tonny Stark', email: 'tonnystark83@gmail.com', role: 'manager',
          accountStatus: 'approved', address: '5 Woodbine St, Roxbury, MA 02119, USA' },
        { id: 'u2', name: 'Asha Patel', email: 'asha@example.com', role: 'driver',
          accountStatus: 'pending', address: '442 E 5th St, Boston, MA 02127, USA' },
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
