# Recurring sabha as a rule, and notify-on-change

Two features requested 2026-08-17. Nothing implemented yet.

1. **The recurring sabha becomes one record**, shown in the calendar as recurring,
   with no week limit. It repeats until a manager edits it.
2. **A "notify" checkbox** on Sabha Calendar, Ride Window and Venue that pushes to
   everyone when a change is saved; the same on Fleet, but only to drivers.

---

## 0. Read this first: push notifications have never worked

This is the single most important fact in the plan, and it was measured, not
assumed.

| Check | Result |
|---|---|
| Users with an `fcmToken` in production | **0 of 13** |
| Anything that calls `src/utils/fcm.ts` | **nothing** |
| Anything that calls `requestNotificationPermission` | **nothing** |
| `public/firebase-messaging-sw.js` | **does not exist** |
| VAPID key | read via `process.env` in `fcm.ts`, which is `undefined` under Vite — it must be `import.meta.env` |

So `notifyEveryone` has been called on every ride-window transition since it was
written and has delivered **nothing**, logging `No push tokens registered` each
time. Two client modules (`src/utils/fcm.ts`, `src/utils/notifications.ts`) are
dead code.

**Consequence for this plan:** adding notify checkboxes on top of this produces
four controls that cannot work — exactly the failure mode `CLAUDE.md` is written
against. Push delivery has to be made real *first*, as its own phase, or the
checkboxes are decoration.

That phase is not small. It is permission UX, a service worker, a VAPID key, token
storage, and token pruning. It is sized separately in §2.1.

---

## 1. Part A — recurring sabha as a rule

### 1.1 What exists today

`updateSabhaRecurrence` **materialises** dates: it writes one `events/{date}`
document per occurrence out to a horizon (`weeksAhead`, 1–26), and a
`generatedThrough` high-water mark stops a deleted date being recreated.

Production right now:

```
settings/sabhaRecurrence
  enabled: true, daysOfWeek: [5], 19:30–22:00
  weeksAhead: 10, generatedThrough: 2026-10-26

events — 8 generated docs, 2026-08-21 … 2026-10-23 (fromRecurrence: true)
       — 2026-09-18 and 2026-09-25 were already cancelled and correctly skipped
       — 6 past dates from time-shift testing
```

### 1.2 What replaces it

The rule becomes the **source of truth**, and `events/{date}` documents become
**exceptions only** — the RRULE + EXDATE shape from iCalendar.

**`settings/sabhaRecurrence`** — `weeksAhead` and `generatedThrough` are deleted.

```ts
{
  enabled: boolean
  daysOfWeek: number[]        // 0 = Sunday … 6 = Saturday
  startTime: 'HH:MM'
  endTime: 'HH:MM'
  venue?: Venue | null        // default venue for occurrences
  agenda?: string
  updatedAt, updatedBy
}
```

**`events/{YYYY-MM-DD}`** — no longer a gathering, but a divergence from the rule.

```ts
{
  date: string
  kind: 'override' | 'one-off'     // NEW, explicit rather than inferred
  status: 'scheduled' | 'cancelled'
  startTime, endTime, venue, agenda
  createdAt, updatedAt, updatedBy
}
```

### 1.3 The two functions this reduces to

Both pure, both the whole of the risk, both directly testable:

```ts
/** Date keys the rule covers in [fromKey, toKey]. No watermark, no occupied set. */
export function occurrencesBetween(rule, fromKey, toKey): string[]

/** What is actually happening on this date, rule and exception combined. */
export function effectiveEvent(dateKey, rule, exception): SabhaEvent | null
```

`effectiveEvent`, in priority order:

| Exception | Rule covers date | Result |
|---|---|---|
| `status: 'cancelled'` | either | **null** — nothing happens |
| `kind: 'one-off'` | no | the exception |
| `kind: 'override'` | yes | the exception |
| none | yes | derived from the rule |
| none | no | **null** |

`findCurrentEvent` then becomes: compute candidate dates in
`[today, today + LOOKAHEAD_DAYS]`, run **the same single range query it already
runs** for exceptions in that window, merge, return the first scheduled result.
**No additional reads** — the cost is identical to today.

### 1.4 What gets deleted

This is a net reduction, which is the strongest signal the model is right:

| Deleted | Why |
|---|---|
| `topUpCalendar` | nothing is materialised any more |
| `advanceWatermark` | no generation, no watermark |
| `datesToGenerate` | replaced by `occurrencesBetween` |
| `generatedThrough` | ditto — **and with it the entire resurrection bug class** |
| `weeksAhead`, `MIN/MAX/DEFAULT_WEEKS_AHEAD` | no horizon |
| `seedFirstEventIfNeeded` | see note below |
| `ensureSabhaEvents` (the scheduled job) | its only remaining job was generating |

**The resurrection guard disappears entirely.** Today's design needs two guards
(watermark for deletions, `occupied` for cancellations) because it creates
documents. Under a rule, "cancel this Friday" *is* a document, and it persists by
existing. One mechanism instead of two, and the bug it defended against becomes
structurally impossible.

**Careful with `seedFirstEventIfNeeded`:** its marker doc `system/eventGenerator`
also holds `pendingAttendanceDeletes`, drained by `sweepPendingAttendanceDeletes`.
The document must stay; only the seeding fields go unused. Deleting the function
is safe, deleting the doc is not.

### 1.5 Semantics that need a decision, not a guess

**Editing a date detaches it from the rule.** Recommended: an override stores a
**full snapshot**, so a date whose venue you changed keeps its own time too and
will not follow later changes to the weekly schedule. The alternative — partial
overrides, where an edited date still picks up a later rule time change — is more
correct in the abstract but requires the UI to track *which fields* the manager
touched, and this repo has three managers. Full snapshot, with one line of copy
saying so: *"Edited dates keep their own time and venue."*

**Turning the rule off.** One-offs survive; overrides become inert (they override
nothing). Their documents stay, so re-enabling the rule restores them. The
calendar should stop listing inert overrides.

**Unchanged by all of this:** `weeklyAttendance/{eventId}` and
`statistics/{date}` are keyed by date string, and a rule-derived occurrence still
has one. `recordEventDetails` keeps working. No migration there.

**`deleteSabhaEvent` gets simpler.** Its cascade (cancel requested rides, notify
riders, park the attendance delete) is unchanged; the one line
`batch.delete(eventRef)` becomes a write of a cancellation exception.

### 1.6 Migration

`scripts/migrate-recurrence-to-rule.cjs`, dry-run by default, following
`repair-fleet.cjs` conventions.

1. Delete `events/*` where `fromRecurrence === true` **and** date ≥ today — the 8
   generated docs. Left in place they become overrides that shadow the rule:
   harmless while identical, silently wrong the moment the rule changes.
2. Leave past dates alone. They are history and the statistics reference them.
3. **Leave `2026-09-18` and `2026-09-25` exactly as they are.** They are already
   `status: 'cancelled'`, which is precisely the cancellation exception the new
   model wants. Zero work, and a useful check that the model fits the data.
4. Strip `weeksAhead` and `generatedThrough` from `settings/sabhaRecurrence`.
5. Audit row via `auditLogs` (see the note in `clear-stale-presence.cjs`).

### 1.7 UI

**`RecurringSabha`** — drop the "weeks ahead" input. The card reads:

> **Every Friday, 7:30–10:00 PM** · repeating until you change it

**`SabhaCalendar`** — one recurring card at the top, then the next ~8 computed
occurrences, each labelled by provenance:

| Label | Meaning |
|---|---|
| *(none)* | straight from the weekly schedule |
| **Edited** | an override exists |
| **Cancelled** | a cancellation exception |
| **One-off** | a date the rule does not cover |

The occurrence list matters: the request says "one card", but a manager still has
to cancel a specific Friday. The card is the *schedule*; the list is what it
produces. Editing a row writes an exception rather than mutating a generated doc.

### 1.8 Tests

- `occurrencesBetween` — multiple days a week, DST boundaries (already have
  `dayOfWeekForKey` at UTC noon), disabled rule, empty range
- `effectiveEvent` — the full priority table above, one case per row
- `findCurrentEvent` — cancelled next occurrence skips to the following one; a
  one-off outranks nothing; an inert override is ignored
- A ratchet asserting `generatedThrough` appears nowhere, so the watermark cannot
  be reintroduced by habit

---

## 2. Part B — notify on change

### 2.1 Phase 0: make push real (prerequisite)

Without this the checkboxes are dead controls. Scope:

1. **Ask at the right moment.** Not on load — browsers penalise that and users
   deny it. Ask after the first successful ride request, when the value is
   obvious, with a one-line explanation.
2. **Save the token** to `users/{uid}.fcmToken`, and re-save on refresh —
   FCM rotates tokens.
3. **`public/firebase-messaging-sw.js`** for background messages. Note this app
   already ships a PWA service worker via `vite-plugin-pwa`; the two must
   coexist (`injectManifest` or an explicit second registration).
4. **VAPID key** via `import.meta.env.VITE_FIREBASE_VAPID_KEY`. The current
   `process.env` read is `undefined` under Vite — this is a live bug in dead code.
5. **Prune dead tokens.** `sendMulticastNotification` returns per-token failures;
   on `messaging/registration-token-not-registered`, clear that user's token.
   Without pruning the list rots and every send slowly degrades.
6. **A visible state** in Profile: notifications on/off, and a way to re-ask if
   they were denied (the browser will not re-prompt).

### 2.2 The write-path problem

A browser cannot send FCM. And **three of the four screens write directly to
Firestore**, not through a callable:

| Screen | Current write path |
|---|---|
| Ride Window | `manuallyUpdateRideContext` — **already a callable** ✅ |
| Sabha Calendar | `createEvent` / `updateEvent` — client `setDoc`/`updateDoc` |
| Venue | `updateSabhaLocation` — client `setDoc` |
| Fleet | `createVehicle` / `updateVehicle` / `deleteVehicle` — client writes |

Three options:

| Option | Verdict |
|---|---|
| Move every write behind a callable | Architecturally right, and would close a real gap — **venue and fleet writes have no `assertApprovedManager` and no audit row today**. But it is an auth refactor the user did not ask for. |
| Firestore `onWrite` triggers | Catches every change including Database Console edits, but the *intent to notify* is transient and would have to be persisted, which is a wrong-shaped field. No triggers exist in this codebase yet. |
| **A dedicated `notifyChange` callable, called after a successful write** | **Recommended.** Smallest change, leaves write paths untouched. Downside: two round trips that can fail independently — but a missed push is not a data-integrity failure. |

### 2.3 `notifyChange` must not be a megaphone

**The client must not send the message text.** Any approved manager would
otherwise be able to push arbitrary content to every device in the congregation,
including minors'. Instead:

```ts
notifyChange({ category: 'calendar' | 'window' | 'venue' | 'fleet' })
```

- `assertApprovedManager`
- the **server reads current state and composes the message**, so the
  notification cannot describe a change that did not happen
- audience by category
- rate limited
- one audit row per send

Message shape, composed server-side from live state:

| Category | Audience | Example |
|---|---|---|
| `calendar` | everyone | *"Sabha schedule updated — next sabha Friday 21 Aug, 7:30 PM"* |
| `window` | everyone | *"Ride requests are open — Home → Sabha"* |
| `venue` | everyone | *"Sabha venue is now 360 Huntington Ave, Boston"* |
| `fleet` | **drivers only** | *"The fleet changed — 4 cars available"* |

### 2.4 Selecting drivers is not a query

`grantedRoles` is **derived**, not stored. Production has no `grantedRoles` field
on any document; drivers are identified by `roles` containing `driver`, or
`manager` (which implies driver through `IMPLIES`).

Measured: 13 users, **3 drivers** — Tonny Stark (manager → driver), Dido Re, Tala
Das.

So `notifyDrivers` must read the users collection and filter in memory with
`hasGrantedRole(user, 'driver')`. Fine at 13 users; mark it `ponytail:` with the
ceiling, since it is an unbounded collection read per send.

**Also fix while here:** `notifyEveryone` does **not** filter on
`accountStatus === 'approved'`. It currently pushes to pending and rejected
accounts. That is a small privacy leak and belongs in the same pass.

### 2.5 Rate limiting

A manager nudging the venue three times should not send three pushes. Two
defences, both wanted:

1. The checkbox is **per save**, so they can leave it unticked while iterating.
2. Server-side, one send per category per 5 minutes, via the existing
   `functions/src/utils/rateLimiter.ts` (`checkRateLimit`). A suppressed send
   returns a clear result the UI can show — *"Already notified a moment ago"* —
   rather than silently doing nothing.

### 2.6 UI

One shared component, four uses:

```tsx
<NotifyOnSave category="venue" checked={notify} onChange={setNotify} />
// "Tell everyone about this change"   /  "Tell drivers about this change"
```

Placed next to the save button on `RecurringSabha`, `SabhaCalendar` (row edit and
add), `RideWindowControl`, `LocationSettings`, `FleetManagement`.

**Default unchecked.** A manager fixing a typo should not have to remember to
untick. The arguable exception is Sabha Calendar, where changes are the ones
people most need to hear about — worth deciding explicitly rather than by default.

The result should say what happened: *"Saved. 9 people notified."* or *"Saved.
Nobody has notifications turned on yet."* The second string matters — until Phase
0 lands and people opt in, that is the honest outcome and the manager should see
it rather than assume delivery.

### 2.7 Tests

- `notifyChange` refuses a non-manager; refuses an unknown category
- fleet category reaches drivers and **not** students — asserted on the recipient
  list, including the manager-who-drives case
- everyone-categories exclude pending and rejected accounts
- rate limit suppresses a second send and says so
- message composition reads live state (a changed venue appears in the body)
- **the checkbox actually reaches the callable** — the recurring failure in this
  repo is a control that looks wired and is not
- token pruning clears a token FCM reports as unregistered

---

## 3. Order of work

| # | Phase | Depends on | Rough size |
|---|---|---|---|
| 1 | Part A — rule model, migration, UI | — | Largest, but net **deletes** code |
| 2 | Part B Phase 0 — make push real | — | Medium; independent, can run in parallel |
| 3 | Part B Phase 1 — `notifyChange` + checkboxes | Phase 0 | Small once Phase 0 is done |

Part A is self-contained and worth doing first: it removes machinery rather than
adding it, and it is the thing the user will see immediately. Part B Phase 0 has
no product surface at all, which makes it easy to skip and the reason the
checkboxes would otherwise ship dead.

Deploy order unchanged: `firestore:rules` → `functions` → `hosting`, then
fast-forward `main`. Rules need no change for either part.

---

## 4. Decisions — settled with the owner 2026-08-17

| # | Question | Decision |
|---|---|---|
| 1 | Checkbox meaning | **Manager-side send toggle.** Not a per-user preference. |
| 2 | Calendar layout | **The recurring card plus upcoming dates**, in an optimised view. |
| 3 | Editing one date | **Only that week is affected.** The rule and every other week stay exactly as they were → confirms the exception model, and confirms **full-snapshot overrides**. |
| 4 | Checkbox default | **Nothing selected.** Unchecked on all five screens, Sabha Calendar included. |
| 5 | Permission prompt | **After onboarding completes**, for all users. |

Sequencing agreed: **Part A first**, as recommended.

## 5. Superseded open questions

1. **"a check box … for every profile"** — read here as a manager-side *send*
   toggle ("notify everyone about this change"). The other reading is a per-user
   *preference* ("I want to hear about venue changes"), which is a different and
   larger feature. Which?
2. **Does the calendar show only the recurring card, or the card plus upcoming
   occurrences?** A manager needs some way to cancel one specific Friday; §1.7
   assumes a compact list underneath.
3. **Override semantics** — full snapshot (recommended, simpler) or partial?
4. **Default checkbox state** — unchecked everywhere, or checked for Sabha
   Calendar?
5. **When to ask for notification permission** — after the first ride request is
   the recommendation; anywhere earlier gets denied.
