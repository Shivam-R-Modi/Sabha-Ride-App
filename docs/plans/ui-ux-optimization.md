# UI/UX optimization — plan

Full redesign of the interface and the flows through it. **No change to Cloud
Functions, Firestore rules, or any data path.** Same brand colours. New surface
treatment (modern minimalism + liquid glass), a manual day/night switch, and an
information architecture rebuilt around one question per screen.

Written 2026-08-12, against commit `0406ab8`.

---

## 1. Baseline, measured not assumed

Everything below was run on this branch before a single line was changed. These
are the numbers the work has to still produce at the end.

| Check | Result |
|---|---|
| `npx vitest run` | **70 passed**, 6 files |
| `npm run typecheck` | **58 errors** — 22 client + 36 `functions/` |
| `npm test --prefix functions` | 245 (not re-run here) |
| `npm run test:rules` | 81 (needs emulator) |

**On the "22" in CLAUDE.md.** It is correct but under-specified: `tsc` reports
**58** errors, of which exactly **22** are outside `functions/`. The 22 are in
ten files, and eight of them are files this work rewrites:

```
src/utils/cloudFunctions.ts        5     components/manager/ManagerDashboard.tsx    2
hooks/useAdminDatabase.ts          3     components/driver/CompletionScreen.tsx     2
components/driver/DriverDashboard  3     components/driver/AssignmentPreview.tsx    2
scripts/setRideContext.ts          2     components/manager/LocationSettings.tsx    1
                                         components/driver/ActiveRide.tsx           1
                                         components/RideStatus.tsx                  1
```

Nearly all are the same shape: `catch (e: unknown)` then `e.message`. Rewriting
these screens will incidentally fix some, which *lowers* the count. That is an
improvement, but it breaks "22 means clean" as a checksum. **Decision: the count
may only go down, never up, and CLAUDE.md gets updated with the new number at the
end of each phase.**

**Safety net gap.** The 70 client tests are all pure logic — utils and hooks.
**Not one component is ever rendered in a test**, and `@testing-library/react` is
not installed. So today nothing at all would catch a UI regression. Phase 0
fixes that before anything is touched, because "the functions still work" is the
explicit requirement and right now only the functions are actually guarded.

---

## 2. The workflows as they really are

### 2.1 Rider — from opening the app to having a ride

```
splash (needs a TAP to dismiss)
  → attendance interstitial   full-screen, blocks everything, every session
      ├─ "Nah"  → AttendanceBlockedScreen replaces the entire dashboard
      └─ "Yes"  → home
  → home        up to 5 stacked cards, 2 competing primary CTAs
  → tap Request Pickup card
  → PickupForm  replaces home entirely (not a sheet — no context left behind)
  → Confirm
  → success screen, 2s hard timeout
  → home
```

Six screens and a mandatory tap to do the one thing the app exists for.

### 2.2 Driver — from opening the app to carrying people

```
dashboard
   status card (avatar, online toggle, vehicle sub-panel with "Select Car")
   stats row (today's seva / assignments)
   ride-type card
   error banner
   [Assign Me]              ← grey and unclickable until a car is chosen
   "No assignments yet"     ← rendered ALWAYS, even directly under Assign Me
   [I'm Done for Today]
   "You are currently offline"  ← when offline, says the same as the card above
  → preview → accept → ActiveRide → complete → CompletionScreen
```

### 2.3 Manager — Friday evening

```
app-panel
  segmented control:  Request Center | Live Operations | Database Console
  toolbar icons:      🚗 Fleet   📍 Settings   ⬇ CSV   🔔 Approvals
  bottom nav:         Admin | Reports | Profile
```

Three navigation systems visible simultaneously. The Settings modal stacks
`SabhaCalendar` + `RideWindowControl` + `LocationSettings` — three unrelated
jobs — into one scrolling column.

---

## 3. Findings

Ordered by how much they cost the person using the screen. Each is a thing I read
in the code, not a general principle.

### 3.1 Cognitive load

| # | Finding | Where |
|---|---|---|
| 1 | **Rider home has two competing primary CTAs.** "Request Pickup" (accent card) and "I'M READY TO LEAVE" (large pulsing CTA) sit side by side. Nothing says which one tonight calls for. | `StudentDashboard.tsx:200-287` |
| 2 | **The Return Trip card is on screen ~6 days out of 7 doing nothing.** When `dropoffOpen` is false it is covered by a blur veil and a status pill — a permanent grey rectangle occupying half the fold. | `StudentDashboard.tsx:249-276` |
| 3 | **The CTA pulses forever.** `clay-btn-cta-large` carries `animation: clay-cta-pulse 2s ease-in-out infinite`. Continuous motion on a control that is usually disabled. | `claymorphism.css:436` |
| 4 | **Attendance is a full-screen blocking interstitial every session**, and answering "no" swaps the entire dashboard for `AttendanceBlockedScreen`. A one-bit answer takes the whole app hostage. | `StudentDashboard.tsx:100-117` |
| 5 | **The splash screen requires a tap.** The auto-dismiss timer was deliberately removed. Every launch costs one meaningless interaction. | `App.tsx:27-31` |
| 6 | **Driver sees an empty-state card that is never conditional.** "No assignments yet" renders in the dashboard view always — including immediately below the Assign Me button, and simultaneously with the *second* offline card that says the same thing in different words. | `DriverDashboard.tsx:507-547` |
| 7 | **Manager runs three navigation systems at once** — segmented control, toolbar icons, bottom nav — on one screen. | `ManagerDashboard.tsx:429-499` |
| 8 | **Settings is three unrelated tools in one scroll**: sabha calendar, ride window, venue location. | `ManagerDashboard.tsx:773-777` |
| 9 | **"My Rides → Upcoming" duplicates the home ride card**, so the rider's second nav tab is empty or redundant most of the time. | `MyRides.tsx:118-129` |
| 10 | **Approvals modal mixes four different decisions** — driver approvals, rider approvals, ride requests — and the ride-request rows duplicate the Request Center tab behind it. | `ManagerDashboard.tsx:586-738` |

### 3.2 Controls that mislead

| # | Finding | Where |
|---|---|---|
| 11 | **The disabled "Assign Me" never says why.** It is `disabled` when no vehicle is chosen, so the click handler cannot fire — which makes its `alert('Please select a vehicle first')` **unreachable code**. The driver gets a grey button and no reason, ever. | `DriverDashboard.tsx:239-243, 491-494` |
| 12 | **Settings is behind a 📍 map-pin icon.** The icon does not mean settings. | `ManagerDashboard.tsx:468` |
| 13 | **"Assign" silently picks a driver for you** — `availableDrivers.find(d => d.status === 'available')`, i.e. whoever is first in the array. The manager is not shown who, and cannot choose. | `ManagerDashboard.tsx:265-272` |
| 14 | **Bulk select is unreachable on a phone.** Checkboxes and "Assign Bulk" exist only in the `hidden md:block` desktop table. Already recorded as a known gap in STATUS.md. | `RequestTable.tsx:174, 271` |
| 15 | **The availability control is a `<button class="clay-toggle">` that renders a Toggle icon inside itself** — two toggle metaphors nested — with no `role="switch"` and no `aria-checked`. | `DriverDashboard.tsx:430-432` |

### 3.3 The known failure mode, still present

The repo banned `window.confirm` because a suppressed dialog returns `false` and
made every destructive button inert. **`window.alert` was never swept, and there
are 27 calls left.**

```
components/manager/ManagerDashboard.tsx   15
components/driver/DriverDashboard.tsx      5
components/manager/DatabaseConsole.tsx     2
components/student/StudentDashboard.tsx    1
components/manager/ManagerReports.tsx      1
src/utils/asyncErrorHandler.tsx            1
```

To be precise about the harm, because it differs from `confirm`: a suppressed
`alert` does not make the button inert — the write already happened. What it does
is **make failures invisible**. `alert('Failed to unassign student')` in a context
where dialogs are suppressed means the manager taps unassign, it fails, and the
screen says nothing. That is the same "looks wired up, silently does nothing"
class this codebase has spent releases removing, arriving through a different
door. It is also simply inconsistent: half the destructive actions use the proper
`useConfirm` dialog and half use a native alert.

### 3.4 Accessibility

The compliance doc holds this app to **WCAG 2.1 AA**
(`docs/compliance/privacy-and-data.md:13`), and the earlier design-system pass got
contrast failures from 111 down to 1. Two live regressions against that:

| # | Finding | Where |
|---|---|---|
| 16 | **Pinch-zoom is disabled.** `maximum-scale=1.0, user-scalable=no` — a direct WCAG 1.4.4 (Resize Text) failure. | `index.html:6` |
| 17 | **Only one of twelve hand-rolled modals is announced as one.** `useConfirm` sets `role="dialog"` + `aria-modal`. The other eleven `fixed inset-0` overlays set neither, and none trap focus, lock scroll, or close on Escape. | 12 files |

### 3.5 Structural

| # | Finding | Where |
|---|---|---|
| 18 | **The z-index ladder exists and is unused.** `tailwind.config.js` defines `base/raised/sticky/dropdown/modal/toast`. Components use 14× `z-50`, plus `z-40`, `z-30`, `z-20`, `z-10`, `z-[60]`, `z-[100]`, and an inline `zIndex: 9999`. | `tailwind.config.js:95-102` |
| 19 | **12 files hand-roll their own modal.** No shared sheet/dialog primitive. | grep `fixed inset-0` |
| 20 | **`WeeklyAttendancePopup` is written in inline styles**, ~90 lines of them, bypassing the design system entirely. | `WeeklyAttendancePopup.tsx:44-168` |
| 21 | **~200 off-palette Tailwind utilities** (`bg-white`, `text-gray-*`, `blue-*`, `red-*`, `green-*`) across components. Every one is a colour that cannot follow a theme switch. Worst: ManagerDashboard 57, DatabaseConsole 46, RequestTable 39. | all components |
| 22 | **`ActiveRide` renders `min-h-screen` with its own sticky header inside a shell that already has a header and a bottom nav.** Double chrome, and the driver can navigate away mid-ride. | `ActiveRide.tsx:156-158` |

---

## 4. Design direction

### 4.1 The honest problem with the brief

Claymorphism and glassmorphism are opposites. Clay is heavy, opaque, deeply
inset-shadowed, with 32–48px radii:

```css
box-shadow: 8px 8px 24px rgba(61,47,20,.15),
            inset 8px 8px 16px rgba(255,255,255,.8),
            inset -4px -4px 12px rgba(61,47,20,.08);
```

Glass is thin, translucent, blurred, hairline-bordered. So this is a **replacement
of the design system, not a re-skin** — 1215 lines of `claymorphism.css` plus the
~200 off-palette utilities. That is the true size of the job, and the plan is
phased accordingly.

Second honest note: glass everywhere is a trap. `backdrop-filter` on large
scrolling surfaces janks on low-end Android, and translucent backgrounds behind
body text are how contrast ratios quietly die — which would undo the 111 → 1 win
this repo already banked.

### 4.2 Glass everywhere — **decided 2026-08-12**

Chrome-only was recommended; **glass on content surfaces too was chosen.** Taken as
given. What follows is how to deliver it without losing the contrast baseline,
because AA is a compliance requirement in
`docs/compliance/privacy-and-data.md`, not a preference I get to trade away.

| Layer | Treatment |
|---|---|
| **Chrome** — header, bottom nav, sheet backdrops, floating pills, toasts | Full glass. `backdrop-filter: blur(24px) saturate(180%)`, tint at **~62%** opacity, 1px specular top edge. |
| **Content** — cards, rows, tables, forms | Glass, but **tinted to ≥88% opacity**. Reads as frosted; text on it still measures AA against the token, not against whatever happens to scroll underneath. |
| **Text** | Only ever on a ≥88% surface. Never directly on an unfilled blur. |

Three engineering rules make "glass everywhere" safe:

1. **Opacity floor of 88% on any surface bearing text.** Contrast is then computed
   against a known colour rather than against arbitrary content behind it. This is
   what keeps the effect and the AA baseline in the same build.
2. **`@supports not (backdrop-filter: blur(1px))` fallback to fully opaque.** Blur
   is unsupported or disabled often enough that the unblurred state must be a
   designed state, not an accident.
3. **Blur budget.** `backdrop-filter` is GPU-expensive and compounds when layered.
   Cap at **one blurred layer in the scroll path** — a scrolling list of frosted
   cards over a frosted background is the exact combination that stutters. Cards
   get their tint and border; the blur belongs to the surface they scroll over.

If Phase 6 measurement shows content-card glass costing contrast or frame rate, the
fix is to raise the tint further, not to abandon the look.

Everything else gets lighter: radii **24/32/48 → 12/16/20**, three-layer shadows →
one, borders to hairlines, and a real vertical rhythm instead of the current mix
of `space-y-6` / `p-8` / `gap-4`.

### 4.3 Day / night

No dark mode exists today — zero `dark:` utilities, no `prefers-color-scheme`, no
theme context. The blocker is that colour is baked into gradients and shadows
rather than named.

**Architecture:**

1. **Semantic tokens, one layer above the brand.** Brand hues (saffron, cream,
   coffee, gold) stay exactly as they are and stay the source. What changes is
   that components stop naming them:

   ```css
   :root[data-theme="light"] {
     --bg-canvas:      250 249 246;   /* cream 100  */
     --bg-surface:     255 255 255;
     --bg-glass:       255 255 255 / .62;
     --text-primary:    61  41  20;   /* coffee 900 */
     --border-hairline: 61  41  20 / .10;
     --accent:         255 107  53;   /* saffron — fills   */
     --accent-text:    184  67  24;   /* saffron 800 — text */
   }
   :root[data-theme="dark"] {
     --bg-canvas:       26  22  18;   /* warm near-black, not blue-grey */
     --bg-surface:      38  32  27;
     --bg-glass:        38  32  27 / .58;
     --text-primary:   250 249 246;
     --border-hairline:255 255 255 / .10;
     --accent:         255 140  90;   /* lifted: saffron 500 is muddy on dark */
     --accent-text:    255 168 122;   /* AA on --bg-surface */
   }
   ```

   Warm dark, not the usual blue-grey — this is a saffron-and-coffee brand and a
   cold dark theme would read as a different app.

2. **Tailwind reads the tokens**, so every existing utility themes for free:
   `surface: 'rgb(var(--bg-surface) / <alpha-value>)'`.

3. **`data-theme` on `<html>`**, set by an inline script in `index.html` *before*
   first paint, so there is no white flash on a dark-theme launch. `<meta
   name="theme-color">` is swapped with it.

4. **Three-way control** — Light / Dark / System — persisted in `localStorage`.
   The brief asks for manual, and manual is the default position; System is there
   because a phone that flips at sunset otherwise fights the app. Lives in
   Profile, for all three roles.

5. **Dark mode is a genuine feature here, not decoration.** Drivers use this app
   in a car, at night, after sabha.

---

## 5. Screen by screen

Organising principle: **one question per screen, one primary action per screen.**

### 5.1 Rider

**Home becomes a single state card** that answers "what is happening with my
ride?" and carries exactly one action for whichever state you are in:

| State | Card says | The one action |
|---|---|---|
| No sabha scheduled | "No sabha scheduled yet" | — |
| Attendance unanswered | "Sabha this Friday. Coming?" | Yes / No, **inline** |
| Not requested | "Friday 15 Aug · 5:30 PM" | **Request a ride** |
| Requested | "Waiting for a driver · 12 min" | Cancel |
| Assigned | Driver, car, plate, ETA | Call · Text |
| Split group | "3 of your 5 seats are with Ramesh" | Call · Text |
| En route / arriving | Live status | Call |
| At sabha, window shut | — card not shown at all — | — |
| At sabha, drop-off open | "Ready to go home?" | **I'm ready to leave** |
| In queue | "In the drop-off queue" | — |

Changes that follow from it:

- Splash auto-dismisses when auth resolves. The brand moment stays; the tap goes.
- Attendance is **a card, not an interstitial**. "Not this time" collapses it to a
  one-line "You said you're not coming — changed your mind?" It never replaces the
  dashboard, so `AttendanceBlockedScreen` is deleted.
- The Return Trip control **does not render** when the window is shut. No veiled
  ghost card.
- Weekly Notice becomes one line of helper text under the request button.
- `PickupForm` becomes a **bottom sheet**, so home stays visible behind it.
- Success stops being a 2-second timed screen and becomes an inline confirmation
  the rider dismisses — or that simply becomes the new state of the card.
- "My Rides" is history only. Home owns "now".

**Fold count: 5 cards + 2 CTAs → 1 card + 1 action.**

### 5.2 Driver

**Home becomes a shift card.**

- Offline → one button: **Go on shift**. Choosing a car is step 1 *of that flow*,
  not a separate sub-panel — you cannot be on shift without a car, so stop
  modelling them as independent.
- Online → car + plate + seats, today's tally as one quiet line, and one button:
  **Find my next riders**.
- The unconditional empty-state card and the duplicate offline card are both
  deleted. The button is the empty state.
- Never a grey button with an unexplained reason. If no car is chosen, the button
  reads **"Pick a car to start"** and does that. Finding 11's unreachable alert
  goes with it.
- Availability becomes one control with `role="switch"` + `aria-checked`.
- **`ActiveRide` becomes focus mode**: full-bleed, shell nav suppressed, one job.
  Big targets, high contrast, dark theme by default at night. Per-rider rows get
  a swipe-to-tick as well as the tap target.

### 5.3 Manager

**One navigation system.** The toolbar icons go; the Request Center / Live
Operations segmented control **stays** (see the decision below). Everything else
moves into the sidebar (desktop) / bottom nav (mobile):

| | Screen | Contains |
|---|---|---|
| 1 | **Dispatch** | The existing two tabs, restyled, with live counts in the labels |
| 2 | **People** | Driver + rider approvals, with a count badge |
| 3 | **Reports** | ManagerReports + attendance CSV |
| 4 | **Setup** | Sabha calendar · ride window · venue · fleet — as four *sections*, not one scroll |
| 5 | **Profile** | Profile + theme |

That still removes one of the three competing navigation systems (the four
unlabelled toolbar icons, including the map-pin-means-settings one in finding 12)
and leaves two: the bottom nav for areas, the segmented control for the two
dispatch views.

**The two tabs stay — decided 2026-08-12.** Merging Request Center and Live
Operations was recommended and declined: it changes a working Friday-night
routine. So Request Center and Live Operations keep their own tabs and keep their
current split of work. They are restyled, not restructured.

What that costs, recorded so it is a known trade and not an oversight: the manager
still toggles tabs to answer one question — *who is waiting, and who is driving?*
Two things reduce the toggling without moving anything:

- **A persistent count in each tab label** — "Waiting · 7 (11 people)" and "Out
  now · 3 cars" — so the number you switch tabs to check is legible without
  switching. Cheap, and it removes most of the round trips.
- **Bulk select works on mobile** (below), so triage on a phone stops needing the
  desktop table.

Everything else in this section still applies:

- **Assign opens a driver picker** — available drivers with seats free — instead of
  silently taking the first match (finding 13).
- **Bulk select works on mobile**: long-press enters selection mode, action bar
  docks to the bottom. Closes the known gap in STATUS.md.
- Database Console moves to **Setup → Advanced**, behind a plain warning that it
  edits live records. It is a raw admin tool and should not be a peer tab to
  Friday-evening operations.

### 5.4 Cross-cutting

| Item | Change |
|---|---|
| **Toasts** | New `<Toast>` primitive. All 27 `alert()` calls become toasts; confirms keep `useConfirm`. Errors are persistent and dismissible, never auto-hiding. |
| **Sheet / Dialog** | One primitive replacing 12 hand-rolled overlays. Focus trap, Escape, scroll lock, `role="dialog"`, `aria-modal`, returns focus on close. |
| **Z-index** | The six existing tokens, used. No raw values, no `9999`. |
| **Motion** | Infinite pulse deleted. Transitions ≤200ms. `prefers-reduced-motion` already handled globally — keep it. |
| **Viewport** | Drop `maximum-scale=1.0, user-scalable=no`. Fixes WCAG 1.4.4. |
| **Skeletons** | Real skeletons matching final layout, replacing centred spinners, so nothing jumps on load. |
| **Empty states** | One per surface, never two, never unconditional. |

---

## 6. Phasing

Each phase is independently shippable and ends with the full sweep from CLAUDE.md.
**No phase touches `functions/`, `firestore.rules`, or any hook's data contract.**

### Phase 0 — safety net ✅ **done 2026-08-12**

The whole "nothing breaks" promise rested on this. No test rendered a component,
so a UI overhaul would have been flying blind.

Added `@testing-library/react`, `/user-event`, `/dom`, `/jest-dom`
(`--legacy-peer-deps`, per the Vite 6 peer-range note), `tests/setup.ts`, and the
React plugin in `vitest.config.ts`.

**80 new tests**, all asserting text, roles and behaviour — never a class name, so
the restyle cannot break them:

| File | | Covers |
|---|---|---|
| `tests/components/PickupForm.test.tsx` | 20 | The seat stepper, "Keep us in one car", and the exact payload handed to `createRideRequest`. **Never rendered before today.** |
| `tests/components/RequestTable.test.tsx` | 21 | Seat badges, "Needs 2 cars", "No car this big", remainders, sort direction, assign/dismiss/bulk. **Never rendered before today.** |
| `tests/components/RideStatus.test.tsx` | 15 | Every one of the seven ride statuses renders a labelled card, never a blank one. |
| `tests/components/MyRides.test.tsx` | 11 | Details actually reveals something; Load More only when there is more. |
| `tests/components/useConfirm.test.tsx` | 10 | The destructive-action gate. Resolves true/false, always settles, focuses the safe choice. |
| `tests/quality/native-dialogs.test.ts` | 3 | Ratchets: `confirm` stays at 0, `alert` capped at 27 and may only fall. |

Two guards worth calling out because they encode decisions rather than behaviour:

- **`RequestTable` "known gap"** asserts that bulk-select exists *only* in the
  desktop table. When Phase 5 gives the mobile list a selection mode this test
  fails — and that failure is the signal to update it, not a regression.
- **The alert budget** is a ratchet, not a gate. It fails if the count rises *and*
  if it falls without the budget being lowered, so the number cannot drift in
  either direction unnoticed.

*Gate met:* client **150** (was 70) · functions **245** · rules **81** —
**476 total**, was 396. Typecheck **58 / 22**, unchanged. `vite build` clean.

One incident worth recording: the new test files initially added 3 typecheck
errors (61 / 25). Fixed rather than accepted — two loose casts in the RideStatus
fixtures, and a genuine Vite 5-vs-6 `Plugin` type skew in `vitest.config.ts` that
is annotated in place rather than silenced.

### Phase 1 — tokens + theme switch ✅ **done 2026-08-12**

Pure refactor. Light mode had to come out byte-identical, and did.

**What landed**

- **`theme.css`** — 60-odd semantic tokens per theme, as space-separated RGB
  channels so one token serves an opaque fill, a translucent one, and Tailwind's
  `<alpha-value>`. Every light value is the exact hex that was already hardcoded
  somewhere.
- **Every colour literal is gone** from `claymorphism.css` and `index.css` — 31
  distinct hexes and 44 distinct `rgba()`s converted. The only survivors are the
  `rgba(0,0,0,·)` inner shadows on filled buttons, which are correct on both
  themes and annotated as deliberate.
- **Tailwind reads the tokens**, so `text-coffee` and `bg-cream` theme with no
  `dark:` variant anywhere. Four ramp steps (`saffron-dark`, `saffron-700`,
  `cream-dark`, `coffee-400`) needed their own tokens rather than being folded
  into a near neighbour — folding them would have shifted light mode.
- **Pre-paint script in `index.html`** plus a four-line critical CSS block, so a
  dark launch is dark on the first frame rather than flashing cream.
- **`ThemeProvider` + `ThemeToggle`** — Day / Night / Auto, in Profile, mounted
  outside `AuthProvider` so it survives sign-out and applies to the login screen.
- **Pinch-zoom restored** (finding 16). `user-scalable=no` deleted.
- **Glass primitives** — `.glass-chrome`, `.glass-surface`, `.glass-edge`, with
  the opaque `@supports` fallback and a reduced-motion opt-out.

**Verified in a real browser, not by eye.** A swatch harness was built against
the compiled CSS and probed with `getComputedStyle`:

- Light: `.clay-card` resolves to `#FFFFFF → #FAF9F6 → #F5F0E8` with
  `rgba(61,47,20,.15)` — identical to before. Every ramp step matches.
- Dark: warm surfaces, inverted CTA ramp (light fill, dark text), no white glare.
- **Contrast measured for all nine text roles × two surfaces × two themes.
  Lowest is 4.79:1. Everything clears AA.**

**Three real defects the new tests caught before anyone saw them**

1. **Dark `--sunken` equalled `--canvas`**, so every pressed-in control — input
   wells, progress tracks — would have vanished into the page. Caught by the
   depth-ordering assertion.
2. **`--edge-light` identical across themes** — legitimate (it is differentiated
   by alpha, a specular highlight being white on anything), but it had to be
   justified rather than assumed.
3. **The CTA text-shadow** was tuned for white text. Dark inverts the fill to
   light-saffron-with-dark-text, where the same shadow is a muddy halo. Now a
   token, and `none` on dark.

Also fixed en route: the header comment in `theme.css` originally contained a
code example with `/*` `*/` inside it. CSS comments do not nest, so it terminated
the block early and spilled the prose into the stylesheet as four syntax errors.
A scanner now checks all three stylesheets for the same shape.

**New tests: 48.** `theme.test.ts` (24), `ThemeToggle.test.tsx` (14),
`theme-tokens.test.ts` (12), `theme-contrast.test.ts` (47 cases). Notable ones:

- Every light token must have a dark counterpart. A missed one does not error —
  custom properties inherit, so it silently keeps its **light** value, and the
  only way to find it is a human looking at every screen in both themes.
- The pre-paint script's duplicated constants must match `src/utils/theme.ts`,
  and the critical CSS must match `theme.css`. Necessary duplication, now
  unable to rot silently.
- The contrast ratios written in `theme.css` comments are asserted, so the
  documentation cannot drift into fiction.

*Gate met:* client **248** · functions **245** · rules **81** — **574 total**.
Typecheck **58 / 22**, unchanged. Build clean.

### Phase 2 — primitives ✅ **done 2026-08-12**

Scope was trimmed deliberately. The original list named eight primitives;
`Surface`, `Button`, `Field`, `StatusPill` and `SeatBadge` were **not** built,
because they have no consumer until Phases 3–5 rewrite the screens that would use
them, and a primitive with no consumer is a guess about an API. They get built
with their first real caller.

What did land is what had consumers today:

**`ToastContext` — all 27 `alert()` calls are gone.**

`window.confirm` was banned long ago; `alert` never was. The harm differs and is
worth stating precisely, because it is not the same bug: a suppressed alert does
**not** make the button inert — the write already happened — it makes the
**failure invisible**. `alert('Failed to unassign student')` where dialogs are
suppressed means the manager taps unassign, it fails, and the screen says
nothing.

- **Errors never auto-dismiss.** A success that fades is fine; a failure that
  fades is a failure nobody saw.
- **Two live regions**, not one: errors `assertive`, confirmations `polite`.
  Politeness is not a single setting, and either choice is wrong half the time.
- **Focus is not stolen.** `alert()` blocked the page and moved focus; being
  announced without being interrupted is better for a screen-reader user.

**`Sheet` — one overlay primitive.** Focus trap, background scroll lock (with
scrollbar compensation, and it survives nested sheets), Escape closing only the
topmost, `role="dialog"` + `aria-modal`, and focus returned to whatever opened
it. `dismissible={false}` for a write in flight — and it hides the close button
too, rather than leaving one that does nothing.

`useConfirm` is migrated onto it, which upgrades **every destructive action in
the app at once**. The other 11 hand-rolled overlays are migrated by the phase
that rewrites their screen; a ratchet test caps the count so it can only fall.

**The z-index ladder is finally used.** It was defined in `tailwind.config.js`
and referenced nowhere. The codebase held `z-50` ×14, `z-40`, `z-30`, `z-20`,
`z-10`, `z-[60]`, `z-[100]` and an inline `9999` — so which layer covered which
was settled by DOM order. One real bug fell out: `.clay-modal-overlay` sat at 50
while `.clay-sidebar` sat at 100, so on desktop **the sidebar drew straight over
any modal using that class**.

**Dead code removed:** `src/utils/asyncErrorHandler.tsx` (87 lines, zero imports
anywhere, and one of the 27 alerts), plus three `@keyframes` and a CSS class with
no references.

**The infinite CTA pulse is gone** (finding 3). A control that never stops moving
is noise, not emphasis — and the rider's "I'M READY TO LEAVE" carries that class
while sitting *disabled* about six days out of seven.

**One behaviour change worth flagging:** `downloadAttendanceCSV` now **throws**
instead of alerting. Its old `alert(); return;` was the worse failure of the two —
with dialogs suppressed it resolved *successfully* having done nothing, so the
caller's `await` completed, no catch ran, and the manager watched a download
button do absolutely nothing. Both callers already surface `error.message`.

**New tests: 39.** `Sheet` (22), `Toast` (13), plus useConfirm's new Escape and
click-inside cases. The `alert` ratchet is now a **ban at zero**, joined by
`prompt`. Two flaky bulk-assign assertions were made deterministic rather than
left at a 1-in-4 failure.

*Gate met:* client **287** · functions **245** · rules **81** — **613 total**.
Typecheck **58 / 22**, unchanged. Build clean.

### Phase 3 — rider ✅ **done 2026-08-12**

The first phase with a visible result. **Home went from up to five stacked cards
and two competing primary buttons to one card and one action.**

**Which card shows is now a pure function.** `src/utils/riderState.ts` takes the
loading flags, the ride window, the rides and the attendance answer, and returns
exactly one of ten states. It used to be four early returns and five conditional
blocks scattered through the render, which meant the priority order between
overlapping states was implicit in *where a return happened to sit in the file* —
not somewhere anyone could review it. **29 tests**, most of them about that
ordering: a live ride outranks the attendance question, a dismissal outranks
both, drop-off outranks everything.

**The two interstitials are gone.** `WeeklyAttendancePopup` (172 lines, written
almost entirely in inline styles — finding 20) and `AttendanceBlockedScreen` both
replaced the *entire dashboard* to handle a one-bit answer. The question is now a
card among the others, and "not this time" collapses it to a card with a way
back rather than taking the app away.

Also:

- **The go-home button is not rendered when the window is shut**, instead of
  sitting there greyed out under a blur veil roughly six days out of seven.
- **The splash screen dismisses itself** after 1.8s. Tapping still skips it. The
  timer had been removed "to favour a user-initiated transition", which meant one
  mandatory meaningless tap before every launch.
- **The booking form is a sheet**, so home stays visible behind it.
- **Weekly Notice is one line of helper text**, not a card competing with the
  real action.

**Two defects found by looking at it, which no test would have caught:**

1. **The driver's name truncated to "Ra…"** at phone width. The avatar, the name
   and two 40px icon buttons were sharing one row, and the name lost — the single
   most important word on the card. Contact moved to its own row and became two
   labelled, full-width targets, which is what someone standing on a kerb in the
   dark actually needs.
2. **The status band did not theme.** `bg-blue-100 text-blue-800` and friends are
   fixed light values, so on dark the band was a pale slab; the ETA chip was
   light text in a light box, and the route dots were white squares. All
   tokenised. Measured after: lowest ratio on that card is **7.36:1**.

**`preview/` is new** — a build config and stubs that render real screens with
real stylesheets, with only the Firestore boundary faked. STATUS.md has carried
the same note for months: screens "have never been seen rendered ... because
reaching them needs a sign-in". That is a standing problem, not a one-off, and
both defects above were found this way within a minute of looking.

```
npx vite build --config preview/vite.config.ts
npx vite preview --outDir preview-dist      # then open /preview/rider.html
```

**New tests: 63.** `riderState` (29) and `RiderHome` (34). The load-bearing one
counts primary actions per state, because "one card, one action" is the whole
point and is otherwise the first thing to erode.

*Gate met:* client **350** · functions **245** · rules **81** — **676 total**.
Typecheck **58 / 22**, unchanged.

### Phase 4 — driver ✅ **done 2026-08-12**

**Nine competing blocks became one card and one secondary button.** The old
screen carried a status card with a nested toggle, a stats row, a ride-type card,
an error banner, a grey "Assign Me", an unconditional empty-state card, a "Done
for Today" button, and — when offline — a *second* card saying the same thing as
the first in different words.

**The dead-button defect is fixed at the root** (finding 11). "Assign Me" was
`disabled` whenever no car was chosen, so its click handler never ran, so its
`alert('Please select a vehicle first')` was **unreachable code**: a grey button
and no reason, ever. There is now no disabled primary button on this screen. With
no car it reads **"Pick a car to start"** and pressing it does exactly that.

**Choosing a car is step one of going on shift**, not a separate concern. You
cannot drive without one, so modelling them as independent is what produced the
dead end in the first place.

**No empty state.** The button *is* the empty state. A card explaining you have no
assignment, sitting directly beneath a button that gets you one, is noise.

**`ActiveRide` is now focus mode.** It drew its own sticky header underneath the
shell's — two stacked bars, ~120px, on a list of stops read at arm's length in a
car — and the bottom nav sat there offering History and Profile mid-run, a
thumb-width from the tick-off buttons. `NavigationContext` gained
`isFocusMode`; the shell renders children alone when it is set. Its
"Leave Ride?" modal moved onto `Sheet`.

**Both driver screens are fully tokenised** and were checked in dark, which is
the condition that matters here — this is the screen used in a car at night.
Worst measured ratio across the shift card is **6.5:1**, at the darkest stop of
the button gradient.

**Typecheck client errors fell 22 → 19.** The three in `DriverDashboard` were all
`catch (e: unknown)` then `e.message`, and went with the code that held them.

**New tests: 24.** The first block is entirely about the dead button not coming
back: the primary is never disabled, it says what is missing *on itself*, and
pressing it opens the picker rather than doing nothing. One test asserts there is
no second card repeating the offline state — and it caught a live duplication
between the header and the card while it was being written.

*Gate met:* client **374** · functions **245** · rules **81** — **700 total**.
Typecheck **55 / 19**, down from 58 / 22. Build clean.

### Phase 5 — manager ✅ **done 2026-08-12**

**Three navigation systems became two**, as agreed. The four unlabelled toolbar
icons are gone — among them a 🚗 meaning "fleet" and a 📍 meaning "settings"
(finding 12). They were never controls; they were destinations, and they are now
in the nav: **Dispatch · People · Reports · Setup · Profile**. The Request Center
/ Live Operations segmented control **stays**, per the decision, and gains live
counts in its labels so the number you would switch tabs to read is visible
without switching.

**"Assign" stops choosing for you** (finding 13). It ran
`availableDrivers.find(d => d.status === 'available')` — whoever was *first in
the array* — and never said who got the rider. A manager assigning by hand is
doing it because they know something dispatch does not: this driver lives near
that family, that one is about to finish. `DriverPicker` shows who is on shift,
their car, **passenger seats free**, and runs done today, and flags a car too
small for the party as a warning rather than a block.

**Bulk select works on a phone** (finding 14, a known gap in STATUS.md since
before this branch). Long-press a card to start selecting; swipe actions suspend
while selecting so a sloppy tap cannot dismiss somebody.

**Approvals got a screen** (finding 10). A bell icon opened a modal mixing four
different decisions, including ride requests that duplicated the screen behind
it. Approving someone gates access to an app holding children's names, phone
numbers and home addresses — that is not a notification. Ride requests belong to
Dispatch and are only there now.

**Setup is five named sections** (finding 8), one open at a time, replacing a
modal that stacked the sabha calendar, the ride window and the venue into one
scrolling column. **The Database Console moved into it** behind a plain warning:
it edits live records with none of the app's checks, and had no business being a
peer tab of Friday-evening dispatch.

**The colour sweep finished.** Roughly **200 hardcoded Tailwind utilities** —
`bg-white`, `text-gray-500`, `bg-blue-100` — are gone from every component. Each
was a fixed light value that could not follow the theme, which is what produced
the white-box-on-dark artefacts found in Phase 3. A ratchet test now fails the
build if a numbered palette class reappears in a `className`.

`text-white` and `bg-black` are deliberately **not** covered by that ratchet:
they sit on saturated fills and scrims where they are often correct in both
themes, and a pattern match cannot tell a white label on a saffron button from a
white label on a surface. Those are measured, not grepped — Phase 6.

**New tests: 29.** `DriverPicker` (16), `ManagerPeople` (13), plus five for
mobile bulk select. The old "known gap" test inverted: it used to assert that
mobile selection did *not* exist.

Hand-rolled overlays fell **8 → 5**.

*Gate met:* client **407** · functions **245** · rules **81** — **733 total**.
Typecheck **55 / 19**. Build clean.

### Phase 6 — dark pass + polish

Every screen in both themes. Contrast measured, not eyeballed — target is the
existing standard: **≤1 failure**. Motion, focus rings, skeletons, 44px targets
re-verified.

---

## 7. What could break, and why it will not

| Risk | Mitigation |
|---|---|
| A hook's data contract changes | Not touched. This is presentation only; every `useFirestore` / `useRides` / `useVehicles` signature stays as it is. |
| A Cloud Function call is dropped in a rewrite | Phase 0 smoke tests assert each screen still calls its callable. `src/utils/cloudFunctions.ts` is unchanged. |
| Firestore rules drift | No rules change. `npm run test:rules` stays at 81. |
| Typecheck count moves | Tracked per phase; may only fall. Now **55 total / 19 client**, down from 58 / 22 — Phase 4 removed three. |
| A dead control ships — the repo's recurring bug class | Every control gets a test that asserts its effect, not its presence. A disabled control must state its reason on screen (finding 11 is exactly this bug). |
| Contrast regresses | Measured each phase against the 111 → 1 baseline. Glass never sits behind text. |
| The e2e spec breaks | It asserts only `text=Sabha Ride Seva` and `input[type="email"]`. Both survive. |
| Service worker serves a stale bundle | Existing CLAUDE.md procedure: unregister, clear caches, match `dist/assets/index-*.js`. |

---

## 8. Decisions

Settled 2026-08-12.

| | Decision | Note |
|---|---|---|
| 1 | **Glass everywhere**, content cards included | Chosen over the chrome-only recommendation. Delivered under the three rules in §4.2 — 88% opacity floor on text-bearing surfaces, opaque fallback, one blurred layer per scroll path — so the AA requirement survives it. |
| 2 | **Request Center and Live Operations keep their own tabs** | Merge declined. Live counts in the tab labels reduce the toggling instead. §5.3. |
| 3 | **Theme control is Light / Dark / System** | Manual is the default position, as the brief asks; System is offered so a phone that flips at sunset does not fight the app. |

Still open, not blocking:

- **Gujarati / `GJDW` font** — declared in `index.css` and configured in Tailwind
  but used nowhere. Either a bilingual UI is intended (worth planning properly) or
  it is dead weight to delete.

---

## 9. Out of scope

Deliberately not in this plan: server-side dispatch (Phase 4 of the roadmap), real
mapping, named passengers (blocked on roadmap §8 Q3), multi-city tenancy, and
driver vetting. This work is presentation and flow. It does not change who can do
what, and it does not touch a single guard.
