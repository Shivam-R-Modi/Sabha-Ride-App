# Where this project is right now

**Handover note between machines.** Read it at the start of a session; update it
at the end. Last updated **2026-08-12**, at commit `0406ab8`.

`main` matches production exactly. Branch
`claude/ride-app-ui-ux-optimization-86f88a` is **ahead of production and
undeployed** — see "In flight" below.

---

## Live in production

| | Deployed | Notes |
|---|---|---|
| Firestore rules | ✅ | seat validation, server-owned group keys |
| Cloud Functions | ✅ | all 16 updated |
| Hosting | ✅ | bundle `index-BZbh6r49.js`, verified live |

**Test suites, all green:** `functions` **245** · client **350** · rules **81** —
**676 total**.

`npm run typecheck` reports **58** errors total, of which **22** are outside
`functions/`. That is the clean baseline, not a regression. The "22" this note
used to quote was the client-only figure; both numbers are recorded now so the
next session does not think 36 errors appeared overnight.

`node scripts/tenancy.cjs verify` reads **0 unstamped** (owner's Mac only — needs
the Admin SDK key).

**Building in a worktree needs `.env.local`,** which is gitignored and therefore
absent from every `git worktree`. `npm run build` fails there with "Missing
Firebase environment variables" before compiling anything. Copy the file across,
or pass throwaway values to prove compilation — the four variables are only
asserted for presence.

---

## In flight: UI/UX optimization

Branch `claude/ride-app-ui-ux-optimization-86f88a`. Plan:
[`plans/ui-ux-optimization.md`](plans/ui-ux-optimization.md).

A full redesign — modern minimalism, liquid glass, a manual day/night switch, and
flows rebuilt around one question per screen. Same brand colours. **Presentation
only: no Cloud Function, no Firestore rule, and no hook data contract changes.**

**Phases 0 to 3 are done.** Client tests went **70 → 350**.

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

**New: `preview/`.** A way to render real screens with real stylesheets without
signing in — see `preview/vite.config.ts`. This exists because of the note lower
down that has stood for months: screens go unlooked-at *because reaching them
needs an account*. Both faults above turned up within a minute of using it.

```
npx vite build --config preview/vite.config.ts
npx vite preview --outDir preview-dist      # then open /preview/rider.html
```

**Still to come:** driver and manager screens, then the dark-mode polish pass.
Two things are deliberately unfinished until then:

- Hardcoded `bg-white` / `text-gray-*` utilities remain in the driver and manager
  screens, so expect light-coloured patches there in dark mode. The rider's
  screens are done.
- 10 screens still have their own hand-rolled modal. Each is migrated onto
  `Sheet` by the phase that rewrites it; a ratchet test stops the count rising.

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

Nothing is blocked. Nothing is half-finished.

**For the owner, not code:**

- **The sabha calendar may only have Aug 7 left.** The audit log shows five
  Fridays were deleted. Worth checking before the next gathering.
- **Two UI surfaces have never been *looked at*** — Rider → *Request Pickup* (seat
  stepper, "Keep us in one car") and Manager → **Request Center** (Seats column).
  Note that is Request Center, *not* Live Operations. Since 2026-08-12 both are
  covered by real render tests (41 between them), so their behaviour is now
  proven; what is still unproven is how they *look*, because reaching them needs
  a sign-in. Two minutes in a browser each.

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
