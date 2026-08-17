# Where this project is right now

**Handover note between machines.** Read it at the start of a session; update it
at the end. Last updated **2026-08-17**.

**A full sabha ran end to end on 2026-08-14 — the first one this app has served
in both directions.** 11 riders out, 4 home, one party of four split across two
cars and reunited correctly. The dispatch overhaul that made that possible is
deployed; see *Shipped 2026-08-14* below, which is the section that matters most
to anyone picking this up.

Since then: the drop-off half was proven end to end, the sabha schedule became a
single repeating rule, and **notifications were dropped from scope** — see
*Notifications are OUT OF SCOPE*, which also records that push has never actually
delivered anything in this app.

The UI/UX redesign and the sabha-times fix are also deployed. The incident note
below is history, kept because its lesson is a standing deploy rule.

## Incident, 2026-08-13 — a fix was reverted in production for ~20 minutes

Two streams of work ran at once and neither knew about the other:

- `main` got `8dd800e`, the Settings sabha-times fix, **and shipped it to
  production** (hosting only).
- The redesign branch was developed and tested independently, never merged with
  `main`, and was then deployed on top.

The redesign branch did not contain `8dd800e`, so deploying it **reverted a live
fix**. Nobody noticed from the deploy output, because every stage reported
success — the deploy was clean; it was the *input* that was stale.

The check that would have caught it is one line, and it was not run:

```bash
git log --oneline HEAD..main
```

Diffing `main..HEAD` to see what was going out was not enough. That answers "what
am I adding" and says nothing about "what am I dropping". **Both directions, every
deploy.** A hosting deploy is a whole-bundle replacement, so anything absent from
the branch is removed from production whether or not it appears in a diff.

Resolved by merging `main` into the branch and redeploying.

## Changed 2026-08-13

- **Staging is gone.** It had a Firestore database and one hosting deploy but
  **no Cloud Functions ever deployed**, so it could not exercise a single
  meaningful path. Nothing was migrated because nothing existed to migrate. One
  project now: `sabha-ride-app`. See [`environments.md`](environments.md).
- **`deploy:prod` no longer ships everything at once.** It was a bare
  `firebase deploy`; now it is build → rules → functions → hosting, with
  `deploy:rules` / `deploy:functions` / `deploy:hosting` runnable alone.
- **Delete protection and point-in-time recovery are ON** in production, both
  off since the database was created in January. Recovery window went from
  1 hour to 7 days.
- **Sign-in screen accessibility fixed** — see Open items; it was the one screen
  the redesign never touched and it had the worst control in the app.
- **The role menu had two bugs, both only visible with the chrome around it** —
  see Open items. A new `chrome` rung was added to the stacking ladder.
- `.claude/launch.json` said the dev server runs on 5173. It runs on **3000**.

---

## Live in production

Last deploy `7e8cc9c`, 2026-08-17. `main` = branch = production.

| | Deployed | Notes |
|---|---|---|
| Firestore rules | ✅ | Unchanged since the redesign |
| Firestore indexes | ✅ | Redeployed |
| Cloud Functions | ✅ | 19 functions. `ensureSabhaEvents` **deleted** — see the rule model below |
| Hosting | ✅ | bundle `index-CgaOikYs.js`, matched against `dist/` and verified live |

**Test suites, all green:** `functions` **493** · client **658** · rules **81** —
**1232 total**.

**Everything in this file is deployed.** No code is waiting for a release — but see
*OPEN BUGS* below for three diagnosed and unfixed defects.

Also shipped 2026-08-17, after the rule model: the drop-off presence check
(`at_sabha` no longer gates a ride home — GPS at 100m, advisory, manual fallback
always offered), `at_sabha` cleared nightly, three `DriverDashboard` blank-screen
branches, the release path split (`handBackVehicle` vs the `managerReleaseVehicle`
callable — a car swap was silently zeroing the driver's day), named checkboxes on
the manager queue (an a11y fix that was also the root cause of a 10% test flake),
the attendance header (`weeklyAttendance` said 4:00 AM for an 11:00 PM sabha),
`editOccurrence` preserving a one-off's kind, and `deleteSabhaEvent` working on a
date with no document.

**A drop-off run completed end to end on 2026-08-17 under the rule model** —
Sabha → Home, 2 people in one car, 2 runs / 4 people on the day. Verified from the
screens and from production reads.

`npm run typecheck` reports **19** errors, all client-side. That is the clean
baseline. It was 22 before this branch; Phase 4 removed three by deleting the
code that held them.

**Corrected 2026-08-13.** This used to say "55 total, of which 19 are outside
`functions/`". The extra 36 were **not real** — they were all
`Cannot find module 'firebase-functions'`, and they appear only because
`functions/node_modules` is gitignored and therefore absent from a fresh
worktree. They vanish after `npm install` inside `functions/`. Nobody should
spend time on them again, and no baseline should be quoted from a worktree that
has not installed them.

> Measure typecheck from this checkout, not from a `git worktree`. A worktree
> resolves `functions/` imports differently and reports **58** — the extra 36 are
> all `Cannot find module 'firebase-functions'`, not a regression. `npm run build`
> cannot run in a worktree at all: `.env.local` is gitignored and never copied
> there.

`node scripts/tenancy.cjs verify` reads **0 unstamped** (owner's Mac only — needs
the Admin SDK key).

**Building in a worktree needs `.env.local`,** which is gitignored and therefore
absent from every `git worktree`. `npm run build` fails there with "Missing
Firebase environment variables" before compiling anything. Copy the file across,
or pass throwaway values to prove compilation — the four variables are only
asserted for presence.

**Deploying from a worktree also needs `npm install` inside `functions/`.**
Same reason — `node_modules` is gitignored. This is not cosmetic: `firebase.json`
runs `tsc` as a functions predeploy hook, so without it the deploy **fails
part-way through**, after rules and indexes have gone out and before functions
and hosting. That happened on 2026-08-13. The failure was safe, because hosting
is last and the half-deployed state was old-client-with-old-backend — which is
exactly why the order is rules → functions → hosting and not one bare
`firebase deploy`.

---

## OPEN BUGS — next session starts here

Three found on 2026-08-17 while hand-testing the drop-off run. All three are
diagnosed; none is fixed. Nothing else is outstanding.

### 1. Two driver screens ignore dark mode

`components/driver/AssignmentPreview.tsx` and
`components/driver/CompletionScreen.tsx` paint their root element with **literal
hex**:

```
bg-gradient-to-br from-[#FAF9F6] to-[#F5F0E8]
```

Hex cannot respond to the theme, so both stay cream while the rest of the app goes
dark. Reported from screenshots, with the sidebar dark and the content light.

`ActiveRide` uses `bg-cream` and is correct — that is why only these two look
wrong. Fix: the same token.

### 2. The colour ratchet does not catch gradient stops

The Phase 6 sweep removed ~200 hardcoded colours and a quality test fails the
build if one returns. It did not catch `from-[#FAF9F6]`, so bug 1 shipped past it.
Extend the check to arbitrary-value classes (`from-[#…]`, `to-[#…]`, `via-[#…]`),
not just `bg-[#…]`. Fixing the two colours without fixing the ratchet leaves the
hole open.

### 3. `surveyTheQueue` is missing the direction filter — MINE

`functions/src/http/driverDoneForToday.ts`. It counts waiting riders with
`rides where status == 'requested'` filtered by **event key only**. It does not
filter by `rideType`.

`globalAssignDriver`'s `isValidPendingRide` filters by **both**. So during the
drop-off window a leftover *pickup* request is counted by the end-shift warning and
correctly ignored by dispatch:

| | event | direction |
|---|---|---|
| "Find my next riders" | ✅ | ✅ → "Nobody is waiting right now" |
| "End my shift" warning | ✅ | ❌ → "1 rider is still waiting" |

Observed with Rebo Fe's stale request: `requested`, `eventDate 2026-08-17`,
**`rideType` absent** (so `home-to-sabha` by the absent-means-default rule) while
the window was `sabha-to-home`.

Fix: apply the same direction check dispatch uses —
`(r.rideType ?? 'home-to-sabha') === rideContext.rideType`. I built that filter for
this exact bug class and then failed to reuse it, which is the fourth time in this
project that two correct halves have disagreed at the join.

**Also worth knowing:** the stale request itself is real and still in production. It
will be closed by `expireStaleRequests` at 03:00 once the gathering is past.

---

## Reading production without guessing

Admin-SDK scripts live in the session scratchpad (regenerate as needed; they are
~20 lines each and not tracked):

| script | what it answers |
|---|---|
| `watch.cjs` | window, fleet, drivers on shift, open rides, rider statuses |
| `rulecheck.cjs` | runs production data through the **deployed** `functions/lib` rule code |
| `cal.cjs` | every events document vs what the calendar computes |
| `drift.cjs` / `ev17.cjs` | rideContext vs weeklyAttendance header |
| `act.cjs <uid> <fn> <json>` | call a callable AS a user, via an admin-minted custom token |

`act.cjs` is how a full ride was driven end to end without touching a password.

---

## Shipped 2026-08-14: the dispatch overhaul

Plans: [`plans/dispatch-workflow-audit.md`](plans/dispatch-workflow-audit.md),
[`plans/dispatch-seed-and-grow.md`](plans/dispatch-seed-and-grow.md),
[`plans/fleet-stuck-vehicles.md`](plans/fleet-stuck-vehicles.md).

Started as "why is Car3 stuck?" and ended as a re-architecture of how riders are
grouped. Everything here is deployed and was exercised by a real sabha the same
evening.

### The model that was wrong, and now is not

**A driver keeps their car all evening.** `completeRide` and `releaseAssignment`
used to release the vehicle on every completed run, which modelled one run as the
end of the driver's relationship with the car. It caused two failures — a race
where "Assign next" saw `currentVehicleId` nulled and demanded a car be picked
again, and worse, another driver could take the car *between runs*. Only
`driverDoneForToday` releases now. Verified in production: one driver did **4
runs, 10 seats, one car, no re-picking**.

**`in_use` means "held by a driver", not "carrying passengers".** A car goes
`in_use` the moment it is picked. Three separate screens implied otherwise.

**Pickup and drop-off are separate pools.** `globalAssignDriver` had no direction
filter, so a leftover pickup request was swept into the drop-off run. Now
`isValidPendingRide` checks both event key and `rideType`; absent `rideType`
means `home-to-sabha`, so no backfill was needed.

### Seed-and-grow replaced k-means

`functions/src/utils/clustering.ts` exported `kMeansClustering` and
`matchClustersToDrivers`, both tested, both **called by nothing**. Deleted (307
lines + 162 of tests).

`functions/src/utils/carload.ts` is the replacement. One tap fills one car:
anchor on a seed rider, grow by proximity, hand ordering to `fillBySeats`. Seed
priority is **remainders → long-waiters (90 min) → farthest from the venue**.

Splitting a party across cars is accepted behaviour — confirmed with the owner:
*"driver will manually make sure that child is not left alone and given
preference with the adult."*

**The return leg is deliberately NOT paired to the outbound driver.** Riders are
matched by home proximity. This looks like a missing feature and is not one — all
cars start at the temple, so grouping by destination is the only thing worth
optimising, and pairing would idle cars and strand riders whose driver went home.
Confirmed with the owner 2026-08-14. Do not "fix" it.

### Security and safety fixes found on the way

- **`globalAssignDriver` never authorised the tapping driver.** A revoked account
  could pull a carload of children's names, phones and addresses. Now
  `assertApprovedDriver`. Note the asymmetry that matters: the manager check uses
  `hasRecordedRole`, the driver check uses `hasGrantedRole`, because every driver
  here is *recorded* as a manager who drives.
- **`adminDeleteUser` deleted `vehicles/{uid}`** — a key no vehicle uses. A
  deleted account's car was unreachable by any code path; one had been stuck for
  nine days. Now `releaseVehiclesHeldBy` queries both halves of the mirror.
- **`driverDoneForToday` now checks the rides, not just `activeRideId`.** That
  pointer names one ride; a carload is several documents, and it had been both
  stale and wrong in production on the same day.
- **`returnStudentToPool` left a dangling `activeRideId`.**

### New escape hatches

| | What |
|---|---|
| `managerReleaseVehicle` | Manager hands a stuck car back. Refuses while the holder has live rides. Audited. |
| `releaseIdleVehicles` | Daily 03:00 sweep. **Never touches a car with a live ride.** Missing `updatedAt` counts as infinitely old — deliberately, or the most stuck cars are the ones it never fixes. |
| `scripts/repair-fleet.cjs` | Dry-run-by-default production repair, three passes. |

### What the live run proved

Read directly from production, not inferred:

| | |
|---|---|
| Pickup rides completed | 11 |
| Drop-off rides completed | 4 |
| Party of 4 split 3+1 | reunited, rider correctly ended `home_safe` |
| Direction filter | no pickup leaked into the drop-off pool |

The split is worth understanding because it looked like a bug at first glance: a
rider had one `completed` drop-off ride and one `requested` one, and sat at
`in_ride` in between. That is `completeRide`'s split-leg guard **working** — it
refuses to mark somebody `home_safe` while a leg is outstanding. It resolved by
itself when the remainder completed.

### A recurring pattern, recorded because it cost time three times

Three separate times a correct helper existed but **nothing proved the caller
invoked it** — `releaseVehiclesHeldBy`, `isDispatchable`, and the seed query's
`accountStatus` clause. Each time the fix was a test asserting *the call*, not
the helper. Testing a helper in isolation says nothing about whether production
reaches it.

Every fix in this section was verified by reverting it and confirming the tests
fail. That is the convention; keep it.

---

## Shipped 2026-08-17: the schedule is a rule

Plan: [`plans/recurring-sabha-rule.md`](plans/recurring-sabha-rule.md).

The recurring sabha is now **one rule that repeats until a manager changes it**,
and `events/{date}` documents are only its exceptions — an edited week, a
cancelled week, or a one-off on a date the rule does not cover.

It replaced a version that MATERIALISED dates: one document per occurrence out to
a chosen horizon, plus a `generatedThrough` high-water mark so a deleted date
could not be recreated. That shipped on the 15th and was the wrong shape — a
weekly sabha is one fact, and 26 near-identical rows made the manager trust that
they were all the same.

**The deletions are the point.** `topUpCalendar`, `advanceWatermark`,
`generatedThrough`, `datesToGenerate`, `weeksAhead` and its three bounds,
`seedFirstEventIfNeeded`, `weeklySlotDate`, `toEvent`, and the whole
`ensureSabhaEvents` nightly job. 121 lines out of `events.ts` alone.

**The resurrection bug class is now structurally impossible** rather than
defended against. The old model needed two guards — the watermark for deletions,
an `occupied` set for cancellations — because it created documents and had to
remember which. Under a rule, "this Friday is cancelled" IS a document and
persists by existing.

`findCurrentEvent` still runs **the same single query**. Worth stating, because
the change sounds like it should cost reads and does not.

**Editing one week affects only that week** — the owner's requirement, and a named
test. Overrides are full snapshots, so an edited week keeps its own time and venue
and does not follow later changes to the rule. The calendar says so, because a
manager cannot infer it.

### The migration hazard, found by running it

`scripts/migrate-recurrence-to-rule.cjs`, dry-run by default. The dry run found
the case that mattered:

```
STAMP  2026-08-17  one-off  (23:00–23:30)  ← would VANISH without this
```

A document written before this model has no `kind`, so it reads as an override —
and an override on a date the rule does not cover is inert. 2026-08-17 is a
Monday and the rule is Fridays, so a gathering visible on the calendar would have
silently disappeared. Both halves are tests: unmigrated off-pattern document
vanishes, same document stamped `one-off` reappears.

Applied the same day: 16 event documents down to 8, 8 generated dates deleted, 2
already-cancelled Fridays left completely alone, 5 past dates kept as history.
Verified afterwards — `rideContext` read `eventId 2026-08-17`, `calendarStatus
ok`, computed from the rule with no stored Friday dates at all.

### The drift guard, and why its first version was worthless

The rule logic exists twice (client and functions have separate tsconfigs and no
shared path), so both sides read `tests/fixtures/recurrence-vectors.json`. If they
disagree, a rider sees one sabha date while dispatch works towards another.

The first version of that guard **passed against a real defect.** It exercised
`effectiveEvent` only through `upcomingOccurrences`, which builds candidates from
the rule plus one-off dates — so an override off the pattern never reached
`effectiveEvent` at all. Deleting the guard inside it left every vector green.
Verified by doing exactly that. `effectiveEvent` now has direct vectors, and the
same deletion fails two cases on both sides.

---

## Notifications are OUT OF SCOPE

A "notify everyone on change" feature was planned on 2026-08-17 — manager-side
checkboxes on Sabha Calendar, Ride Window and Venue, plus a drivers-only one on
Fleet. **The owner dropped it the same day**, explicitly not deferred. Do not
re-raise it.

**But carry this fact forward, because it will mislead somebody otherwise: push
notifications have never worked in this app**, and that is independent of the
dropped feature.

| Measured 2026-08-17 | |
|---|---|
| Users with an `fcmToken` | **0 of 13** |
| Anything that calls `src/utils/fcm.ts` | **nothing** |
| `public/firebase-messaging-sw.js` | **does not exist** |
| VAPID key | read via `process.env` in `fcm.ts`, `undefined` under Vite |

So every `notifyEveryone` call — the ride-window announcement, the sabha-deletion
notice, driver and rider assignment alerts — runs, logs `No push tokens
registered`, and delivers nothing. `src/utils/fcm.ts` and
`src/utils/notifications.ts` are dead code, left in place rather than deleted in
case push is wanted later.

Nothing regressed here; it has always been this way. Just do not assume a
notification reaches anyone.

---

## Superseded: the recurring schedule's first version

Kept because the reasoning explains what the rule model replaced. Written
2026-08-15, deployed, then superseded on the 17th.

Until this, `seedFirstEventIfNeeded` created exactly one gathering on a brand-new
project and never ran again, so every sabha had to be hand-added. The calendar
duly ran dry: measured 2026-08-15, `rideContext` read
`calendarStatus: 'no-scheduled-event'` and nobody could request a ride at all.

A manager now sets the pattern — which day(s), start and end, and how far ahead to
keep the calendar filled (1–26 weeks, default 6). `ensureSabhaEvents` applies it
daily at 03:00, and **saving applies it immediately** so the manager can see it
worked rather than waiting overnight.

**The invariant that governs the whole design: a date the manager removed must
never come back.** An earlier seeder decided whether a slot had been dealt with by
whether a document existed there, so deleting a date erased the evidence and the
per-minute self-heal recreated it inside 60 seconds. Two independent guards now
stand in the way, and `recurrence.test.ts` asserts that **neither alone is
sufficient**:

| Guard | Covers |
|---|---|
| `generatedThrough` high-water mark, forward-only | **deletion** — the document is gone, so nothing else can see it |
| `occupied` set from the events collection | **cancellation** — the document survives as `status: 'cancelled'` |

The watermark is **server-owned and never accepted from a client**. A client that
could roll it back could resurrect every date a manager had deleted; both the
callable and the component are tested against that specifically.

The visible consequence, said in those words in the UI: *changes apply to dates
not on the calendar yet*. A manager who expects editing the pattern to move next
week's sabha would otherwise call the control broken.

### Deployed 2026-08-14 (was in this section)

**1. The last driver out gets warned.** Both drivers tapped "Done for today"
within four minutes of each other; two riders then requested drop-offs with
nobody left who could serve them, and no screen said so.

`driverDoneForToday` now returns `needsConfirmation` — **warn, never block** —
when riders are waiting *and* nobody else holds a car. It releases nothing while
asking; a second call with `acknowledgeWaiting` goes through. A volunteer is
always allowed to go home.

Client side lives in `src/utils/endShift.ts` rather than in the component, because
the dangerous shape is a caller treating `needsConfirmation` as success: it would
show "Shift ended, thank you for driving" while the driver is still on shift
holding a car.

**2. Unserved requests expire.** Nothing ever closed a request no driver
answered. It stayed `requested` for ever — invisible to the next gathering's
dispatch because the event key would not match, and permanently "waiting" on the
rider's record and the manager's board.

`expireStaleRequests` runs daily at 03:00 and only touches requests belonging to a
gathering **strictly in the past** that are still `requested`. Today's queue is
untouchable by construction. An *undateable* request is left alone — unlike a
stranded car, unknown here means "might be real", and guessing wrong cancels
somebody's lift.

New rider status **`missed_ride`** ("No Driver Available"), because `home_safe`
and `waiting_for_dropoff` would both be lies. The ride itself reuses `cancelled`
plus `cancellationReason: 'window-closed'` — every list already filters
`cancelled` out of "ongoing", so no UI changed.

Both were checked by breaking them: 4 test failures for the pair server-side, 5
more for the client sequence.

Both shipped in `bae97ab`, bundle `index-4sizVUkL.js`, and `expireStaleRequests`
was created as a new function.

---

## Shipped: UI/UX optimization

Branch `claude/ride-app-ui-ux-optimization-86f88a`. Plan:
[`plans/ui-ux-optimization.md`](plans/ui-ux-optimization.md).

A full redesign — modern minimalism, liquid glass, a manual day/night switch, and
flows rebuilt around one question per screen. Same brand colours. **Presentation
only: no Cloud Function, no Firestore rule, and no hook data contract changes.**

**All six phases are done.** Client tests went **70 → 417**. Nothing is deployed.

- **Phase 0 — safety net.** Added component rendering to the test suite, which
  the repo did not have: all 70 client tests were pure logic, so nothing
  whatsoever guarded the UI.
- **Phase 1 — tokens and the day/night switch.** Colour now lives in one file,
  `theme.css`, as semantic tokens; every literal in `claymorphism.css` and
  `index.css` is gone. **Light mode is byte-identical** — verified by probing
  computed styles in a browser against the compiled CSS, not by eye. Dark mode
  works, with all nine text roles measured at AA or better in both themes. The
  toggle (Day / Night / Auto) is in Profile.

  Also in Phase 1: pinch-zoom is no longer disabled, which was a straight WCAG
  1.4.4 failure in an app the compliance doc holds to AA.

- **Phase 2 — shared primitives.** All **27 `alert()` calls are gone**, replaced
  by in-app toasts where errors stay put until dismissed. `window.alert` and
  `window.prompt` are now banned by test, alongside `confirm`. A single `Sheet`
  overlay provides the focus trap, scroll lock and Escape handling that none of
  the twelve hand-rolled modals had; the shared confirm dialog is migrated onto
  it, which covers every destructive action in the app. The z-index ladder is
  finally applied — that fixed a real bug where the desktop sidebar drew over
  open modals.

- **Phase 3 — the rider's screens.** The first visible change. Home shows **one
  card with one action** instead of up to five cards and two competing buttons.
  Which card appears is now a pure, tested function rather than early returns
  scattered through the render. The weekly attendance question no longer takes
  over the whole app — it is a card, and saying "not this time" collapses it
  instead of replacing the dashboard. The splash screen stops demanding a tap.

  Two faults were found by *looking* at it, which no test would have caught: the
  driver's name truncated to "Ra…" at phone width, and the ride card's status
  band did not follow the theme. Both fixed.

- **Phase 4 — the driver's screens.** Nine competing blocks became one card and
  one button. The grey "Assign Me" that could never explain itself is gone: with
  no car chosen the button now reads "Pick a car to start" and does that.
  Choosing a car is part of going on shift rather than a separate step. During a
  run the screen takes over the whole display — no nav to tap by accident, and
  no two stacked headers eating the top of the screen.

- **Phase 5 — the manager's screens.** The four unlabelled toolbar icons are
  gone; they were destinations, not controls, and now sit in the nav as
  **Dispatch · People · Reports · Setup · Profile**. The two dispatch tabs stay
  as you asked, with live counts in their labels.

  "Assign" no longer picks a driver for you in silence — it shows who is on
  shift, their car, seats free and runs done today, and warns when a car is too
  small for the party. Bulk select works on a phone now (long-press), closing
  the known gap below. Approvals moved out of the bell-icon modal into their own
  screen. Setup is five named sections instead of one long scroll, with the raw
  database editor tucked inside behind a warning.

  The colour sweep also finished: roughly 200 hardcoded colours are gone from
  every component, and a test now fails the build if one reappears.

- **Phase 6 — the polish pass.** Contrast measured rather than eyeballed:
  `preview/audit.js` walks every piece of text on screen, works out what is
  actually behind it through the glass layers, and checks the ratio. Run over
  three pages in both themes — **zero failures** in all six.

  It found one real bug the token tests could not: a filled "Approve" button put
  white text on the bright success green at 2.28:1. Every status colour now has a
  proper darker step for filled buttons, and that is asserted in tests.

  Touch targets: none below the 44px minimum. Focus rings: none suppressed.
  Perpetual motion removed where it was decoration or, worse, a number a manager
  has to read.

**New: `preview/`.** Renders real screens with real stylesheets, without signing
in — see `preview/vite.config.ts`. It exists because of the note further down that
has stood for months: screens go unlooked-at *because reaching them needs an
account*. Three of the faults fixed above were found this way within a minute
each, and `preview/audit.js` is what measured the contrast.

```
npx vite build --config preview/vite.config.ts
npx vite preview --outDir preview-dist
#   /preview/rider.html   /preview/driver.html   /preview/manager.html
#   add ?theme=dark — do NOT toggle data-theme by hand, see the note in audit.js
```

**Ready to deploy from your Mac.** Before you do:

1. Run the sweep once more there, with the real `.env.local` — a worktree cannot
   build without one.
2. `npm run build`, then check the live bundle filename against
   `dist/assets/index-*.js`. **Unregister the service worker and clear caches
   first**, or you will confirm the previous build.
3. Order is `firestore:rules` → `functions` → `hosting`, then fast-forward
   `main`. Rules and functions are untouched here, so in practice only hosting
   changes — but the order costs nothing.

**Still open, deliberately:** 5 screens keep their own hand-rolled modal
(FleetManagement, VehicleForm, DocumentEditorModal, ForgotPasswordModal, and one
in AssignmentPreview). They work; they just lack the focus trap and Escape
handling `Sheet` provides. A ratchet test stops the count rising.

Decisions taken with the owner, recorded because they went against the
recommendation and the reasoning should not be relitigated from scratch:

- **Glass everywhere**, content cards included — not the chrome-only version that
  was recommended. Delivered under an 88% opacity floor on any surface bearing
  text, so WCAG AA survives it. See §4.2 of the plan.
- **Request Center and Live Operations keep their separate tabs.** The merge was
  declined; live counts in the tab labels reduce the toggling instead.

**Both surfaces this note flagged as "never seen rendered" now have real render
tests** — rider *Request Pickup* (20 tests) and manager *Request Center* (21).
That is not the same as having been looked at: a test proves the seat stepper
counts and files the right payload, it does not prove the screen looks right.
Both still want two minutes in a browser.

---

## Also shipped: the Settings sabha times reached nothing

Developed on `main` in parallel with the redesign, deployed, then accidentally
reverted by the redesign deploy, then restored by merging `main` into the branch.
See the incident note at the top.

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

The guard was checked by reintroducing the hardcoded `19:00`/`22:00`: four cases
fail, including the explicit "does not fall back to the shipped constant" one.

---

## What was previously finished: Phase 3 part 1 — seats

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

**Superseded 2026-08-14 — a real sabha has now been walked end to end**, in both
directions, with real accounts on real devices: request → assign → start →
complete → next carload → drop-off → done for today. This entry used to say no
human had done that. `plans/testing-plan.md` Suite A remains useful as a script,
but it is no longer the blocking gap it was.

Still unseen by anyone: how it behaves **in a dark car park on mobile data**, and
whether the manager's dispatch flow holds up at speed with more than two drivers.

### Known blank-screen branches — not yet fixed

`DriverDashboard` has three `return null` branches: `preview` without
`pendingAssignment`, `active` without `activeRide`, `completed` without stats.
Each renders a **blank page with no way back**. Flagged three times across
sessions and deferred each time. It is the same "silently does nothing" family
this codebase keeps removing, and it is the oldest outstanding one.

### Duplicate release paths

Client-side `releaseVehicle` in `hooks/useVehicles.ts` (used by the
ManagerDashboard hard-release) writes directly and does **not** clear
`activeRideId` or refuse on live rides. The `managerReleaseVehicle` callable does
both. Two paths, one of them weaker. Worth collapsing.

### Deferred scaling ceilings

Recorded, not actioned, all fine at three cars and blocking at five thousand
users: a single global `system/assignmentLock`; three unbounded collection reads
per tap; an N+1 at `globalAssignDriver:597`; `licensePlate` vs `plateNumber`
hand-mapped in three or more places. Multi-city tenancy is deferred by the owner,
with one `dispatchScope` seam noted in the plan.

`OmWatermark` renders `null` and is still imported and rendered in `App.tsx`.

**Fixed 2026-08-13 — the sign-in screen.** The redesign covered rider, driver and
manager and never touched auth, so the screen every user reaches first kept the
worst controls in the app. Running `preview/audit.js` against the real dev server
rather than the preview pages found three:

| Control | Was | Now |
|---|---|---|
| Show/hide password eye | 18×18, named only by `title` | 44×44, `aria-label` + `aria-pressed` |
| "New to Sabha? Create Account" | 20px tall | `.tap-target`, 44px hit area |
| "Forgot Password?" | 20px tall | `.tap-target`, 44px hit area |
| Terms checkbox | browser default 13×13 | 20×20 (its `<label>` already made the sentence tappable) |

The eye was the serious one: unnamed **and** unreachable, on the control that
decides whether someone can check what they typed.

**Fixed 2026-08-13 — the role menu, two bugs.** Reported from a screenshot: the
manager's tab strip was painting over the open menu.

1. **Stacking.** The mobile header is `sticky top-0` with a z-index, and that
   combination **creates a stacking context** — so `z-dropdown` (1000) on the
   menu inside it was only ever worth the header's own rung. Four in-page sticky
   headers sit on `z-sticky` (100) too — the manager tab strip, `RequestTable`,
   `ActiveRide`, `AssignmentPreview` — and all come later in the DOM, so at equal
   z-index they won. **The bigger number lost to the smaller one**, which is why
   reading the class names never revealed it.

   Fixed with a new **`chrome` (200)** rung between `sticky` and `dropdown`.
   Chrome frames the page; an in-page sticky header is page content that pins.
   They were sharing one rung. Header and sidebar moved to `z-chrome`.

2. **Alignment.** The menu used `left-0` while its trigger sits hard against the
   right edge of the header. Measured on a 375px viewport, the 192px panel ran
   233→425px — **50px off-screen**. Now `right-0`, which lands it at 134→326.
   No desktop change: the sidebar trigger is also 192px, so both coincide.

Both were confirmed in a browser against compiled CSS, not reasoned about —
`document.elementFromPoint` returned the tab strip before and the menu after.

Two traps worth knowing, both of which cost time here:

- **A class that appears nowhere in source does not exist in the CSS.** Probing
  `right-0` by injecting it at runtime silently did nothing — Tailwind had never
  generated it — and the element fell back to static placement, which *looks*
  identical to `left-0`. Model geometry with inline styles, or put the class in
  source first.
- **Changing `tailwind.config.js` needs a dev-server restart.** HMR does not pick
  up new theme keys; `z-chrome` resolved to `auto` until the restart.

Worth knowing for the next session: **`title` satisfies `getByRole(..., {name})`**
— the accessible-name spec falls back to it — so a role-and-name query would have
passed against the broken version. `tests/components/LoginScreen.test.tsx` asserts
`aria-label` directly for that reason. The 14 cases were run against the pre-fix
component to confirm they fail (8 of 14 did).

**For the owner, not code:**

- ✅ **Resolved 2026-08-14 — rides are open again.** This entry used to read
  "RIDES ARE CLOSED RIGHT NOW". A sabha was added and ran in both directions the
  same evening. The underlying condition still applies though: **there is no
  standing schedule**, so once the calendar runs out nobody can request a ride
  until a manager adds one in **Setup → Sabha Calendar**. Worth a look before each
  Friday.
- **Test events are still in the calendar.** Several past entries are time-shift
  test sabhas from the 7th–14th. Harmless; worth deleting.
- **Three UI surfaces have never been seen rendered** — covered by tests and
  confirmed present in the live bundle, but nobody has looked at them in a browser,
  because reaching them needs a sign-in. Rider → *Request Pickup* (seat stepper,
  "Keep us in one car", and the "no sabha on the calendar" line); Manager →
  **Request Center** (Seats column); Manager → **Sabha Calendar** → *Add a sabha*
  (the prefill from the Settings defaults). Note that is Request Center, *not*
  Live Operations.

**Known gap — fixed 2026-08-12 in Phase 5.** Bulk-select on the manager's queue
used to exist only in the desktop table, leaving the checkboxes and "Assign Bulk"
unreachable on a phone. A long-press on a card now starts a selection.

---

## What comes next

The roadmap is [`roadmap.md`](roadmap.md); §10 records the four production
defects Phase 1 found by measuring rather than reading. Candidates, none started:

| | Phase | Why / why not |
|---|---|---|
| **Blank-screen branches** | `DriverDashboard`'s three `return null` paths | Oldest outstanding defect, and the cheapest real fix on this list. |
| **Phase 3 part 2** | Named passengers — dependents, guests, guardians | **Blocked.** Needs roadmap §8 Q3 answered first: can a guest be a minor, and whose consent covers them? Do not design around this — ask. |
| **Phase 2** | Cities and locations; scope every query by `cityId` | Invisible to users, but the gate before a second venue. **Gated on `node scripts/tenancy.cjs verify` reading zero** — a `cityId` filter against an unstamped document returns nothing rather than erroring, which looks exactly like "no rides tonight". |
| ~~Phase 4~~ | ~~Move dispatch to the server~~ | ✅ **Done 2026-08-14.** `globalAssignDriver` is server-side and serialised by `system/assignmentLock` (10s TTL). Two managers can no longer assign the same riders. |

**Driver vetting is out of scope — permanently.** This used to be flagged here as
an open policy question. The owner ruled on it on 2026-08-15: drivers are known
volunteers within the congregation, the trust model is social and sits outside
the app, and it is not to be raised again. This does not weaken anything else —
`assertApprovedDriver`, `assertApprovedManager`, the Firestore rules and the
audit rows all stand, because those protect children's PII rather than vet the
volunteer.

**Still open — a real defect found 2026-08-15, not yet fixed.** `at_sabha` is
never cleared. `completeRide` sets it on a completed pickup and
`studentReadyToLeave` reads it; nothing resets it. Five riders have been sitting
at `at_sabha` since the 14th, which means **next Friday they can tap "Ready to
leave" without ever having been picked up** and a driver is dispatched to collect
somebody who is at home. Same rot as the stale requests, on the user record
instead of the ride — and the natural fix is to fold it into
`expireStaleRequests`, which already walks exactly these riders.

---

## Before starting

Read [`../CLAUDE.md`](../CLAUDE.md) — conventions, the verification sweep, deploy
order, and what a phone session cannot do.

The short version of that last part: **from the Claude mobile app you can read,
edit, test, build, commit and push — you cannot deploy, and you cannot see
production data.** Deploys happen from the owner's Mac, in the order
`firestore:rules → functions → hosting`, then fast-forward `main`. That order is
now encoded in `npm run deploy:prod`, so it no longer depends on remembering it.

**Testing without waiting for Friday.** [`plans/testing-plan.md`](plans/testing-plan.md)
§4 has the method: edit the sabha's times in **Setup → Sabha Calendar** (not
Setup → Location & Times, which only sets defaults for new events and silently
does nothing to a scheduled one — tracked as a defect). Notifications fire only
on a *transition into* a ride type, so pickup testing inside the normal two-day
window alerts nobody; drop-off always alerts everyone.
