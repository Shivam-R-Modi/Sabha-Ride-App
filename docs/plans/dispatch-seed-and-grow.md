# Dispatch: replace k-means with seed-and-grow

**Decided 2026-08-14.** Single location for now; multi-city is later development
and only one forward-compatibility seam is built for it.

---

## Why the current algorithm cannot work here

`globalAssignDriver:299` calls `kMeansWithDriverSeeds(allStudentPoints, driverPoints)`
— K-means whose initial centroids are the **drivers' home addresses**.

**Every driver in this congregation lives within 2 miles of the venue.** So all K
seeds are effectively one point. K-means then drifts the centroids onto the rider
data and converges, but *which driver receives which cluster is decided by a
near-tie at initialisation* — it is arbitrary.

The property that justifies the whole design — "a driver is given the riders
nearest to them" — **does not exist here.** The algorithm is doing work that
produces no signal.

The geometry, correctly stated:

| | Outbound (home → sabha) | Return (sabha → home) |
|---|---|---|
| Drivers start | Within 2 mi of venue | **At** the venue |
| Riders | Spread out | Spread out |
| Does driver identity change cost? | No | No |

Drivers start from effectively one point in **both** directions. So there is no
"my cluster". The only question a tap needs to answer is:

> **What is the best single carload from the riders still queued?**

---

## The replacement

### Seed-and-grow, per tap

1. **Seed** — take the queued rider **farthest from the venue**.
2. **Grow** — add the seed's nearest neighbours until the car's passenger seats
   are full, preserving the existing `remaindersFirst` ordering and `allowSplit`
   rules.
3. **Route** — `optimizeRoute` on that carload (unchanged).
4. **Commit** — under a narrow lock; driver previews and accepts or releases.

`clustering.ts` largely goes away. This is a net deletion.

### Why the seed is the farthest rider

This is the one decision that matters, and it wins in both regimes:

- **Capacity ≥ demand.** Seed order only affects route quality. Serving an
  outlier *while there is still capacity to pair them with neighbours* is cheaper
  than serving them alone in the last car. Classic savings/sweep result.
- **Capacity < demand.** Seed order decides who waits. Nearest-first strands the
  far riders — potentially the same child, every week, silently. Farthest-first
  makes the near riders wait, and near riders are both cheaper to serve later and
  likelier to have another option.

It is also right for the **return run**, for a reason worth stating: the far group
has the longest drive, so sending them out **first** minimises the time until the
*last* rider is home. Farthest-first does that automatically. One rule, both
directions, and it optimises the thing that actually matters on a Friday night.

### The driver keeps control

Seeding for efficiency does **not** push work at drivers. The existing loop is
already right and stays:

```
driver taps "Find my next riders"
  → globalAssignDriver assigns one carload
  → AssignmentPreview shows it
  → Accept (startRide)  OR  Release (releaseAssignment)
  → released riders return to the queue for the next driver's tap
```

`AssignmentPreview.tsx:81,104` — accept and release are both already built. A
driver who does not tap never gets riders; a driver who dislikes a run declines
it. That is the "priority to the driver" property, and it is preserved exactly.

**Fairness valve — starvation.** A rider in a dense area may never be chosen as a
seed. Escalate any rider queued beyond a threshold to seed priority ahead of the
distance rule. One comparison, and it is the only thing standing between the
algorithm and a child who is never picked.

---

## What else changes in the same pass

### 1. Event filter — a correctness bug

`isValidPendingRide:45` validates only coordinates and `studentId`. It does
**not** check which sabha a request belongs to. Three `requested` rides from
`2026-08-09` are live in production right now and **would be dispatched tonight**.

Filter the pool by `rideContext.eventId`. Deleting the three orphans (approved)
fixes today; this stops it recurring.

### 2. Drop driver-home seeding entirely

Follows from the 2-mile finding. Driver location is still needed as the route's
start point on the outbound run — it is only the *clustering seed* that goes.

### 3. Auto-release sweep (approved)

Scheduled job: release any vehicle held with no active ride past the end of the
sabha day. Writes an audit row. **Must never release a car with a live ride** —
stranding a driver mid-run is worse than a stuck car.

### 4. `adminDeleteUser` releases held vehicles

`:57–58` deletes `vehicles/{uid}` and `cars/{uid}` — keys no vehicle uses. Replace
with a query on `assignedDriverId == uid`. This is what orphaned Car1.

### 5. Manager release control

Release action per in-use vehicle, via a guarded + audited callable. Also fix
`VehicleForm`'s update branch, which drops `status` so editing cannot free a car.

### 6. `in_use` keeps its name (decided)

No new `held` status, no migration. But the manager screens must stop implying the
two counts mean the same thing:

- Fleet: split **In Use** into *driving* vs *held, idle*.
- Dashboard: **"Out now · N drivers"**, not "cars".

---

## The one forward-compatibility seam

Multi-city is later, but the roadmap already fixes the shape: **City is the
isolation silo, Location is the operational unit**, and `rides`/`users` stay
top-level carrying `cityId` and `locationId` (roadmap §A1, §A2). Dispatch will
scope to **`locationId`** — that is what owns a vehicle pool, a venue and a
schedule.

So build **one** seam now and nothing else:

> Derive the rider-pool query and the lock key from a single `dispatchScope`
> value. Today it is a constant. Later it is `locationId`.

That converts two known blockers from rewrites into one-line changes:

| Roadmap item | Today | Later |
|---|---|---|
| B2 — `system/rideContext` is one document platform-wide | one doc | per location |
| B6 — rides query has no location filter | unfiltered | `where('locationId','==',scope)` |
| Global lock `system/assignmentLock` | one doc | per scope |

**Not doing now:** tenancy itself, geohash indexing, per-city locks, or the
N+1 at `:597`. They are recorded below so they are not rediscovered.

### Deferred scaling notes (do not action yet)

- `LOCK_DOC = 'system/assignmentLock'` is a single global document with a 10s TTL.
  Fine for one location; a hard ceiling once cities exist.
- `:172` reads the entire `vehicles` collection every tap; `:190` reads every
  `requested` ride; `:274` reads every available driver; `:597` is an N+1 per
  student. All bounded and cheap at 3 cars, none of them acceptable at 5K users.
- Seed-and-grow helps here regardless: it needs the seed's neighbourhood, not a
  full clustering pass, so it is the version that survives a geohash index later.

---

## Files affected

| File | Change |
|---|---|
| `functions/src/http/globalAssignDriver.ts` | Seed-and-grow replaces k-means; event filter; `dispatchScope` seam |
| `functions/src/utils/clustering.ts` | Largely deleted; keep only what seed-and-grow needs |
| `functions/src/utils/seats.ts` | Unchanged — `fillBySeats` / `remaindersFirst` still apply |
| `functions/src/utils/routing.ts` | Unchanged |
| `functions/src/http/adminDeleteUser.ts` | Release by `assignedDriverId` |
| `functions/src/http/releaseVehicle.ts` *(new)* | Manager release, guarded + audited |
| `functions/src/scheduled/` *(new)* | Idle-vehicle sweep |
| `functions/src/utils/fleet.ts` | Shared `releaseVehicleFor(uid)` |
| `components/manager/VehicleList.tsx` | Release action, holder name, idle badge |
| `components/manager/VehicleForm.tsx` | Update branch must carry `status` |
| `components/manager/FleetManagement.tsx` | Split the In Use count |
| `components/manager/ManagerDashboard.tsx` | "N drivers"; empty-fleet warning; past-event filter |
| `scripts/` *(new)* | Phase 0 repair, dry-run first |
| `firestore.rules` | **No change** — `:439` already permits manager vehicle updates |

## Tests

- **Seed choice:** farthest-from-venue is seeded first; a long-queued near rider
  escalates ahead of it.
- **Grow:** fills to exactly the car's passenger seats; never exceeds; respects
  `allowSplit`; remainders before fresh requests.
- **Event filter:** a `requested` ride for a past `eventId` is **never** dispatched.
  (Fails today.)
- **Release loop:** released riders return to the pool and are picked up by the
  next tap — the flow described in the request.
- **No double-commit:** two concurrent taps cannot assign the same rider.
- `adminDeleteUser`: releases the held vehicle in both collections; does not
  delete the vehicle document.
- Sweep: releases idle held cars; **never** one with a live ride.
- `releaseVehicle`: non-manager and revoked-manager rejected; audit row written.
- Regression: zero available cars → the picker explains itself rather than
  rendering blank.

## Verification

Add a sabha → free the cars → driver picks one → Assign me → confirm the carload
is the far group and seats are respected → release → confirm riders requeue →
second tap picks them up → accept → check manager dashboard and rider screen →
flip to drop-off → ready to leave → assign → complete → car returns to
`available`.

Full sweep, then `git log --oneline HEAD..main`, then rules → functions → hosting.

---

## Phasing

| Phase | Work | Gate |
|---|---|---|
| **0** | Add a sabha; dry-run repair; delete the 3 orphan rides | Nothing testable until cars are free and a window exists |
| **1** | Event filter + `adminDeleteUser` + sweep | Stops the leaks |
| **2** | Seed-and-grow | The core change |
| **3** | Manager release control + `VehicleForm` fix | Operational escape hatch |
| **4** | Honest labels and counts | Cosmetic but it is what caused the report |

## Still open

**Return-run objective.** Recommending *minimise time until the last rider is
home* rather than total distance — farthest-first seeding already delivers it, so
this is a confirmation rather than extra work. Total-distance would permit one car
doing a 20-mile scatter while another does 2 miles.
