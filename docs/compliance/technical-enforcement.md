# Technical enforcement — policy to code

> **DRAFT.** See [README](README.md). This is the binding document for
> engineering: every policy clause that the system is responsible for, mapped
> to the field, rule or gate that enforces it. A policy with no row here is not
> enforced by the software.

## 1. Enforcement map

| # | Policy clause | Where it is enforced | Failure mode if missing |
|---|---|---|---|
| D1 | No account under 13 | Signup: age-band selection; Cloud Function refuses to create credentials for `under13`; rule denies `users/{uid}` create where `ageBand == 'under13'` | Direct collection from a child |
| D2 | Age bands only | `ageBand` enum on profile and dependent records; no DOB field exists anywhere | Excess sensitive data |
| D3 | Under-13 travels with an adult | Request time: an under-13 dependent or guest cannot be added unless an accompanying adult is also a passenger. Assignment: manifest re-validated server-side, and the pair is never split across vehicles | Unaccompanied child in a volunteer's car |
| D4 | One-to-one with a minor | `locations/{id}.safeguarding.preventOneToOneWithMinor` — **default false**. When true, assignment rejects a single-`13-17`-passenger manifest in an otherwise empty vehicle | See safeguarding §2 |
| D5 | Max 3 guests; split allowed | Request form caps at 3; Cloud Function re-validates. A group over capacity **may** split across vehicles, but the solver must keep every guardian/under-13 pair together | Group exceeds capacity, or a child is separated from their adult |
| D6 | ~~Driver vetting gate~~ | **Not enforced in the app** — vetting is an external organisational process (owner decision). No `vetting` field is stored | The app cannot evidence vetting was applied; external records are the sole evidence |
| D7 | Retention with tolling for minors | `retainUntil` computed at write time; scheduled purge job honours it; legal hold overrides | Records destroyed while still legally live, or kept forever |
| D8 | Location only during active rides | Tracking starts on ride start, stops on completion; 30-day purge | Continuous surveillance of volunteers |
| D9 | Silo isolation | Custom claims + rules scoped by **`cityId`** (A1). Nothing crosses a city except a superManager | A city-level account reads the national dataset |
| — | Manifest immutability | Manifest frozen at ride start; edits create a revision | Cannot reconstruct who was aboard |
| — | Audit of privileged actions | Cloud Function writes append-only audit entries; clients cannot write them | No accountability for role grants |

## 2. Data model additions

```jsonc
// users/{uid}
{
  "ageBand": "adult",                       // 'under13' | '13-17' | 'adult'  (D2)
  "guardianUid": null,                      // set for 13-17 accounts
  "cityMemberships": { "<cityId>": "student" },   // A8 — identity crosses, data does not
  "locationIds": ["<locationId>"],               // A9 — selectable per event
  "primaryCityId": "<cityId>",
  "dependents": [
    { "id": "d1", "name": "…", "ageBand": "under13" }   // no DOB, no login (D1)
  ],
  "consents": [
    { "type": "privacyNotice", "version": "2026-08-01", "at": "…" }
  ],
  "platformRole": null                      // 'superManager' | null. DENY-ALL for
                                            // client writes; claims synced by a
                                            // trusted trigger only (D12)
}

// locations/{locationId}
{
  "safeguarding": {
    "preventOneToOneWithMinor": false,      // D4 — built, ships disabled
    "maxGuestsPerRequest": 3,               // D5
    "requireGuardianForDependents": true    // D3
  }
}

// rides/{rideId}
{
  "cityId": "<cityId>",                     // silo key, checked first (D9)
  "locationId": "<locationId>",
  "requestedBy": "<uid>",
  "passengers": [
    { "type": "member",    "uid": "u1", "ageBand": "adult" },
    { "type": "dependent", "dependentId": "d1", "guardianUid": "u1", "ageBand": "under13" },
    { "type": "guest",     "name": "…", "phone": "…", "ageBand": "adult", "vouchedBy": "u1" }  // D10
  ],
  "seatCount": 3,                           // = passengers.length, consumed by the VRP
  "manifestFrozenAt": null,
  "retainUntil": "2038-06-01T00:00:00Z",    // D7, computed at write time
  "legalHold": false
}
```

## 3. Security rules — required changes

Current state and what it must become:

```js
// NOW — every authenticated user can read every profile in the system.
match /users/{userId} { allow read: if isAuthenticated(); }

// REQUIRED — self, guardian, a manager of a location they belong to,
// or a super-manager. Nobody else.
match /users/{userId} {
  allow read: if isOwner(userId)
              || isGuardianOf(userId)
              || sharesMyCity(userId)      // the silo boundary (A1)
              || isSuperManager();
}
```

Authorisation should move to **custom claims** (`token.city`, `token.mgr` =
locations managed, `token.sm` = super-manager) rather than `getUserData()`, which costs a
document read on every rule evaluation and does not scale.

`system/rideContext` becomes `locations/{id}/rideContext/current` and must be
**deny-all for clients** — it is derived state, written only by Cloud
Functions.

## 4. Assignment gates

All enforced server-side in the assignment path, in this order. Client-side
checks are for UX only and must be re-validated here:

1. Ride `cityId` matches the driver's city → else reject (D9). **This is the silo check**
2. Ride `locationId` matches the driver's selected location → else reject (A9)
3. Every under-13 passenger has an accompanying adult in the manifest (D3)
4. A group over capacity may split, but a guardian/under-13 pair never separates (D5)
5. If `preventOneToOneWithMinor` — reject a lone `13-17` in an empty vehicle (D4, off by default)

Driver vetting is **not** checked — see D6.

**The VRP solver must consume `seatCount`, not 1.** Today `vrpSolver.ts`
increments `totalDemand + 1` per student. With guests and dependents that
under-counts and will place a group of three into one free seat. This is a
correctness defect the moment the passenger model ships, and it needs tests.

## 5. Scheduled jobs

| Job | Cadence | Does |
|---|---|---|
| Retention purge | Daily | Deletes/anonymises records past `retainUntil`, skipping `legalHold` |
| Location trace purge | Daily | Drops driver traces older than 30 days (D8) |
| Consent version check | On notice change | Flags accounts needing re-consent |

## 6. Audit events

Append-only, written only by Cloud Functions, retained 7 years:

`role.granted` · `role.revoked` · `superManager.invited` · `superManager.accepted` ·
`location.created` · `location.archived` · `schedule.changed` · `incident.reported` · `legalHold.applied` ·
`dataRequest.received` · `dataRequest.fulfilled` · `impersonation.started`

## 7. Sequencing against the delivery phases

| Phase | Enforcement that must land with it |
|---|---|
| 1 — Security | D9 rules, custom claims, audit skeleton |
| 2 — Tenancy | D9 scoping, per-location settings incl. safeguarding block |
| 3 — Passenger model | D2, D3, D5, seat-aware VRP, manifests |
| 4 — Server dispatch | D4 gate (off by default), guardian/under-13 integrity when splitting |
| 5 — Events | Schedule audit events |
| 6 — Super-manager | Role governance, audit, D12 deny-all on `platformRole` |
| 7+ — Multi-location | Retention jobs, D7 tolling, DSAR tooling |

Nothing in phases 1–4 requires legal sign-off to build; they are all
architecture. The clauses needing review (D1, D7, D11) affect *values and
wording*, not structure, so review can run in parallel with the build.
