# Roadmap: single location → national multi-location platform

Consolidated plan from the design sessions. Supersedes the scattered notes in
chat. Compliance detail lives in [`compliance/`](compliance/); this document is
the architecture and delivery sequence.

---

## 1. Where we are

The app works and serves **one** location. Everything about it assumes that.

**Already delivered**

| | |
|---|---|
| UI / design system pass | Tokens, accessible colour ramps, 44px targets, layout primitives. Contrast failures 111 → 1. Live on `main`. |
| Tailwind compiled at build time | Was the runtime CDN, which broke offline and shifted the cascade between dev and prod. |
| Env guard | A build with missing Firebase vars now fails instead of silently shipping a blank page. |
| **Stage 0 — schedule timezone** | Server read local rules off a UTC clock, so drop-off rides could never run. Fixed, tested, **merged and deployed to production**. First behavioural confirmation is Friday. |

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
| B1 | Profiles are world-readable to any signed-in account | `firestore.rules` — `match /users/{userId} { allow read: if isAuthenticated() }` | Any account reads every name, phone and home address nationwide. With dependents, that includes children. **The single most serious item here** — and the reason the city silo is a compliance control, not a convenience. |
| B2 | `system/rideContext` is one document platform-wide | `updateRideTypeContext.ts`, `globalAssignDriver.ts` | One city's ride window overwrites another's |
| B3 | `system/assignmentLock` is one global mutex, 10s TTL | `globalAssignDriver.ts:17` | Every driver nationwide serialises through it. Atlanta blocks Boston at 10 PM Friday |
| B4 | `settings/main` holds exactly one venue | `functions/src/utils/settings.ts` | `getSabhaLocation()` returns *the* destination for clustering and routing |
| B5 | `settings/managerCode` is one static platform-wide code | `verifyManagerCode.ts` | Anyone who learns it becomes a manager anywhere |
| B6 | Queries have no location filter | `useUsers.ts:68` — `query(collection(db,'rides'), where('status','==','requested'))` | Every manager streams every ride request in the country, and dispatch can pull a rider from another city |
| B7 | Dispatch runs in the manager's browser | `useAutoDispatch.ts:23` — *"runs in the Manager Dashboard and acts as the Server logic"* | N managers = N brains competing to dispatch the same rides |
| B8 | Every request is exactly one seat | `vrpSolver.ts` — `totalDemand + 1` | A group of three gets placed in one free seat. Breaks the moment guests exist |
| B9 | No tenancy or super-manager in the model | `types.ts` — `UserRole = 'student' \| 'driver' \| 'manager'` | No scoping, no platform administration |

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

**A5 — Events, not a weekly recurrence rule.** Since the day varies and each
sabha has an agenda, model a list of events with "Friday" as a default rather
than a rule. Makes the varying-day case natural instead of an exception.

**A6 — Authorisation moves to Firebase custom claims.** `isManager()` currently
calls `getUserData()` — a Firestore read on *every rule evaluation*, billed and
slow. Claims (`token.mgr`, `token.sm`) need no read and scale.

**A7 — Root of trust is control of the Firebase project**, honestly
acknowledged rather than pretended away. Genesis super-manager via a one-off
Admin SDK script; thereafter invitation + two-person rule + floor of two +
mandatory MFA. Detail in [`compliance/ownership-and-handover.md`](compliance/ownership-and-handover.md).

---

## 4. Data model

```jsonc
// cities/{cityId}                              ← the SILO. Isolation boundary.
{
  "name": "Boston",
  "regionId": "northeast",
  "timeZone": "America/New_York",               // default for its locations
  "status": "active",                            // active | paused | archived
  "cityManagerIds": ["…"],
  "createdBy": "<superManagerUid>"
}

// locations/{locationId}                       ← operational unit inside a city
{
  "name": "Huntington Ave",
  "cityId": "boston",                            // silo key — on every record
  "timeZone": "America/New_York",               // Stage 0 already reads a zone
  "venue": { "lat": 0, "lng": 0, "address": "…", "placeId": "…" },
  "status": "active",                            // active | paused | archived
  "safeguarding": {
    "preventOneToOneWithMinor": false,           // D4 — built, ships disabled
    "maxGuestsPerRequest": 3,                    // D5
    "requireGuardianForDependents": true         // D3
  }
}

// locations/{locationId}/events/{eventId}       ← A5
{
  "date": "2026-08-07", "startsAt": "19:00", "endsAt": "22:00",
  "pickupOpens": "15:00", "dropoffCloses": "23:59",
  "agenda": "…", "venueOverride": null,
  "status": "scheduled"                          // scheduled | cancelled | moved
}

// locations/{locationId}/rideContext/current    ← derived (A4), was system/rideContext
// locations/{locationId}/assignmentLock         ← was ONE global lock (B3)
// locations/{locationId}/invites/{code}         ← replaces settings/managerCode (B5)

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
| **1** | **Security & silo groundwork.** Scope `/users` reads **by city**; custom claims (`city`, `mgr`, `sm`); add `cityId` + `locationId` to `users`/`rides` with a backfill; audit-log skeleton; remove the shared manager code | B1, B5, B9 | M | No |
| **2** | **Introduce cities + locations, one of each live.** `cities` and `locations` collections; per-location rideContext, lock, settings; scope every query by `cityId` | B2, B3, B4, B6 | L | No |
| **3** | **Passenger model.** Dependents, guests, manifests, seat-aware VRP | B8 | M | **Yes** |
| **4** | **Server-side dispatch.** Auto-dispatch out of the browser into a Cloud Function, per location | B7 | XL | No |
| **5** | **Events model + manager schedule UI.** Date, start/end, agenda, venue, cancellations | — | L | **Yes** |
| **6** | **Super-manager + city-manager consoles.** Create/archive cities and locations, appoint managers at both levels, invites, governance, reporting | B9 | L | **Yes** |
| **7** | **Second location, same city.** Concurrent venues, location selection — first real test of the operational unit | — | M | **Yes** |
| **8** | **Second city.** First real test of the silo. Retention jobs, DSAR tooling, multi-timezone | — | L | **Yes** |

### Dependencies

```
0 ✅ ─────────────────────────────────────────────┐
                                                  ↓
1 (security) ──→ 2 (tenancy) ──→ 4 (dispatch) ──→ 7 (2nd location) ──→ 8 (multi-city)
                      │                ↑              ↑
                      └──→ 5 (events) ─┘              │
                                                      │
3 (passengers) ───── independent, can run parallel ───┘
                                                      │
6 (super-manager) ── needs 1+2 ───────────────────────┘
```

**Phase 3 can run in parallel** with 1–2: it touches the optimiser, not
tenancy. It's also the only early phase users will *see*, so it's the one to
pull forward if visible progress matters.

**Phase 4 is the single largest item and sits on the critical path.** A
client-side dispatcher replicated across cities will double-assign students to
drivers in the wrong city. It must land before a second location exists.

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
| 1 | ~~Deploy Stage 0~~ — **done**, both functions live. Confirm behaviour Friday evening | — |
| 2 | ~~Merge PR #1~~ — **done** (`8bc06dd`) | — |
| 3 | Send `docs/compliance/` for qualified review — counsel, insurer, safeguarding lead | Owner |
| 4 | ~~Answer Q3 and Q4~~ — **decided**, recorded as A8 and A9 | — |
| 5 | ~~Fix the write-on-read at `DriverDashboard.tsx:133`~~ — **done**. Test mode can now hold, so the Friday flow is rehearsable on any day | — |
| 6 | Decide the Phase 1 start date | Owner |

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

**Blocking Phase 3**

3. Can a guest be a minor? If yes, whose consent covers them, and does the
   guardian-accompaniment rule extend to them?

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
8. Should attendance be per-event rather than per-week, now that the day can
   move? Attendance is currently keyed off the upcoming Friday's date via
   `getCurrentWeekId()`, so a variable day shifts those keys and can orphan
   already-submitted responses. Likely resolved in Phase 5, but the answer
   changes the migration.
