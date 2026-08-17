# Recurring sabha as a rule

**Shipped and live, 2026-08-17.** `70b4a60`, bundle `index-9Hrssg9d.js`.

The recurring sabha is one rule that repeats until a manager changes it, with
`events/{date}` documents as its exceptions. Part A below is the design as built.

## Notify-on-change: dropped, 2026-08-17

This plan originally had a Part B — a manager-side "notify everyone" checkbox on
Sabha Calendar, Ride Window and Venue, and a drivers-only one on Fleet. **The
owner dropped it:** *"lets erradicate this notification planning completly. If in
future we want we can include that but we dont need right now."*

Removed rather than deferred. The design notes are in git history if it comes
back (`docs/plans/recurring-rule-and-change-notifications.md` before this commit).

**The one fact worth carrying forward, because it will mislead somebody
otherwise:** push notifications have never worked in this app, and that is
independent of the dropped feature.

| Measured 2026-08-17 | |
|---|---|
| Users with an `fcmToken` | **0 of 13** |
| Anything that calls `src/utils/fcm.ts` | **nothing** |
| `public/firebase-messaging-sw.js` | **does not exist** |
| VAPID key | read via `process.env` in `fcm.ts`, which is `undefined` under Vite |

So every existing `notifyEveryone` call — the ride-window announcement, the
sabha-deletion notice, driver and rider assignment alerts — runs, logs
`No push tokens registered`, and delivers nothing. `src/utils/fcm.ts` and
`src/utils/notifications.ts` are dead code.

Nothing is broken by this that was not already broken. But do not assume a
notification reaches anyone, and do not build a feature on top of it without
doing the delivery work first: permission UX, a service worker alongside the PWA
one, the VAPID fix, token storage, and pruning tokens FCM reports as
unregistered.

## The design, as built

### What it replaced

`updateSabhaRecurrence` **materialised** dates: it wrote one `events/{date}`
document per occurrence out to a horizon (`weeksAhead`, 1–26), and a
`generatedThrough` high-water mark stopped a deleted date being recreated.

Production immediately before the change:

```
settings/sabhaRecurrence
  enabled: true, daysOfWeek: [5], 19:30–22:00
  weeksAhead: 10, generatedThrough: 2026-10-26

events — 8 generated docs, 2026-08-21 … 2026-10-23 (fromRecurrence: true)
       — 2026-09-18 and 2026-09-25 were already cancelled and correctly skipped
       — 6 past dates from time-shift testing
```

### What replaced it

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

### The functions it reduces to

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

### What was deleted

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

### Semantics, decided rather than guessed

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

### Migration

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

### UI

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

### Tests

- `occurrencesBetween` — multiple days a week, DST boundaries (already have
  `dayOfWeekForKey` at UTC noon), disabled rule, empty range
- `effectiveEvent` — the full priority table above, one case per row
- `findCurrentEvent` — cancelled next occurrence skips to the following one; a
  one-off outranks nothing; an inert override is ignored
- A ratchet asserting `generatedThrough` appears nowhere, so the watermark cannot
  be reintroduced by habit

---

## Decisions — settled with the owner 2026-08-17

| # | Question | Decision |
|---|---|---|
| 1 | Calendar layout | The recurring card plus upcoming dates, in an optimised view. |
| 2 | Editing one date | **Only that week is affected.** The rule and every other week stay exactly as they were → full-snapshot overrides. |
| 3 | Notify-on-change | **Dropped entirely.** Not deferred. |

Questions 1, 4 and 5 from the original plan concerned the notification feature
and are moot.

## What shipped, and what it deleted

| Deleted | Why |
|---|---|
| `topUpCalendar` | nothing is materialised |
| `advanceWatermark`, `generatedThrough` | nothing to remember, so nothing to resurrect |
| `datesToGenerate`, `weeksAhead` + its three bounds | no horizon |
| `seedFirstEventIfNeeded`, `weeklySlotDate`, `toEvent` | 121 lines out of `events.ts` |
| `ensureSabhaEvents` | a nightly job materialising what can be computed |

Migration ran the same day: 16 event documents down to 8, and `2026-08-17`
stamped `one-off` — a Monday gathering that would otherwise have gone inert
against the Friday rule and silently vanished. Found by running the dry run
rather than trusting the plan.

Verified in production afterwards: `rideContext` read `eventId 2026-08-17`,
`calendarStatus ok`, computed from the rule with no stored Friday dates at all.
