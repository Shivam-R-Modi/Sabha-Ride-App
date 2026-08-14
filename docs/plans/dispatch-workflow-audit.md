# The dispatch workflow, end to end — what exists, what is broken, what is missing

Traced against the code and against live production on 2026-08-14. Covers the
outbound run (home → sabha), the return run (sabha → home), and every screen that
should reflect each step.

**Headline:** the pipeline is far more complete than the symptoms suggest.
Clustering, seat-splitting and route optimisation are all built and wired. Almost
nothing in this document is a missing feature. It is **three data blockers, four
real defects, and two places where the code does something different from what
you described.**

---

## 0. Why nothing works *right now*

Three independent blockers, all live:

| # | Blocker | Effect |
|---|---|---|
| 1 | **No scheduled sabha.** `system/rideContext.rideType` is `null` | `globalAssignDriver:126` throws *"No rides are available at this time."* The whole flow is dead at the "Assign me" step, whatever else is fixed |
| 2 | **All 3 cars `in_use`, 0 available** | The driver's car picker (`useVehicles.ts:129` queries `status == 'available'`) is empty. A driver cannot even start |
| 3 | **Car1 orphaned** — held by `JM8Q2rmt`, a uid with no user document | Permanently unavailable; no code path can release it |

Fix order matters: **1 and 2 must clear before any of this can be tested at all.**

---

## 1. Manager adds a vehicle

| | |
|---|---|
| UI | Setup → Fleet → **Add Vehicle** (`FleetManagement.tsx`, `VehicleForm.tsx`) |
| Writes | `createVehicle` (`hooks/useVehicles.ts`) → **both** `vehicles/{id}` and `cars/{id}` |
| Fields | `name`, `color`, `licensePlate`, `capacity`, `status: 'available'` |

**Works.** Two notes:

- 🐛 **`VehicleForm` update branch drops `status`** (`VehicleForm.tsx:~95`): create
  passes `status: 'available'`, update passes bare `formData`. So *editing a
  vehicle cannot clear a stuck `in_use`* — which is why the fleet has no escape
  hatch today.
- ⚠️ The field is **`licensePlate`** on the document, but the client `Driver` type
  and `globalAssignDriver`'s ride snapshot use **`plateNumber`**. The mapping is
  done by hand in at least three places (`assignVehicleToDriver`,
  `globalAssignDriver:463`, `useVehicles` read). Each hand-mapping is a chance to
  drop the plate — and a rider standing on a kerb identifies the car by its plate.

## 2. Driver sees the car and picks it

| | |
|---|---|
| Query | `useAvailableVehicles` → `vehicles where status == 'available'` (`useVehicles.ts:129`) |
| UI | `DriverShift` → "Go on shift" → car picker |
| Writes | `assignVehicleToDriver` (`useVehicles.ts:163`) — **client-side** |

That write sets, in one go:

- vehicle (both collections): `status: 'in_use'`, `assignedDriverId`, `assignedDriverName`
- driver: `currentVehicleId`, `currentVehicleName`, `currentVehiclePlate`,
  `carModel`, `carColor`, `plateNumber`, `capacity`, `status: 'available'`

🔴 **This is the root of the reported confusion.** A car becomes `in_use` **the
moment a driver picks it**, before a single rider is assigned. So:

- Fleet **"In Use"** means *held by a driver*.
- Dashboard **"Out now · N cars"** means *drivers with active rides*
  (`ManagerDashboard.tsx:211`, grouped by `driverId`, skipping rides with none).

They measure different things and **can never agree** while a car is held but
idle — exactly today's state. Neither label says so.

## 3. Driver taps "Find my next riders" → `globalAssignDriver`

The core. 671 lines, and the logic is sound. Sequence:

| Step | Where | What |
|---|---|---|
| Lock | `:160` | One driver commits at a time — this is what stops two cars taking the same rider |
| Ride window | `:121–129` | Reads `system/rideContext`; **throws if `rideType` is null** ← blocker 1 |
| Venue + eventId | `:136–137` | From the same `rideContext` read, so window and venue can never disagree |
| Driver + car | `:142–163` | Car read from `cars`; must be `available` or `in_use`; `resolveVehicleHolder` rejects a car held by someone else |
| Seats in this car | `:166` | `capacity - 1` — the driver occupies one |
| Largest car in fleet | `:172–173` | `maxPassengerSeats` over live `vehicles`. Decides whether an oversized group waits for a bigger car or is split |
| **Clustering** | `:299` | `kMeansWithDriverSeeds(allStudentPoints, driverPoints)` — geographic, seeded on driver locations so a driver gets riders near *them* |
| **Seat fill** | `:343` | `fillBySeats` with `remaindersFirst` — split families are served before fresh requests, so nobody is stranded half-assigned |
| **Route** | `:417` | `optimizeRoute(startPoint, rideStudents, endPoint, rideType)` |
| Write | `:455–530` | Ride docs + driver snapshot + `route` + `googleMapsUrl` + `venue` + `eventId` + `peers` + `students` + `assignedStudentIds` + `seatsRequested` |
| Vehicle | `:562` | `writeVehicleState` — keeps `vehicles`/`cars` in step |

**All of this exists and is tested.** Nothing here needs building.

## 4. Route optimisation — and a mismatch with your description

You said *"it should optimise the route when driver starts the ride."*

**It optimises at assign time, not at start time.** The route and the Google Maps
URL are computed at `:417` and **persisted on the ride document**. `startRide`
(104 lines) does not touch the route at all — it only flips statuses:

- rides → `in_progress`
- driver → `active_ride`
- students → `in_ride`

Assign-time is arguably the better choice: the driver sees the route *before*
committing, and the stored route survives a page reload. There is a comment at
`:420` recording that the URL used to be built after the commit and returned only
in the response, so the button "worked once and was dead from then on".

**Decision needed:** leave it at assign time (recommended, and say so in the UI),
or re-optimise on start to account for riders added or released in between. The
second is a real scenario — `manualAssignStudent` already rebuilds the route for
all passengers when one is added.

## 5. Manager dashboard reflection

| | |
|---|---|
| Query | `useAllActiveRides` |
| Grouping | `ManagerDashboard.tsx:211` by `driverId`; `:218` skips rides with no driver |
| Tabs | "Waiting · N" (unassigned requests) · "Out now · N cars" (driver groups) |

**Works** — but see §2 on the label, and note "Waiting · 3" is currently counting
three orphan `requested` rides pinned to `2026-08-09`, a sabha that already
happened. The dashboard has no notion of "this request is for a past event".

## 6. Student dashboard reflection

| | |
|---|---|
| Query | `useRides.ts:31` — `where('studentId','==',userId)` + `status in [requested, assigned, driver_en_route, arriving, in_progress]` |
| State | `deriveRiderState` (`src/utils/riderState.ts`) → one card, one action |
| Assigned state | `driver-assigned`, with `SplitInfo` when the party was split across cars |

**Works.** Each rider owns their own ride document, so the query is sufficient;
`peers` is display-only. Split parties are handled explicitly — `splitInfo()`
reports assigned vs waiting seats and names the driver.

## 7. The return journey

Symmetric, and it reuses the same machinery.

| Step | Where | Notes |
|---|---|---|
| Window flips to `sabha-to-home` | `updateRideTypeContext` | 15 min before sabha ends (`DROPOFF_LEAD_MINUTES`), or via the manager override |
| Rider taps "I'm ready to leave" | `studentReadyToLeave` | Rejects unless `rideContext.rideType === 'sabha-to-home'` (`:74`) |
| Seats carried forward | `:141–143` | Reuses the **outbound** seat count for this `eventDate`, so a family of 4 does not silently become 1 going home |
| Ride created | `:156–169` | `status: 'requested'`, `rideType: 'sabha-to-home'` |
| Rider marked | `:189` | `status: 'waiting_for_dropoff'` |
| Driver taps again | `globalAssignDriver` | **Same function.** `:410–416` flips `startPoint`/`endPoint`: sabha → driver's home |
| Ride completes | `completeRide` | Releases the vehicle (`:131`) and clears the driver's vehicle fields |

⚠️ `studentReadyToLeave:114` notes it **cannot filter by `rideType` and `status`
in the query** — no composite index on `rides(studentId, rideType, status)` — so
it filters in memory. Fine at this size; it is a scaling ceiling worth recording.

---

## 8. Defects found, ranked

| # | Severity | Defect | Where |
|---|---|---|---|
| 1 | **High** | Deleting a user never releases their vehicle. Deletes `vehicles/{uid}`/`cars/{uid}` — keyed by *user* uid, which no vehicle uses. Orphans the car permanently | `adminDeleteUser.ts:57–58` |
| 2 | **High** | No way for a manager to release a stuck vehicle. Edit drops `status`; only Edit/Delete exist in the list | `VehicleForm.tsx`, `VehicleList.tsx` |
| 3 | Medium | "Out now · N **cars**" counts drivers, not cars. Guarantees disagreement with Fleet "In Use" | `ManagerDashboard.tsx:503` |
| 4 | Medium | Nothing releases a car when a driver simply stops — no timeout, no sweep. Only `driverDoneForToday`, `completeRide`, `releaseAssignment` release, and all need a deliberate action | — |
| 5 | Low | `licensePlate` vs `plateNumber` hand-mapped in ≥3 places | `useVehicles`, `globalAssignDriver:463` |
| 6 | Low | Requests for past events still show in "Waiting" | `ManagerDashboard` |
| 7 | Low | Zero available cars looks identical to a quiet evening on the dashboard | `ManagerDashboard` |

**Not defects — already correct:** clustering, seat splitting, remainders-first
ordering, the assign lock, the vehicle mirror (`vehicles`/`cars` agree exactly
today), `resolveVehicleHolder`, `useAvailableDrivers` using
`roles array-contains 'driver'`, route persistence, return-journey seat carry-over.

---

## 9. The plan

### Phase 0 — unblock (nothing below is testable until this is done)
1. Add a future sabha in Setup → Sabha Calendar.
2. Dry-run repair script: release every `in_use` vehicle whose holder is missing,
   whose `currentVehicleId` disagrees, or who has no active ride. Audit row each.
3. Decide on the 3 orphan `2026-08-09` requests — delete or keep.

### Phase 1 — stop the fleet leaking (defects 1, 4)
- `adminDeleteUser`: query `assignedDriverId == uid` and release properly; drop
  the delete-by-uid lines.
- New scheduled sweep: release any vehicle held with no active ride past the end
  of the sabha day. Must **not** touch a car with a live ride — that would strand
  a driver mid-run, which is the one failure worse than a stuck car.

### Phase 2 — give the manager control (defect 2)
- **Release** action per in-use vehicle, behind `useConfirm`, naming the holder.
- Route through a new callable (`assertApprovedManager` + audit row + atomic
  across `vehicles`/`cars`/driver), not a client write.
- Show the holder's name, and badge **"held, no active ride"** when true.
- Fix the `VehicleForm` update branch so it round-trips `status`.

### Phase 3 — make the screens honest (defects 3, 6, 7)
- "Out now · N **drivers**".
- Fleet: split In Use into *driving* vs *held, idle*.
- Warn on the dashboard when zero cars are available.
- Exclude past-event requests from "Waiting", or label them.

### Phase 4 — tidy (defect 5) and decide §4
- One mapper for vehicle → ride snapshot fields; kill the hand-mapping.
- Decide assign-time vs start-time route optimisation and state it in the UI.
- Consider merging `vehicles` and `cars`; `fleet.ts` exists only to hide the split.

---

## 10. Every file this touches

| File | Change |
|---|---|
| `functions/src/http/adminDeleteUser.ts` | Release by `assignedDriverId` |
| `functions/src/http/releaseVehicle.ts` *(new)* | Manager release, guarded + audited |
| `functions/src/scheduled/` *(new)* | Idle-vehicle sweep |
| `functions/src/utils/fleet.ts` | Shared `releaseVehicleFor(uid)`; vehicle→snapshot mapper |
| `functions/src/index.ts` | Export new callable |
| `components/manager/VehicleList.tsx` | Release action, holder name, idle badge |
| `components/manager/VehicleForm.tsx` | Update branch must carry `status` |
| `components/manager/FleetManagement.tsx` | Split the In Use count |
| `components/manager/ManagerDashboard.tsx` | Tab label, empty-fleet warning, past-event filter |
| `hooks/useVehicles.ts` | Surface held-but-idle; single plate mapping |
| `src/utils/cloudFunctions.ts` | Client wrapper for the callable |
| `scripts/` *(new)* | Phase 0 repair, dry-run first |
| `firestore.rules` | **No change** — `:439` already lets managers update vehicles |

## 11. Tests (repo convention: a named test per fixed defect)

- `adminDeleteUser`: releases a held vehicle in both collections; does not delete
  the vehicle document; a holder-less user is unaffected.
- `releaseVehicle`: non-manager rejected; revoked manager rejected; clears both
  collections and the driver; writes audit; no-op on an already-available car.
- Sweep: releases idle held cars; **never** releases one with a live ride.
- `VehicleForm`: editing an `in_use` vehicle preserves or clears `status`
  deliberately, not by omission.
- `ManagerDashboard`: with cars held but no assigned rides, the fleet warning
  shows and the tab reads *drivers*.
- Regression: with zero available cars the driver picker explains itself rather
  than rendering an empty list.

## 12. Verification

Full sweep, then walk it live: add a sabha → add/free a car → driver picks it →
Assign me → confirm cluster and seat split → start → check manager dashboard and
the rider's screen → flip to drop-off → "I'm ready to leave" → assign → complete
→ confirm the car returns to `available`.

Deploy **rules → functions → hosting**, after `git log --oneline HEAD..main`.

---

## Open decisions

1. Route optimisation: assign-time (current) or re-optimise on start?
2. Sweep threshold — end of sabha day?
3. The 3 orphan `2026-08-09` requests: delete or keep?
4. Should picking a car mark it `in_use`, or should a new `held` status exist so
   `in_use` can mean "carrying passengers"? This is the naming fix at its root,
   and it is a data migration.
