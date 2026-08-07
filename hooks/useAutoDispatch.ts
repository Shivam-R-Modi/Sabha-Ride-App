/**
 * Auto-dispatch — DISABLED.
 *
 * This hook ran inside every manager's browser and described itself as acting
 * as "the Server logic". It has not actually dispatched anything for a long
 * time: line 126 of the old implementation called
 *
 *     driverZones.set(assignedDriver.id, studentZone);
 *
 * and neither `driverZones` nor `studentZone` was declared anywhere in the
 * repository. That threw a ReferenceError on the first matched driver, before
 * the updateDoc that would have assigned the ride. The throw was swallowed by
 * the surrounding catch, which logged to a console nobody watches, and the
 * finally block then logged "Processing complete" — so it read as success.
 *
 * It is left disabled rather than repaired, deliberately:
 *
 *  1. It wrote `{ status: 'assigned', driver: <object> }` with NO `driverId`.
 *     The driver dashboard queries `where('driverId','==',uid)`, so a ride
 *     assigned this way was invisible to the very driver it was assigned to.
 *     Repairing the ReferenceError alone would have started marking students
 *     as assigned to drivers who could never see them — worse than doing
 *     nothing.
 *  2. Its only concurrency guard was a per-tab JavaScript boolean. Two managers
 *     with the dashboard open meant two independent dispatchers writing the
 *     same documents.
 *  3. Its drop-off half picked a return driver with Math.random(), ignoring
 *     distance, capacity and current load.
 *
 * Assignment today is driver-pull: the driver taps "Assign Me" and the
 * globalAssignDriver Cloud Function does the work under a lock, with the
 * correct document shape. Server-side push dispatch is Phase 4 of
 * docs/roadmap.md, where it belongs — in a Cloud Function, not in a browser.
 *
 * The call site in ManagerDashboard is retained so the seam stays visible.
 */
export const useAutoDispatch = () => {
    // Intentionally does nothing. See the note above before re-enabling.
};
