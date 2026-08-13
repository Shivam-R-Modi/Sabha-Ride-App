# Where this project is right now

**Handover note between machines.** Read it at the start of a session; update it
at the end. Last updated **2026-08-13**, at commit `8dd800e`.

`main` matches production exactly. Working tree clean, everything pushed.

---

## Live in production

| | Deployed | Notes |
|---|---|---|
| Firestore rules | ✅ | seat validation, server-owned group keys |
| Cloud Functions | ✅ | all 16 updated |
| Hosting | ✅ | bundle `index-C0uXLQUY.js`, verified live |

Staging hosting is also current, bundle `index-Dd8Qyt_H.js`.

**Test suites, all green:** `functions` **245** · client **85** · rules **81** —
**411 total**. `npm run typecheck` reports **22** errors, which is the clean
baseline, not a regression.

> Measure typecheck from this checkout, not from a `git worktree`. A worktree
> resolves `functions/` imports differently and reports **58** — the extra 36 are
> all `Cannot find module 'firebase-functions'`, not a regression. `npm run build`
> cannot run in a worktree at all: `.env.local` is gitignored and never copied
> there.

`node scripts/tenancy.cjs verify` reads **0 unstamped** (owner's Mac only — needs
the Admin SDK key).

---

## What was just finished: the Settings sabha times reached nothing

**Client-only change. Rules and Functions were not touched, so only hosting was
deployed** — to staging first, then production, both verified by matching the live
bundle filename and grepping the served JS for the new strings.

The manager's Settings screen has a sabha start/end control. It wrote
`sabhaStartTime`/`sabhaEndTime` to `settings/main` and showed a success state. The
Calendar's "Add a sabha" form hardcoded `19:00`/`22:00`, and the only other reader
was `seedFirstEventIfNeeded`, which never runs again once `system/eventGenerator`
is marked. **So on this project, saving those times changed nothing anywhere.**

The control had already been relabelled "Default Start/End" with a note saying it
applied to newly added sabhas. That note was false, which made it worse than an
unlabelled control: it explained behaviour the app did not have. Adding a Friday
in the Calendar ignored the saved defaults completely.

Adding a sabha now prefills from the saved defaults, so the note is true. The
prefill syncs only while the form is closed — an arriving Firestore snapshot must
not overwrite what the manager is typing.

Three more things found on the way:

- Settings validated `end > start` while the Calendar required more than the
  15-minute drop-off lead, so `19:00–19:10` saved cleanly in Settings and then
  blocked the manager in the Calendar. Both now use `isUsableDuration`.
- `PickupForm` printed "Sabha starts at 7:00 PM" from the global default when
  nothing was scheduled, under a heading reading "Not scheduled yet". It now says
  rides cannot be requested. The Confirm button was already disabled; nothing said
  why.
- Both doc comments on those times in `useSettings.ts` were stale, not just the one
  on `updateSabhaTimes`.

Timing policy now lives in `src/constants/schedule.ts`, free of any Firebase
import — a test could not reach it inside a component without initialising
Firebase Auth. `minutesOf` gained the range check its old copy lacked, which had
parsed `"25:99"` to 1599 minutes.

Client suite **70 → 85**. The guard was checked by reintroducing the hardcoded
`19:00`/`22:00`: four cases fail, including the explicit "does not fall back to the
shipped constant" one.

---

## Previously: Phase 3 part 1 — seats

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

- **The sabha calendar may be empty, and Aug 7 has now passed.** The audit log
  showed five Fridays deleted, leaving possibly only Aug 7 — which is in the past
  as of this update. An empty calendar means **rides are closed for everyone**. It
  is surfaced, not silent: the Calendar shows a red "Rides are closed" banner and
  `PickupForm` now says so too. But nobody has verified against production. **Check
  this before the next gathering.**
- **Three UI surfaces have never been seen rendered** — covered by tests and
  confirmed present in the live bundle, but nobody has looked at them in a browser,
  because reaching them needs a sign-in. Rider → *Request Pickup* (seat stepper,
  "Keep us in one car", and the new "no sabha on the calendar" line); Manager →
  **Request Center** (Seats column); Manager → **Sabha Calendar** → *Add a sabha*
  (the new prefill from the Settings defaults). Note that is Request Center, *not*
  Live Operations.

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
