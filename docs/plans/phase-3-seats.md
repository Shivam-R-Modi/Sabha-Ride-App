# Phase 3 (part 1): seat-aware rides, with sequential splitting

> **Status: Stage 1 and Stage 2 are built, tested and deployed** (`e599c6d`,
> `76c087d`). Kept as the record of *why* the design is shaped this way, and of
> the alternatives that were rejected — read it before changing seat handling.
> Current state of the project: [`../STATUS.md`](../STATUS.md).

## Context

Every ride request in this app is **exactly one seat**. A family of four requests
a ride and the system books them one place; the driver arrives with room for one.

The roadmap calls this B8 and cites `vrpSolver.ts` — **that file does not exist**.
The real seat cap is `sortedStudents.slice(0, availableSeats)` in
`functions/src/http/globalAssignDriver.ts:296`, over a list where each entry is
one person. The same head-count-as-seat-count assumption appears in three more
places (`manualAssignStudent.ts:90`, `completeRide.ts:180`,
`components/driver/AssignmentPreview.tsx:152`).

**Measured, not assumed:** production has **2 vehicles, both capacity 4** — 3
passenger seats each once the driver is seated, 6 in the whole fleet. So *any
group of 4 or more can never fit in one car today.* Splitting is not an edge case
here; it is the common case for a family.

### The approach, and why this one

Splitting a group across cars sounds like it needs a central dispatcher deciding
two drivers at once — which this app cannot do, because dispatch is **driver-pull**
(`globalAssignDriver` fires on one driver's "Assign Me" tap and has no authority
over anyone else). That would make it Phase 4 work.

The user's proposal avoids that entirely: **fill sequentially.** The first driver
takes what fits, the remainder goes back in the waiting pool, the next driver who
taps picks it up. No tap ever commits a second driver. Nobody is worse off than
today — a group of 6 currently gets 1 seat; here they get 3 now and 3 shortly after.

It also dissolves the blocking code problem. Two ride documents would normally
break dispatch, which de-duplicates by rider
(`globalAssignDriver.ts:197`) — but dispatch only queries `status == 'requested'`
(`:178`), and after a split exactly **one** document per rider is `requested`
(the remainder). The de-dupe never sees a conflict.

### Model decision: split the document, don't multi-driver it

Rejected: one ride document part-filled by several drivers
(`assignments: [{driverId, seats}]`). One ride = one `driverId` is assumed by the
driver dashboard, `releaseAssignment`, `completeRide`, `manualAssignStudent`,
`startRide` and `firestore.rules`. Splitting into sibling documents keeps every
one of those working untouched.

### Scope

Seats only. **Who** the extra passengers are — dependents, guests, guardians — is
deliberately not modelled (it needs the consent/minors question in roadmap §8 Q3
answered first). A consequence to hold onto: the app cannot know which person is
in which car, so **it must never choose**. It says "3 seats"; the family decides
who gets in.

---

## Stage 1 — seats (shippable alone)

### 1.1 The field
`seatsRequested: number` on a `rides` document. **Missing means 1** — every
historical ride and every code path defaults with `?? 1`, so behaviour with no
new data is byte-identical to today. No backfill; the default is the migration,
and it gets its own test.

Constants in a new `functions/src/constants/seats.ts` + `src/constants/seats.ts`
twin (mirrors the existing `constants/tenancy.ts` pair): `MIN_SEATS = 1`,
`MAX_SEATS = 8`, `DEFAULT_SEATS = 1`.

### 1.2 Seat-aware fill — new pure module
`functions/src/utils/seats.ts`, unit-tested, following the existing pure-util +
`.test.ts` pattern (`clustering.ts`, `routing.ts`, `roles.ts`):

```ts
fillBySeats(candidates, freeSeats, maxFleetSeats)
  -> { taken: Array<{ id, seats }>, skipped: Array<{ id, seats, reason }> }
```

Rules, in order:
- Walk candidates in the caller's order (already distance-sorted).
- A request that fits whole → take it.
- A request larger than `freeSeats` **but** that some vehicle in the fleet could
  carry whole → **skip**, reason `'waiting-for-bigger-vehicle'`. This is the
  user's "pass it first, that's fine."
- A request larger than **any** vehicle in the fleet → it can never travel in one
  car, so partial-fill it now, reason `'split'`. This is the "no big cars at all"
  case — and with today's fleet it is every group of 4+.

`maxFleetSeats` is read from the `vehicles` collection at dispatch time
(`max(capacity) - 1`), not cached — a stale value would silently mis-split.

### 1.3 Dispatch
`globalAssignDriver.ts`: carry `seatsRequested` into the student map (~:198),
replace the `slice(0, availableSeats)` at :296 with `fillBySeats(...)`, and write
the seat count onto each assigned ride. Return `skipped` in the response so the
tapping driver learns *why* a nearer group was passed over.

`manualAssignStudent.ts:88-95`: capacity check sums seats instead of counting
entries.

### 1.4 The other three head-counts
- `completeRide.ts:108` — driver's `totalStudentsToday` adds seats.
- `completeRide.ts:180` — statistics `totalStudents` sums seats; the per-student
  stats entry gains `seats`. Attendance still de-duplicates by rider id, so one
  account is one attendee carrying N seats.
- `AssignmentPreview.tsx:152` — the driver's `3/4` becomes seats over seats.

### 1.5 Return leg
`studentReadyToLeave.ts:139` creates the drop-off request and would default to 1.
It must carry `seatsRequested` from the rider's completed outbound ride, or the
family of six gets one seat home.

### 1.6 Rider input
`PickupForm.tsx` — a seat stepper ("How many of you?", 1–8, default 1) written
through `createRideRequest` (`hooks/useRides.ts:122`).

Plus the **"keep us together"** toggle (default off = allow splitting). Small, and
it turns the one uncomfortable case — a family separated against their wishes —
into their own decision rather than the algorithm's. Sets `allowSplit: false`,
which `fillBySeats` honours by skipping instead of partial-filling.

### 1.7 Rules
`firestore.rules`, `rides` block:
- `allow create` gains: `seatsRequested is int && >= 1 && <= 8` (and absent is OK).
- `touchesRideServerFields()` gains `seatsRequested`, `groupId`,
  `groupSeatsTotal`, `splitFromRideId` — so a rider cannot inflate their seat
  count after assignment. *Limitation to accept:* they also cannot edit it while
  still waiting; they cancel and re-request. Simpler and safer than a
  status-dependent rule.

### 1.8 Manager visibility — the anti-silent-failure piece
`RequestTable.tsx` + its source (`hooks/useUsers.ts:88`) gain a seats column and
a reason badge: *"needs 4 seats — no free vehicle that large."* Without this a
large group is passed over by every driver in silence, which is precisely the
failure class Phase 1 existed to remove.

---

## Stage 2 — sequential splitting

### 2.1 The split write
When `fillBySeats` returns a `split` entry, `globalAssignDriver` (inside the
existing batch) does two things:
- the original document becomes the assigned share — `seatsRequested` reduced to
  what was taken, plus `groupId` (new id), `groupSeatsTotal` (the original ask);
- a **new** `rides` document holds the remainder — `status: 'requested'`, same
  `studentId`, same `groupId`/`groupSeatsTotal`, plus `splitFromRideId`, and the
  same pickup coordinates, `eventDate`, `cityId`/`locationId`.

### 2.2 Leftovers go first
Sort candidates with `groupId`-bearing remainders ahead of distance order.
Without this, starting to serve a family pushes them back into distance
competition and they can wait *longer* than a group nobody touched.

### 2.3 The rider must see both halves
`useActiveRide` (`hooks/useRides.ts:44`) takes the single newest active ride, so a
part-served group would see one card that looks fully sorted. It returns the full
set; `StudentDashboard.tsx:171` renders "3 of your 6 seats are with Ravi — 3 still
waiting."

### 2.4 The driver must know it is a partial group
Otherwise driver A collects 3 people, sees a full car and drives off while 3 stand
at the same address. `AssignmentPreview.tsx` shows "3 of 6 from this address —
another car is coming."

### 2.5 Completion waits for the whole group
`completeRide.ts:130` sets the rider `at_sabha` / `home_safe`. With a split, that
would fire while half the family is still waiting. Only advance the rider's status
once every sibling in the `groupId` has completed; otherwise leave it and let the
remaining leg finish. Statistics still record each completed leg's seats.

*Accepted limitation:* `releaseAssignment.ts` returns a released share to the pool
as its own request without re-merging with its sibling. Harmless — it is simply a
smaller waiting request — and worth a comment rather than a merge routine.

---

## Verification

Per project convention (`CLAUDE.md`), the existing suites are the standing ask and
each defect gets a named test.

**New tests**
- `functions/src/utils/seats.test.ts` — fits whole; skips when a bigger vehicle
  exists; splits when none does; respects `allowSplit: false`; **missing
  `seatsRequested` behaves exactly as 1**; leftovers sort first.
- `globalAssignDriver.test.ts` — extend the existing fake-Firestore harness
  (it already records `batch.update` payloads and `where()` clauses): a 6-seat
  request against a 4-capacity car writes an assigned 3-seat doc **and** a
  `requested` 3-seat sibling; a rider with a split has exactly one `requested`
  document, so the de-dupe at `:197` cannot drop the remainder.
- `tests/rules/firestore.rules.test.ts` — a rider cannot create with
  `seatsRequested: 99`; cannot raise it after create.

**Full sweep** (root `npm test` is watch mode and hangs — use `npx vitest run`):
`npx vitest run` · `npm test` in `functions/` · `npm run test:rules` ·
`npm run build` · `npm run typecheck` (clean baseline is **22** pre-existing errors).

**End-to-end before deploy**, in the emulator: request 6 seats → confirm the
manager's queue shows the seat count → tap Assign Me on a 4-seat car → confirm 3
assigned and a 3-seat request still waiting → tap as a second driver → confirm the
remainder is picked up first and the rider's card shows both halves.

**Deploy order** (`CLAUDE.md`): rules → functions → hosting, then fast-forward
`main`. Verify hosting by matching the live bundle filename after clearing the
service worker.

## Out of scope, deliberately

- Who the passengers are (dependents, guests, guardians) — needs roadmap §8 Q3.
- Multi-car allocation decided in one pass — genuinely Phase 4, needs server-side
  dispatch.
- `cityId` filtering — Phase 2, gated on `node scripts/tenancy.cjs verify`.
