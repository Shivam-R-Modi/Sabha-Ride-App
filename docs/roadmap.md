# Roadmap: single location → national multi-location platform

Consolidated plan from the design sessions. Supersedes the scattered notes in
chat. Compliance detail lives in [`compliance/`](compliance/); this document is
the architecture and delivery sequence.

---

## 0. Reconciled against the code, 2026-09-07

**Phase 7 shipped — two halls run concurrently in production — and building it
overturned parts of this document.** Read this section before planning from any
other one.

The divergences are deliberate and each is argued where it happened; they are recorded
here rather than quietly rewritten, because the reasoning is the useful part.

| This document specified | What actually shipped | Why |
|---|---|---|
| `locations/{id}/events/{eventId}` | flat `events/{YYYY-MM-DD}`, or `events/{YYYY-MM-DD}__{locationId}` for any non-founding hall | The founding hall keeps its bare key, so every `events`, `weeklyAttendance` and `statistics` record ever written needed **no migration** — and no backfill touching records that name children. `recursiveDelete` also stays legal for a per-hall cancellation, which a nested-plus-filter model could not do without an equality filter on a field older rows lack. |
| `locations/{id}/rideContext/current` | `system/rideContext`, with a `byLocation` map plus `locationIds` | One document means one write per tick and one listener per client. The top-level fields were kept as a documented **aggregate** so a stale PWA bundle degrades to the founding hall instead of reading `undefined` and rendering "no sabha". |
| `locations/{id}/assignmentLock` | `system/assignmentLock__{locationId}` | A nested path falls **outside the `system/{doc}` rules match** and would be denied. Spelled out at [`globalAssignDriver.ts:43`](../functions/src/http/globalAssignDriver.ts). A map inside one document was rejected too: read-modify-write is not a mutex. |
| **A5** — "events, not a recurrence rule" | a single shared recurrence rule (`daysOfWeek`) plus per-date, per-hall **exception documents** | Reversed by the owner. The rule *is* the schedule — there is no separate real day to check it against — so same evening, same time at both halls costs no configuration, and divergence is an ordinary exception document. |
| **B6** — "scope every query by `locationId`" | **the opposite: never filter a query by hall** | An equality filter on a possibly-absent field returns *silently empty* — "nobody is waiting" on a Friday night. One `where` on a field every document provably carries, then halls filtered in memory. |
| location carries `cityId`, `status`, `safeguarding`, `timeZone` | `{ id, name, venue, active, order }` | Cities do not exist yet, so a silo key with one possible value would be load-bearing for nothing. The rest arrives with the phase that needs it. |

**Also true, and not what the phase table implies:** Phase 7 shipped *before* Phase 2, so
the dependency graph in §5 has been overtaken. Locations are real; **cities are not**, and
`UserRole` is still `'student' | 'driver' | 'manager'` — the four-level hierarchy in A4b is
unbuilt.

**One gap this reconciliation found.** The two-location plan made "never add
`where('locationId', …)` to a query" a non-negotiable safety rule and said it would be
*"Guarded by a new `tests/quality/location-filter-not-in-query.test.ts`"*. **That test was
never written.** The convention holds today by discipline alone, in a repo whose whole test
convention exists because discipline does not survive contact with the next session.

Current authority when this document and the code disagree: **the code wins**, and the
reasoning lives in [`functions/src/utils/locations.ts`](../functions/src/utils/locations.ts)
and `docs/STATUS.md`.

---

## 1. Where we are

The app works and serves **two halls in one city**, concurrently, on the same evening.
Everything above the location — cities, the role hierarchy, cross-city reporting — is
still unbuilt, and much of the app still assumes a single city.

**Already delivered**

| | |
|---|---|
| UI / design system pass | Tokens, accessible colour ramps, 44px targets, layout primitives. Contrast failures 111 → 1. Live on `main`. |
| Tailwind compiled at build time | Was the runtime CDN, which broke offline and shifted the cascade between dev and prod. |
| Env guard | A build with missing Firebase vars now fails instead of silently shipping a blank page. |
| **Stage 0 — schedule timezone** | Server read local rules off a UTC clock, so drop-off rides could never run. Fixed, tested, **merged and deployed to production**. First behavioural confirmation is Friday. |
| **Silent-failure remediation** | The class of bug where UI and data paths look functional, fail silently and log nothing. Persisted navigation URLs, the manager access code out of the bundle, create-time privilege escalation closed, two-drivers-one-car, the dashboard map plotting real positions, dead controls swept, dead code deleted. **Deployed to production.** |
| **Phase 1 — security groundwork** | Closed two live privilege holes, unified the role model, moved manager reads onto custom claims, replaced the shared access code with single-use invites, and stamped tenancy keys. Detail in §10. **Deployed to production.** |
| **Phase 5 — events model + schedule UI** | Each sabha is now a record with its own date, times, venue override, agenda and status. Managers get a Sabha Calendar: move a sabha, cancel one, add a one-off. Ride windows and attendance derive from the gathering, not from a hardcoded Friday. Calendar self-populates so it cannot go empty. **Deployed to production.** |
| **Phase 7 — second location, same city** | Two halls run the same evening, each with its own event, ride window, waiting pool, dispatch lock, statistics and cancellation. Riders choose a hall per request; a Sarthi chooses per run; **a car never mixes halls.** Managers add, move, open and close halls from the app. Went live 2026-09-07 with `boston-huntington` and `south-boston`. **Deployed to production; see §0 for how it diverged from this document.** |

**Target state**

**Cities are silos.** Within a city, several locations, each with its own
managers, schedule, venue and vehicle pool. Nothing crosses a city boundary
except a superManager. Across US states and timezones.

Super-managers create cities and appoint city managers; city managers create
locations and appoint location managers; inside a location the app runs as it
does today. Sabha events carry their own date, time, venue and agenda.
Passengers include account holders, guardian-added dependents and vouched
guests. Members select which location they are attending or serving, from a
list their managers maintain.

---

## 2. What blocks a second location

Findings from reading the code, not speculation. Each is a hard blocker.

| # | Blocker | Evidence | Consequence |
|---|---|---|---|
| ~~B1~~ ✅ | ~~Profiles are world-readable to any signed-in account~~ **CLOSED** (`0af2da0`, `a1cd8c2`) | `firestore.rules` now reads `allow read: if isOwner(userId) \|\| isManagerForRead()`, and the `/students` and `/drivers` mirrors carrying the same PII are denied outright | Was: any account reads every name, phone and home address. What remains is **city scoping**, which with one city authorises the identical set of people — it is Phase 8 enforcement groundwork, not a live exposure. |
| ~~B2~~ ◐ | ~~`system/rideContext` is one document platform-wide~~ **CLOSED FOR LOCATIONS** (`633c9cc`, stage B part 3) | Still one document, but it now carries `byLocation` + `locationIds`, and every server reader takes the per-hall branch. Top-level fields remain as a deliberate aggregate for stale bundles | Was: one hall's ride window overwrote the other's. **City scoping is still open** — that is Phase 2. |
| ~~B3~~ ✅ | ~~`system/assignmentLock` is one global mutex, 10s TTL~~ **CLOSED** | Now `system/assignmentLock__{locationId}`, one mutex per hall. Flat rather than nested because a nested path falls outside the `system/{doc}` rules match — [`globalAssignDriver.ts:43`](../functions/src/http/globalAssignDriver.ts) | Was: every driver nationwide serialised through one lock |
| ~~B4~~ ✅ | ~~`settings/main` holds exactly one venue~~ **CLOSED** | Venue resolution is now `event.venue → locations/{id}.venue → settings/main.sabhaLocation`. Each hall carries its own coordinates and managers edit them per hall in `HallManagement` | Was: one destination for all clustering and routing |
| ~~B5~~ ✅ | ~~`settings/managerCode` is one static platform-wide code~~ **CLOSED** (`a941797`, `bcbcce7`) | Replaced by `managerInvites`: single-use, expiring, salted-hashed, naming who issued and who redeemed. The document and its callable are deleted | Was: anyone who learned it became a manager anywhere, forever, and any manager could read the plaintext back out of Firestore |
| B6 | Queries have no **city** filter | `useUsers.ts` still queries `rides` on `status` alone | Every manager streams every ride request in the country. **The location half was answered by rejecting this blocker's premise** (§0): halls are filtered in memory, never in the query, because an equality filter on a possibly-absent field returns silently empty. `isValidPendingRide` refuses a ride naming no hall, so a cross-hall pull fails loudly instead. City scoping stays open. |
| ~~B7~~ ✅ | ~~Dispatch runs in the manager's browser~~ **CLOSED** | `useAutoDispatch` is now an explicit no-op with the post-mortem in its header — it had thrown a `ReferenceError` before assigning anything, and read as success. Assignment is driver-pull through the `globalAssignDriver` Cloud Function, under a per-hall lock | Was: N managers = N competing dispatchers. Server-side **push** dispatch is still Phase 4 |
| ~~B8~~ ✅ | ~~Every request is exactly one seat~~ **CLOSED** 2026-08-15 | `seatsRequested` is carried end to end through `seatsOf()`, and `fillBySeats`/`remaindersFirst` split a group across cars rather than dropping it. `vrpSolver.ts` **no longer exists** — this row's original evidence pointer is dead | Was: a group of three placed in one free seat |
| B9 ◐ | No **role hierarchy** or super-manager in the model | `types.ts` — still `UserRole = 'student' \| 'driver' \| 'manager'`. Tenancy *keys* (`cityId`, `locationId`) are stamped and verified by `scripts/tenancy.cjs`, and `locations` is a real collection with a manager UI | No platform administration, no city or location manager levels. A4b is unbuilt |

---

## 3. Architecture decisions

**A1 — The City is the isolation boundary. The Location is the operational unit.**

*Revised. An earlier version of this document made the Location the tenant and
treated City as grouping metadata. That was wrong: it conflated the isolation
boundary with the dispatch boundary and produced a weaker security model.*

Two levels, each doing one job:

```
Platform  ── superManager only
 └── City (boston)                 ← SILO. Isolation boundary. No data or access
      │                              crosses it except via a superManager.
      ├── Location (huntington)    ← Operational unit. Dispatch, events, vehicles.
      └── Location (lowell)          The app as it works today runs here.
```

Why the split matters:

- **Manager read scope becomes city-bounded**, so no city-level account can
  ever reach a national dataset of families. This is the compliance control, and
  it is structural rather than a filter someone can forget to apply.
- **`superManager` is the only cross-city role** — a small set, MFA-protected,
  fully audited.
- **Cross-city assignment becomes impossible by construction.** A rider in one
  city cannot be pulled into another city's dispatch, because the query cannot
  see them.
- **Rules get simpler and cheaper.** Most checks collapse from "does this
  manager manage this specific location?" to "same city?".

"City" means *an administrative area a superManager defines*, not necessarily a
municipality. A metro area spanning several towns should be one city if one
group of managers runs it. Keeping the label concrete while letting the boundary
be operational avoids boxing anyone in later.

**A2 — `rides` and `users` stay top-level, carrying both `cityId` and `locationId`**, rather
than nested under `locations/`. Collection-group queries get awkward, and a
person moving city shouldn't be re-keyed.

**A3 — Locations are archived, never deleted.** Rides, attendance and audit
records reference them; hard deletion orphans history needed for an incident
enquiry.

*Honoured, by a stricter mechanism than the `status` enum in §4:* `firestore.rules`
denies `delete` on `locations/{id}` outright (`allow delete: if false`), and a hall
is retired by setting `active: false` through the `setLocationActive` callable —
which refuses to close the last open hall, refuses while a Sarthi is mid-route, and
requires an explicit acknowledgement when riders are already booked for it.

**A4 — Managers edit intent; the server derives state and publishes absolute
instants.** Clients compare `now` against ISO timestamps and never compute
day-of-week or hour. This kills the entire class of bug that Stage 0 fixed,
permanently.

```jsonc
// locations/{id}/rideContext/current — derived, function-written, client-read-only
{
  "rideType": "sabha-to-home",
  "windowOpensAt":  "2026-08-08T02:00:00Z",   // absolute — no client math
  "windowClosesAt": "2026-08-08T04:00:00Z",
  "nextWindow": { "rideType": "home-to-sabha", "opensAt": "2026-08-14T19:00:00Z" },
  "venue": { … }, "weekId": "2026-08-07", "scheduleVersion": 7
}
```

`nextWindow` also gives the driver dashboard *"Rides open Friday 3:00 PM"*
instead of today's red error box.

**A4b — Four roles, each scoped to one level of the hierarchy.**

| Role | Scope | Can |
|---|---|---|
| `superManager` | Platform | Create/archive cities, appoint city managers, cross-city reporting. **Not** routine operations |
| `cityManager` | One or more cities | Create/archive locations in their city, appoint location managers, city-wide reporting |
| `locationManager` | One or more locations in one city | Day-to-day operations — exactly what "manager" does today |
| `driver` / `student` | One or more cities; selects a location per event | Request or serve rides |

Today's single `manager` role migrates to `locationManager` of the founding
location. Existing behaviour is preserved; the levels above are new.

**A5 — Events, not a weekly recurrence rule.** ~~Since the day varies and each
sabha has an agenda, model a list of events with "Friday" as a default rather
than a rule. Makes the varying-day case natural instead of an exception.~~

**REVERSED, by the owner.** What shipped is a single shared **recurrence rule**
(`daysOfWeek`) plus per-date, per-hall **exception documents** — and the rule is
not a cached copy of a schedule that lives elsewhere: *the rule **is** the
schedule.* There is no real day to check it against, because the real day is
whatever a manager set.

That inversion is what makes two halls cheap. Same evening, same time at both
costs no configuration at all, because there is one rule and both halls read it.
A per-hall time change or a per-hall cancellation is then an ordinary exception
document, which is a mechanism that already existed. Under a list-of-events model
each hall would have needed its own row for every ordinary week, and two managers
editing one evening would clobber each other's shared defaults.

An exception is a **full snapshot**, not a set of overrides, so the UI never has
to track which fields were touched.

**A6 — Authorisation moves to Firebase custom claims.** `isManager()` currently
calls `getUserData()` — a Firestore read on *every rule evaluation*, billed and
slow. Claims (`token.mgr`, `token.sm`) need no read and scale.

**A7 — Root of trust is control of the Firebase project**, honestly
acknowledged rather than pretended away. Genesis super-manager via a one-off
Admin SDK script; thereafter invitation + two-person rule + floor of two +
mandatory MFA. Detail in [`compliance/ownership-and-handover.md`](compliance/ownership-and-handover.md).

---

## 4. Data model

**This is the TARGET model, and the location-level parts of it are now historical.**
Three paths below were built and rejected for concrete reasons; the shipped shapes are
in §0 and the annotations are inline. The city-level parts are still the plan.

```jsonc
// cities/{cityId}                              ← NOT BUILT. Cities do not exist yet.                              ← the SILO. Isolation boundary.
{
  "name": "Boston",
  "regionId": "northeast",
  "timeZone": "America/New_York",               // default for its locations
  "status": "active",                            // active | paused | archived
  "cityManagerIds": ["…"],
  "createdBy": "<superManagerUid>"
}

// locations/{locationId}                       ← operational unit. BUILT, flat, as
{                                             //   `{ id, name, venue, active, order }`
  "name": "Huntington Ave",                   // ✅ shipped
  "venue": { "lat": 0, "lng": 0, "address": "…" },   // ✅ shipped
  "active": true,                             // ✅ shipped — a BOOLEAN, not the enum below.
                                              //    Not client-writable in either direction;
                                              //    only `setLocationActive` may change it
  "order": 0,                                 // ✅ shipped — display order in the pickers

  // ── none of the following shipped ──
  "cityId": "boston",                            // silo key — waits for cities to exist
  "timeZone": "America/New_York",               // one zone today, read from settings
  "status": "active",                            // superseded by `active` + `allow delete: if false`
  "safeguarding": {
    "preventOneToOneWithMinor": false,           // D4
    "maxGuestsPerRequest": 3,                    // D5
    "requireGuardianForDependents": true         // D3
  }
}

// SHIPPED DIFFERENTLY — flat, and the founding hall keeps its bare key so that no
// events/weeklyAttendance/statistics record ever written needed migrating:
//   events/2026-09-07                      ← the founding hall
//   events/2026-09-07__south-boston        ← every other hall
// Verified: '2026-09-07' < '2026-09-07__south-boston' < '2026-09-08', so the existing
// documentId() range queries and orderBy stay correct. A suffixed id on the EXACT
// horizon day needs a day of slack — `LOOKAHEAD_NEEDS_SLACK`.
// An EXCEPTION id has its own convention: bare = the whole evening, and EVERY hall
// including the founding one is suffixed. `exceptionIdFor`, not `eventIdFor`.
{
  "date": "2026-09-07", "startTime": "19:00", "endTime": "22:00",
  "agenda": "…", "venue": null,
  "status": "scheduled"                          // scheduled | cancelled
}

// SHIPPED DIFFERENTLY — one document with a per-hall map, not one document per hall:
//   system/rideContext { byLocation: { <id>: {…} }, locationIds: […], …aggregate }
// SHIPPED DIFFERENTLY — flat suffixed id, because a nested path falls outside the
// `system/{doc}` rules match and would be denied:
//   system/assignmentLock__{locationId}
// NOT BUILT — invites are still `managerInvites/{code}`, platform-wide (B5 closed there):
// locations/{locationId}/invites/{code}

// users/{uid}
{
  "ageBand": "adult",                            // 'under13'|'13-17'|'adult'  (D2)
  "guardianUid": null,
  "cityMemberships": { "boston": "student", "atlanta": "student" },   // see Q3
  "locationIds": ["boston-huntington", "boston-lowell"],              // selectable, see Q4
  "primaryCityId": "boston",
  "dependents": [ { "id": "d1", "name": "…", "ageBand": "under13" } ],
  "consents": [ { "type": "privacyNotice", "version": "…", "at": "…" } ],
  "vetting": { "status": "approved", "checks": [ … ] }   // drivers (D6)
}

// rides/{rideId}
{
  "cityId": "boston",                             // silo key, checked in rules
  "locationId": "boston-huntington", "eventId": "…",
  "requestedBy": "<uid>",
  "passengers": [
    { "type": "member",    "uid": "u1", "ageBand": "adult" },
    { "type": "dependent", "dependentId": "d1", "guardianUid": "u1" },
    { "type": "guest",     "name": "…", "vouchedBy": "u1" }
  ],
  "seatCount": 3,                                // consumed by the VRP (B8)
  "manifestFrozenAt": null,
  "retainUntil": "2038-06-01T00:00:00Z",         // D7
  "legalHold": false
}
```

---

## 5. Delivery phases

Sizes are relative (S/M/L/XL), not estimates.

| Phase | What | Fixes | Size | User-visible? |
|---|---|---|---|---|
| **0** ✅ | Schedule timezone | — | S | No (fixes Friday) |
| **1** ✅ | **Security groundwork.** Delivered: caller identity on `globalAssignDriver`; one shared manager check; audit log unified and append-only; one role model; custom claims for reads; single-use manager invites; `cityId`/`locationId` stamped and verified. **No `where('cityId', …)` — that is Phase 2.** | B1, B5 | M | No |
| **2** ◐ | **Introduce cities + locations.** **The `locations` half is DONE** — the collection, per-location rideContext slice, per-location lock and per-hall venue all shipped with Phase 7. **`cities` is untouched**, and so is `where('cityId', …)` on any query. Note the location half did *not* scope queries by hall: see §0 | B3, B4; B2 partly | L → M remaining | No |
| **3** ◐ | **Passenger model.** Dependents, guests, manifests, seat-aware VRP. Seat-aware requesting shipped 2026-08-15, so **B8 is closed**; naming individual passengers is what remains, and it is **unblocked** as of 2026-08-21 (A10). The largest user-visible item still open | ~~B8~~ | M | **Yes** |
| **4** ◐ | **Server-side dispatch.** The browser dispatcher is already **disabled** and assignment is driver-pull through `globalAssignDriver`, per hall, under a lock — so B7 is closed. What remains is genuine server-side **push**: deciding and assigning without a Sarthi tapping. The manager-side `previewCarloads` already runs the real algorithm on the server, read-only, which is the seam to build on | ~~B7~~ | L remaining | No |
| **5** ✅ | **Events model + manager schedule UI.** Date, start/end, agenda, venue, cancellations. Built on a shared recurrence rule plus exception documents, **not** the list-of-events A5 specified — see §0 | — | L | **Yes** |
| **6** | **Super-manager + city-manager consoles.** Create/archive cities and locations, appoint managers at both levels, invites, governance, reporting | B9 | L | **Yes** |
| **7** ✅ | **Second location, same city.** Concurrent venues, per-hall event/window/pool/lock/statistics/cancellation, rider picker, per-run Sarthi picker, manager hall management. Live 2026-09-07. **Shipped ahead of Phase 2** — the dependency graph below is overtaken | B2 (locations), B3, B4 | M | **Yes** |
| **8** | **Second city.** First real test of the silo. Retention jobs, DSAR tooling, multi-timezone | — | L | **Yes** |

### Dependencies

**This graph was wrong, and Phase 7 is the proof.** Kept for the record, with the
actual order underneath.

```
AS PLANNED
1 (security) ──→ 2 (tenancy) ──→ 4 (dispatch) ──→ 7 (2nd location) ──→ 8 (multi-city)

AS BUILT
1 ✅ ──→ 5 ✅ ──→ 7 ✅ ──→ ? 2 (cities) / 3 (passengers) / 4 (push dispatch) / 6
         └─ Phase 2's `locations` half came along with 7; `cities` never started
```

~~**Phase 4 is the single largest item and sits on the critical path.** A
client-side dispatcher replicated across cities will double-assign students to
drivers in the wrong city. It must land before a second location exists.~~

**That constraint was real and it got answered another way.** The client-side
dispatcher was not rewritten into a server-side one before the second hall — it was
**switched off**, and assignment became driver-pull through `globalAssignDriver` under
a per-hall lock. The double-assignment risk the paragraph names is genuinely gone;
Phase 4's *remaining* scope is push dispatch, which is a feature rather than a
prerequisite. **A blocker can be closed by deleting the thing that blocks, not only by
building its replacement** — worth remembering, because this document's critical path
assumed otherwise and would have ordered a year of work around it.

**Phase 3 can run in parallel**: it touches the optimiser, not tenancy. It is also the
only remaining phase users will *see*, so it is the one to pull forward if visible
progress matters.

---

## 6. Recommendation

**Build phases 1–4 inside one city, one location, with nothing else live.**
Every one is cheaper and safer with a single silo's data, and each ships
independently. Then add the second location (phase 7) and the second city
(phase 8) as *tests of work already done*, rather than discovering the gaps in
production with families waiting for rides.

Note the ordering: **second location before second city.** The location is the
operational unit, so a second location exercises dispatch, venue selection and
concurrent events while everything still sits in one silo. Only once that is
sound does the silo boundary itself get tested. Doing it the other way round
means debugging both at once.

**Two things I would not launch a second location without:**

1. **B1** — the `/users` read rule. Today it's survivable because everyone in
   the database is one congregation. The moment a second city's families are in
   the same Firestore, that one line is a national PII exposure covering
   children.
2. **Driver vetting (D6)** — volunteer adults transporting minors with no
   vetting gate in the assignment path.

Both are safeguarding issues, not engineering preferences.

---

## 7. Immediate next actions

| | Action | Owner |
|---|---|---|
| 1 | ~~Deploy Stage 0~~ — **done**, both functions live | — |
| 2 | ~~Merge PR #1~~ — **done** (`8bc06dd`) | — |
| 3 | Send `docs/compliance/` for qualified review — counsel, insurer, safeguarding lead | Owner |
| 4 | ~~Answer Q3 and Q4~~ — **decided**, recorded as A8 and A9 | — |
| 5 | ~~Fix the write-on-read at `DriverDashboard.tsx:133`~~ — **done** | — |
| 6 | ~~Decide the Phase 1 start date~~ — **Phase 1 shipped**, and so have 5 and 7 | — |
| 7 | **Run one real evening across both halls.** Everything is live and every suite is green, but no actual rider has been carried under two halls. Nothing else on this list can tell you what that will | Owner |
| 8 | **Write `tests/quality/location-filter-not-in-query.test.ts`.** The two-location plan made this rule non-negotiable and named this exact guard; it was never written, so the rule holds by discipline alone (§0) | — |
| 9 | Decide what follows: **3** (naming passengers, the visible one), **2** (`cities`), or **4** (push dispatch) | Owner |

---

## 8. Open questions

**Blocking Phase 1**

1. Is the operating entity incorporated, and is it a nonprofit? Affects which
   privacy regimes apply.
2. Who holds the Firebase project Owner role after handover? That's the root of
   trust (A7).

**Decided — the city-silo model (was Q3, Q4)**

**A8 — Silo the data, not the identity.** One auth account per person, with
city memberships. A member who attends two cities has one record; the Atlanta
manager sees their name, phone and pickup address for the ride they requested
*in Atlanta*, and nothing of their Boston history.

Rejected: a separate account per city. It duplicates a person — and for a child
duplicates their record, giving two things to keep accurate and two deletion
targets. Worse for compliance, not better. This is the one place the silo is
deliberately permeable, and it is permeable at the *identity* layer only.

**A9 — Both sides select their location.** In a city with several locations:

- a **rider** picks which location they are *attending* → sets the destination
- a **driver** picks which location they are *serving* → sets the ride pool
  they draw from

Both lists are maintained by that city's managers. Both sides select because
whichever side does not select has to be *inferred* — and that inference is
exactly where cross-location mix-ups would originate.

**Decided — a guest child is never unaccompanied (was Q3)**

**A10, ruled by the owner 2026-08-21.** *"This is never a question, because a
child is always accompanied by the child's parents or guardian or adult. This
responsibility lies on the shoulder of the adult with that child and everyone is
aware of this."*

So there is no consent question to answer and no guardian-accompaniment rule to
extend: **accompaniment is the standing condition**, socially understood in the
congregation, and the accompanying adult carries the duty of care. A guest child
travels as part of the adult who brought them.

What this means for Phase 3, concretely: a named passenger needs **no consent
record, no guardian field and no separate account**. The person who books the
ride is the responsible adult for everyone on it — which is already exactly how
the seat count works today, so the passenger model extends the existing shape
instead of introducing a new one.

**Not to be raised again.** This joins driver vetting as a settled policy
question; both were ruled on by the owner and both sit outside the app. It does
not weaken anything else — the Firestore rules, `assertApprovedManager` and the
audit rows all stand, because those protect the data rather than adjudicate who
may travel.

**Blocking Phase 4**

4. Is there any driver vetting today, even informal? The assignment gate needs
   something to check against.

**Blocking Phase 6**

5. Who may appoint super-managers once the app is handed over — any
   super-manager, or a named trustee group?
6. How many cities and locations realistically, and over what period? Two in Boston next
   quarter is a very different build from thirty nationwide this year — it
   decides whether Phase 4 needs a real queue or a Firestore trigger suffices.

**Deferred but worth an early view**

7. Do vehicles belong to a location or to a driver who may serve several?
8. ~~Should attendance be per-event rather than per-week?~~ **Resolved.**
   Attendance is keyed by `eventId`, which is the gathering's own date, published
   by the server rather than computed from the browser clock. `getCurrentWeekId()`
   is gone. Because eventId equals the date the old code produced whenever the
   device agreed with the server, no historical record was orphaned and no
   migration was needed.

---

## 9. Known limitation: one gathering per date

`events/{YYYY-MM-DD}` uses the date as the document id. Adding the same date
twice edits the existing sabha rather than creating a second one, so **a morning
and an evening sabha on the same day is not supported today.**

Deliberate, not an oversight. Date-as-id buys free chronological ordering, the
"from today onward" query with no extra index, and idempotent auto-creation —
and it means events and attendance share a key, which is why this whole change
needed no migration.

**If it becomes necessary,** the document id is the easy part: keep
`YYYY-MM-DD` for the primary sabha and suffix additional sessions
(`2026-08-07__evening`). That sorts correctly, keeps the range query, and leaves
every existing record untouched. Random ids with a `date` field is the more
normalised model but disconnects attendance history without a backfill.

**The id is not the real work.** The app assumes one gathering at a time in
several places: a rider requesting a ride never chooses which sabha, attendance
is a single yes/no rather than one per session, and the ride window is a single
open/closed state that two same-day sabhas would each need. Making the rider
choose — and having attendance, requests and the driver window follow that
choice — is the actual cost.

~~**Why it is deferred:** nothing breaks today, and Phase 2 re-keys events into
`locations/{id}/events/{eventId}` anyway. Doing the key work now means doing it
twice. Revisit if two sabhas on one day becomes a real plan rather than a
hypothetical.~~

### RESOLVED 2026-09-07 — and by exactly the mechanism this section proposed

Phase 7 needed two gatherings on one date, so the suffix scheme named above got built:
`events/2026-09-07__south-boston` beside the founding hall's bare `events/2026-09-07`.
The deferral reasoning is void — Phase 2 never re-keyed events into a subcollection and
now will not, so the work was done once, not twice.

The "actual cost" this section identified was the right cost, and it is paid: **a rider
chooses which gathering**, the ride window is per-gathering, and requests and dispatch
follow that choice. What a second gathering on one date needs now is a **UI** to create
one — the keys, the resolver fan-out, the per-gathering window and the per-gathering
cancellation all already work for any number of them.

**The one ceiling that remains** is attendance: `weeklyAttendance` is one row per person
per **evening**, so a rider cannot say yes to two gatherings on the same date. Correct
while gatherings are alternative venues for one sabha; it would need splitting if they
became a morning and an evening session somebody might attend both of. Marked in the code
as a known ceiling, not an oversight.

---

## 10. What Phase 1 actually found

Recorded because three of these were not in the plan, and were only found by
measuring production before writing code. Each had been live for months and none
was visible from the running site.

**Any account could dispatch as any driver.** `globalAssignDriver` took `driverId`
from the request body and never compared it to the caller, so a signed-in account
could assign riders to another driver, take their car, overwrite their record and
hold the global assignment lock — under that driver's name, on that driver's
dashboard. Fixed in `0e80419`; the only caller already passed the right value, so
nothing legitimate changed.

**Rejecting a manager did not revoke them.** "Reject" writes `accountStatus` and
leaves `role: 'manager'` in place, and two functions never checked
`accountStatus` — so a revoked manager kept manual assignment and kept the CSV
export of every rider's name, phone and home address. Five hand-written copies of
the manager check existed and no two agreed. `91e678a`.

**The audit log could not show the most destructive action.** `deleteSabhaEvent`
wrote `performedAt` where the console orders by `timestamp`, and Firestore
excludes documents missing the orderBy field — so all five sabha deletions were
absent from the screen while the code looked like it was recording them. Managers
could also delete audit rows, including the record of their own deletion.
`de277c8`.

**Rides were never actually shared between drivers.** The dispatcher seeded its
clustering from `activeRole == 'driver'`, and no account has ever had that value:
`activeRole` is denied to users by `touchesPrivilegeFields()`, so the RoleSwitcher
only changes React state and the stored value stays frozen at signup. The query
returned zero rows every time, every dispatch ran K=1, and one driver was handed
every rider in range instead of the nearest share. The same root cause left the
manager's driver picker empty and the active-drivers tile reading zero.

The fix is worth recording because the obvious one was also wrong: querying
`roles array-contains 'driver'` matched nobody either, since in this congregation
the drivers *are* the managers and their `roles` said `['manager']`. `roles` is now
the granted set — manager implies driver implies student — backfilled and applied
at every write site. `b24351d`.

### The rule this phase kept running into

Every one of these failed **silently**. A query returning an empty list, a guard
whose failure mode is "quietly allow", a log write nobody checks. None produced an
error, and several looked correct in the code.

That is why the tenancy work stops at stamping. `where('cityId', …)` against an
unstamped document does not error — it returns nothing, and no handler runs. The
verifier (`node scripts/tenancy.cjs verify`, exits non-zero) is the gate before any
filter lands in Phase 2, and it is not optional.
