# Where this project is right now

**Handover note between machines.** Read it at the start of a session; update it
at the end. Last updated **2026-08-08**, at commit `76c087d`.

`main` matches production exactly. Working tree clean, everything pushed.

---

## Live in production

| | Deployed | Notes |
|---|---|---|
| Firestore rules | ✅ | seat validation, server-owned group keys |
| Cloud Functions | ✅ | all 16 updated |
| Hosting | ✅ | bundle `index-BZbh6r49.js`, verified live |

**Test suites, all green:** `functions` **245** · client **70** · rules **81** —
**396 total**. `npm run typecheck` reports **22** errors, which is the clean
baseline, not a regression.

`node scripts/tenancy.cjs verify` reads **0 unstamped** (owner's Mac only — needs
the Admin SDK key).

---

## What was just finished: Phase 3 part 1 — seats

Until this shipped, **a ride request WAS one seat**. A family of four was booked a
single place and the driver arrived with room for one. Riders now say how many are
coming, and every capacity check counts people rather than rows.

**The fleet is two cars with 3 passenger seats each** (capacity 4 minus the
driver), measured from production — not assumed. So *any party of 4 or more cannot
fit in one car*, which makes splitting the common case here, not an edge case.

**How splitting works, and why this shape.** Dispatch is *driver-pull*:
`globalAssignDriver` fires on one driver's "Assign Me" tap and has no authority
over any other driver, so no single call can commit two cars. Groups are therefore
filled **sequentially** — this car takes what fits, the remainder goes back into
the pool as an ordinary request for whoever taps next. A group too big for this
car but small enough for *some* vehicle in the fleet is passed over rather than
split, so they can travel together later; splitting is reserved for parties no
vehicle could ever carry whole.

Design notes worth keeping in mind before changing any of it:

- `seatsRequested` is **optional, and absent means one**. That default *is* the
  migration — no backfill was needed and no half-stamped window exists. Read it
  through `seatsOf()` (`src/constants/seats.ts`, mirrored in
  `functions/src/constants/`), never by hand.
- The dispatch pool is keyed by **ride document, not by rider**. It used to
  deduplicate by `studentId`, which silently dropped the remainder of a split.
- Leftovers of a split are offered **first**. Otherwise starting to serve a family
  drops them back into distance competition and they wait longer than a group
  nobody touched.
- A rider is not marked `at_sabha` / `home_safe` until **every leg of their group**
  has completed.

Core logic: `functions/src/utils/seats.ts` (pure, fully unit-tested) and
`functions/src/http/globalAssignDriver.ts`.

Full design and the rejected alternatives: [`plans/phase-3-seats.md`](plans/phase-3-seats.md).

---

## Open items

Nothing is blocked. Nothing is half-finished.

**For the owner, not code:**

- **The sabha calendar may only have Aug 7 left.** The audit log shows five
  Fridays were deleted. Worth checking before the next gathering.
- **Two UI surfaces have never been seen rendered** — they are covered by tests
  and confirmed present in the live bundle, but nobody has looked at them in a
  browser, because reaching them needs a sign-in. Rider → *Request Pickup* (seat
  stepper, "Keep us in one car"); Manager → **Request Center** (Seats column).
  Note that is Request Center, *not* Live Operations.

**Known gap, deliberately not fixed:** bulk-select on the manager's queue exists
only in the desktop table. On a phone the checkboxes and "Assign Bulk" are
unreachable. Pre-existing; not introduced by the seats work.

---

## What comes next

The roadmap is [`roadmap.md`](roadmap.md); §10 records the four production
defects Phase 1 found by measuring rather than reading. Candidates, none started:

| | Phase | Why / why not |
|---|---|---|
| **Phase 3 part 2** | Named passengers — dependents, guests, guardians | **Blocked.** Needs roadmap §8 Q3 answered first: can a guest be a minor, and whose consent covers them? Do not design around this — ask. |
| **Phase 2** | Cities and locations; scope every query by `cityId` | Invisible to users, but the gate before a second venue. **Gated on `node scripts/tenancy.cjs verify` reading zero** — a `cityId` filter against an unstamped document returns nothing rather than erroring, which looks exactly like "no rides tonight". |
| **Phase 4** | Move dispatch out of the manager's browser to the server | Largest item, on the critical path. Two managers with the dashboard open today means two brains assigning the same riders. |

**Flagged, not scheduled:** there is no driver-vetting check anywhere in the
assignment path, and volunteers drive minors. That is a policy decision for the
owner, not an engineering task.

---

## Before starting

Read [`../CLAUDE.md`](../CLAUDE.md) — conventions, the verification sweep, deploy
order, and what a phone session cannot do.

The short version of that last part: **from the Claude mobile app you can read,
edit, test, build, commit and push — you cannot deploy, and you cannot see
production data.** Deploys happen from the owner's Mac, in the order
`firestore:rules → functions → hosting`, then fast-forward `main`.
