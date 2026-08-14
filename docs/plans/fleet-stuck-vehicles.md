# Fleet: cars stuck "in use", invisible everywhere else

**Reported:** Fleet Management shows cars in use, "Out now" shows nothing, and
those cars do not appear in the driver's car picker.

All three are the same fact seen from three angles, plus one naming problem that
guarantees two screens will disagree forever.

---

## 1. What production actually holds

Read directly from `sabha-ride-app` on 2026-08-14.

### `vehicles` (and `cars`, which agrees exactly — no mirror drift)

| Vehicle | id | status | `assignedDriverId` | Holder exists? |
|---|---|---|---|---|
| Car1 | `XjNGnePmcmZoLSOJRWdq` | `in_use` | `JM8Q2rmtXof09orV323YgXlPvYt1` | ❌ **no user document** |
| Car2 | `bm07C3ImCoMwrDxbqfq5` | `in_use` | `CVMkzaWd…` Tonny Stark | ✅ |
| Car3 | `PLnVRnGyRd4ncg2DpXhF` | `in_use` | `aVW5AmGN…` Shivam Modi | ✅ |

**Zero vehicles are `available`.**

### Rides

Three, and all three are:

```
status: requested   driverId: null   vehicleId: undefined   eventId: 2026-08-09
```

`2026-08-09` is in the past, and there is no scheduled event at all right now.

### Holders

`CVMkzaWd` and `aVW5AmGN` both carry `currentVehicleId` pointing at the car they
hold, so those two are self-consistent — they are simply holding cars while not
driving. `JM8Q2rmt` has no user document at all.

> **Note:** the report said *2* cars in use. Production says **3**. Worth a
> second look at the Fleet screen — if it really renders 2, that is a fourth
> bug, because `FleetManagement.tsx:68` counts `status === 'in_use'` over
> `useVehicles()` and should read 3.

---

## 2. Why each symptom happens

| Symptom | Mechanism |
|---|---|
| Fleet says cars are **in use** | `FleetManagement.tsx:68` counts `vehicles` where `status === 'in_use'`. Three are. Correct. |
| **Out now · 0 cars** | `ManagerDashboard.tsx:211` builds `groupedRides` from active rides **grouped by `driverId`**, and line 218 skips any ride with no driver. All three rides have `driverId: null`. So zero groups. Correct — but it is counting something else entirely. |
| Driver picker is **empty** | `useVehicles.ts:129` queries `where('status', '==', 'available')`. Nothing is available. Correct. |

Every screen is faithfully reporting the data. **The data is wrong, and one of
the labels is wrong.**

---

## 3. Root causes

### A. Deleting a user never releases the car they held — `adminDeleteUser.ts:57`

```ts
batch.delete(db.collection('vehicles').doc(uid));
batch.delete(db.collection('cars').doc(uid));
```

This deletes a vehicle whose **document id is the user's uid**. Vehicles do not
work that way — they have their own ids (`XjNGnePm…`). So for a real fleet these
two lines delete nothing, and the vehicle keeps `assignedDriverId` pointing at a
user who no longer exists.

That is Car1, exactly. **It can never be released**, because every release path
works from the driver's record, and there is no driver record.

This is the priority fix: it is silent, permanent, and it removes a car from a
two-car fleet.

### B. No release when a shift ends without completing rides

Car2 and Car3 are held by people who are not on shift and have no active rides.
The server-side release paths are all correct and all go through
`writeVehicleState(… VEHICLE_RELEASED)`:

| Path | Releases? |
|---|---|
| `driverDoneForToday.ts:60` | ✅ |
| `completeRide.ts:131` | ✅ |
| `releaseAssignment.ts:74` | ✅ |

So a car is only freed if the driver explicitly finishes. Close the tab, lose
the phone, or get deleted, and the car stays held indefinitely. There is no
timeout and no sweep.

### C. A manager cannot free a stuck car from the UI

`VehicleList` offers **Edit** and **Delete** only. `VehicleForm` sets
`status: 'available'` **only on create** (line 100) — the update branch passes
`formData`, which carries no `status`. So editing cannot clear it either.

The only escapes today are deleting and recreating the vehicle, or the raw
Database Console. For an operational problem on a Friday evening, that is not a
usable answer.

Firestore rules already allow it — `firestore.rules:439`,
`allow update: if isManager() || isDriver()` — so this needs **no rules change**.

### D. Two screens say "cars" and mean different things

- Fleet **In Use** = vehicle documents currently held.
- **Out now · N cars** = *distinct drivers with at least one active ride.*

These are different quantities. They agree only when every held car has a driver
with live rides. Any held-but-idle car makes them disagree, and nothing on
either screen explains why. This is the part that made the bug look like a
display fault rather than stale data.

### E. `role` vs `roles`

Every driver in this congregation is stored as `role: 'manager'` with
`roles: ['manager','driver','student']`. There are **zero** users with
`role === 'driver'`.

`useAvailableDrivers` (`useUsers.ts:169`) already handles this correctly with
`where('roles','array-contains','driver')` and returns 5 drivers. **Every other
query that gates on driver-ness needs the same audit** — a `role == 'driver'`
filter anywhere else returns an empty list and looks like "nobody is driving".

---

## 4. The plan

### Phase 0 — repair production (do first, unblocks the fleet)

A one-off script that, for every vehicle with `status === 'in_use'`:

1. Resolve `assignedDriverId`.
2. Release it if **any** of these hold:
   - the user document does not exist (Car1);
   - the user's `currentVehicleId` does not point back at this vehicle;
   - the user holds it but has **no active ride** referencing it.
3. Write through `writeVehicleState(… VEHICLE_RELEASED)` so `vehicles` and
   `cars` stay in step, and clear `DRIVER_VEHICLE_CLEARED` on the holder.
4. Write an audit row per release — this is a manager-visible state change on a
   system that carries children's data, and it should not happen invisibly.

Dry-run mode first, printing what it would do. Expect all three released.

Also delete the three orphan `requested` rides pinned to `2026-08-09`, or leave
them — decide explicitly rather than by omission. They are why "Waiting · 3"
shows a queue for a sabha that already happened.

### Phase 1 — stop it recurring

**`functions/src/http/adminDeleteUser.ts`** — before deleting the user, query
`vehicles` and `cars` for `assignedDriverId == uid` and release each through
`writeVehicleState`. Delete-by-uid on lines 57–58 should go: it has never
matched a real vehicle and it is what disguised the omission.

Also worth checking in the same pass: does deleting a user leave rides,
attendance rows or invites pointing at them? Same class of orphan.

### Phase 2 — give managers a way out

A **Release** action on each in-use vehicle in `VehicleList`, behind the shared
`useConfirm` dialog, naming the holder: *"Release Car1 from Tonny Stark?"*

- Route it through a callable, not a direct client write, so the release is
  atomic across `vehicles` + `cars` + the driver's `currentVehicleId`, is
  `assertApprovedManager`-guarded, and writes an audit row. A client-side write
  cannot clear another user's document under the current rules anyway.
- Show the holder's name on the card whenever `status === 'in_use'`, and mark it
  **"held, no active ride"** when that is true. The screen should explain itself.

### Phase 3 — make the counts honest

- Rename the manager tab from **"Out now · N cars"** to **"Out now · N drivers"**
  — that is what it counts.
- On the Fleet screen, split **In Use** into *driving* vs *held, idle*, or add
  the idle count beside it. Two numbers that can legitimately differ should both
  be on screen.
- Where the fleet is empty of available cars, say so loudly on the manager
  dashboard. Right now a fleet with zero available cars looks identical to a
  quiet evening.

### Phase 4 — audit and prevent

- Grep every query gating on driver-ness for `role == 'driver'` and move it to
  `roles array-contains 'driver'`. `useAvailableDrivers` is already correct;
  confirm the rest.
- A scheduled sweep, daily, releasing any vehicle held with no active ride for
  more than N hours, writing an audit row. This is the backstop that would have
  meant nobody ever saw this bug.
- Consider whether `vehicles` and `cars` can finally be merged. The mirror is
  consistent today, but every write path has to remember both, and
  `fleet.ts` exists solely to paper over it.

---

## 5. Every place this touches

| File | What changes |
|---|---|
| `functions/src/http/adminDeleteUser.ts` | Release by `assignedDriverId`, drop the delete-by-uid lines |
| `functions/src/http/` *(new)* `releaseVehicle.ts` | Manager-triggered release, guarded + audited |
| `functions/src/index.ts` | Export the new callable |
| `functions/src/scheduled/` *(new or existing)* | Daily sweep for idle held vehicles |
| `functions/src/utils/fleet.ts` | Likely a shared `releaseVehicleFor(uid)` helper |
| `components/manager/VehicleList.tsx` | Release action, holder name, "held, idle" badge |
| `components/manager/FleetManagement.tsx` | Split the In Use count |
| `components/manager/VehicleForm.tsx` | Update branch currently drops `status` |
| `components/manager/ManagerDashboard.tsx` | Tab label; empty-fleet warning |
| `src/utils/cloudFunctions.ts` | Client wrapper for the new callable |
| `hooks/useVehicles.ts` | Possibly surface held-but-idle |
| `scripts/` *(new)* | Phase 0 repair, dry-run first |
| `firestore.rules` | **No change needed** — managers may already update vehicles |

## 6. Tests

Following the repo convention — a named test per fixed defect, in the existing
suites.

- `adminDeleteUser`: deleting a user holding a vehicle releases it in **both**
  collections; a user holding nothing is unaffected; the vehicle's own document
  is not deleted.
- `releaseVehicle`: non-manager rejected; revoked manager rejected; releases
  both collections and the holder's `currentVehicleId`; writes an audit row;
  releasing an already-available vehicle is a harmless no-op.
- Sweep: releases a vehicle held with no active ride; **does not** release one
  with a live ride — the case that would strand a driver mid-run.
- `VehicleList`: the Release control appears only for `in_use`, asks for
  confirmation, and calls the callable. (This repo's recurring bug is a control
  that looks wired up and does nothing — assert the call, not the button.)
- Regression: with all vehicles `in_use`, the driver picker is empty **and says
  why** rather than rendering a blank list.

## 7. Verification

- Re-read production: every vehicle either `available`, or `in_use` with a
  holder who exists and has a live ride.
- Driver picker offers cars again.
- Fleet counts and the Out now tab tell a consistent story.
- Full sweep, then deploy **rules → functions → hosting**, and check
  `git log --oneline HEAD..main` first.

---

## Open questions

1. **Fleet showed 2, production says 3.** Which is on screen now?
2. **The three orphan `requested` rides for 2026-08-09** — delete, or keep as a
   record? They are the "Waiting · 3" queue for a past sabha.
3. **Sweep threshold.** How long may a car sit held with no active ride before it
   is auto-released? End of the sabha day is the obvious answer.
4. Is `JM8Q2rmt` a deliberately deleted account, or did something else remove it?
   Worth knowing whether the delete path ran at all.
