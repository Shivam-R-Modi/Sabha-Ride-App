/**
 * Barrel re-export file for all Firestore hooks.
 *
 * The original monolithic useFirestore.ts has been split into
 * domain-specific modules. This file re-exports everything so
 * existing imports from '../hooks/useFirestore' continue to work
 * without any changes in consuming components.
 */

export * from './useRides';
export * from './useUsers';
export * from './useVehicles';
export * from './useDriverDashboard';
export * from './useAutoDispatch';
export * from './useAttendance';
