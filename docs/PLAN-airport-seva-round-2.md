# Airport Seva, round two — five changes and what they knock into

Planning note for the 2026-08-25 review. **Nothing here is implemented.**

Owner's five items, plus the answers given on the four questions I raised:

1. Welcome screen — greet properly, friendly, no emojis.
2. Request form — keep the meeting point but simplify its example, cut the clutter.
3. Manager must not see the claim button; shorten the button wording; `Call <name>` → `Call`.
4. Audit every action button end to end; shorten every label.
5. Traveller can edit after booking; the Sarthi is told when something important changes.

Answers that changed the shape of this: **notifications are in scope** (they exist on the
sabha side and are wanted here); the meeting-point field **stays**, only its placeholder
changes; **reassign is removed entirely** — "sarthi releases and other sarthi can pick it
up".

---

## 0. The thing to read first: removing reassign strands `no_show`

`functions/src/utils/arrival.ts` is the shared transition table. Two lines matter:

```ts
release:  ['claimed'],
reassign: ['claimed', 'no_show'],
```

**`reassign` is the only action allowed out of `no_show`.** Delete it and "Could not find
them" becomes a one-way door. The trip freezes with `status: 'no_show'` forever, and
because every "needs somebody" count in the app filters on `status === 'open'`, that trip:

- draws **no badge** on the calendar,
- is absent from "still needs a Sarthi this month",
- is skipped by `alertUnclaimedArrivals` (it filters `status !== 'open'`),
- and still shows the traveller *"this request needs somebody to reassign it"*
  (`ArrivalStatusCard.tsx:171`) — advice for a thing that no longer exists.

A traveller standing in an airport, marked as not-found, invisible to every screen that
exists to catch exactly that. This is the app's signature defect in its worst form.

**So the reassign removal and this fix must be one commit, never two:**

```ts
release: ['claimed', 'no_show'],
```

A no-show goes back on the board and any Sarthi can take it — which is precisely the model
asked for. `release` already clears `claimedByUid/Name/claimedAt/metAt`, so nothing else
changes. The permission arm (`isMine || isCoordinator`) still holds: `no_show` does not
clear `claimedByUid`, so the Sarthi who marked it can still release it.

### Coordinator release is now the only recovery lever — keep it

Reassign was how a coordinator rescued a trip from a Sarthi who had gone quiet. With it
gone, the replacement is that a **coordinator can `release` a trip they do not hold**
(already true — the `isMine || isCoordinator` arm). That arm must stay, or an unresponsive
Sarthi becomes unrecoverable. Worth stating out loud because "keep it simple" could
otherwise be read as removing that too.

### What the removal deletes

- `reassign` from `ALLOWED_FROM`, `RESULT_OF`, `ArrivalAction`, `AUDIT_FOR`, and the
  `ACTIONS` list — in **both** mirrored copies (`src/` and `functions/src/`), pinned by
  `tests/quality/arrival-table-parity.test.ts`.
- The whole `reassign` branch of `updateAirportPickup` — including the pre-transaction
  `toUid` lookup and the `isApprovedDriverData(targetData)` check.
- In `ArrivalCard.tsx`: `canReassign`, `picking`, `reassigningTo`, the button, the
  `<DriverPicker>`, and the `useAvailableDrivers()` call.

**One quiet win:** `useAvailableDrivers()` runs in the body of *every* `ArrivalCard`, so a
day with six arrivals opens six live listeners on the users collection. Removing reassign
removes all of them.

### Wording that becomes false

| where | now | must become |
|---|---|---|
| `ArrivalCard.tsx:81` no-show confirm | "A coordinator will be able to reassign it." | "It goes back on the board for another Sarthi." |
| `ArrivalStatusCard.tsx:171` | "this request needs somebody to reassign it" | "we are finding you another Sarthi" |

---

## 1. Welcome screen (`components/auth/RoleSelection.tsx`)

Copy only, three strings. No logic.

| line | now | proposed |
|---|---|---|
| 242 | "We will meet you at arrivals" | *unchanged — it is already right* |
| 284 | "Welcome — we will collect you" | **"Jai Swaminarayan!"** |
| ~287 | "Next you will tell us your flight, and a Sarthi will be at arrivals to meet you. You will not be asked for an address here; your pickup takes the destination you give it." | **"Tell us about your flight and a Sarthi will be waiting for you at arrivals. Nothing else to arrange — we will take it from there."** |

Dropping the address sentence is deliberate: it explains the *absence* of a field, which
nobody is wondering about, and it is the longest clause on a welcome screen.

**Ripple:** none. `RoleSelection.tsx` is reached before any pickup exists. Check
`tests/components/RoleSelection*.test.tsx` for assertions on these exact strings.

---

## 2. Request form (`components/airport/ArrivalRequestForm.tsx`, 621 lines)

### 2a. The meeting-point example

Line 483, placeholder only — field kept, as instructed:

> `By the exit doors at arrivals, holding a sign with my name` → **`Meet at arrivals`**

### 2b. The clutter

Every helper line below is a candidate. Listed individually so each can be vetoed —
some carry real information and I would not cut all of them.

| line | now | proposed | note |
|---|---|---|---|
| 316 | "So your Sarthi allows time for immigration and baggage." | **cut** | the checkbox label already says "international" |
| 341–344 | "Be honest about the suitcases — it decides which car can come. Two people with four large cases do not fit in a saloon." | **"Bags decide which car can come."** | keep, shortened — this one prevents a real failure |
| ~380 | (destination hint) | shorten | |
| 419 | "So your Sarthi can be sure they have met the right person." | **cut** | |
| 479 | "Most people arrive on a dead SIM. If you will not, agree a meeting point below." | **"Most people land on a dead SIM."** | keep — it is why the meeting point exists |
| 497 | "Your Sarthi can message your family to say you have been met and you are safe. Give a number and it takes them one tap." | **"We can message your family once you are met."** | |
| `PhoneNumberInput.tsx` | "Phone numbers are kept private and used exclusively for ride updates and volunteer driver/student pickup coordination." | **"Kept private, used only for your pickup."** | **shared with Sabha Seva — changing it changes both** |

### 2c. A real bug found while reading this screen

`components/auth/PhoneNumberInput.tsx:161`:

```tsx
✓ Valid phone number ({selectedCountry.dialCode} {validation.e164})
```

`e164` **already contains** the dial code, so the screenshot reads
`✓ Valid phone number (+91 +911293812944)`. Fix is to drop `selectedCountry.dialCode`.

**This component is used by Sabha Seva too**, so the fix lands app-wide — good, but it
means the sabha test suites must be re-run, not just the airport ones.

---

## 3. The manager must not see "I'll collect them"

### The gate

`ArrivalCard.tsx` currently filters actions on `isMine || isCoordinator`, with `claim`
special-cased only to exclude the traveller's own arrival. There is **no role check at
all** — and because the role hierarchy expands downward (`manager → driver → student`),
every manager is a granted Sarthi and sees the claim button.

Proposed: `claim` renders only when `activeRole === 'driver'` — the hat currently worn in
the switcher, not the capability held.

### The trap this walks into

A UI-only gate on a server action that still permits managers is *correct* — but a manager
who looks at the board and finds the button simply gone will think it broke. That is the
"capability that silently disappeared" half of this repo's signature defect.

**Mitigation, and I would not ship the gate without it:** where the button would have been,
a manager sees one line —

> *Switch to Sarthi to collect someone yourself.*

The disappearance becomes an instruction. **The server stays permissive** — no change to
`updateAirportPickup`. A manager who claims via a stale tab still succeeds, which is right;
the gate is about what we *offer*, not what we *allow*.

### RESOLVED: the manager keeps the oversight buttons

**Owner's decision: yes, keep them.** So `claim` is the *only* action gated on
`activeRole`. "I've found them", "Dropped off", "Couldn't find them" and "I can't go" stay
available to a coordinator on trips they do not hold, from the existing `isCoordinator` arm.

That arm is now load-bearing: with reassign gone, a coordinator releasing somebody else's
trip is the **only** way to recover one from a Sarthi who has gone quiet. A test should pin
it so a future tidy-up cannot quietly remove it.

---

## 4. Every button, audited

### 4a. The labels

| now | proposed |
|---|---|
| I will collect them | **I'll collect them** |
| I have met them | **I've found them** |
| Dropped off safely | **Dropped off** |
| Could not find them | **Couldn't find them** |
| Hand this back | **I can't go** |
| Tell the family they are safe | **Tell the family** |
| Give this to another Sarthi | *(removed — section 0)* |
| Call | **Call** *(unchanged)* |
| Call other number | **Call second number** |
| Call Sheetal | **unchanged — see below** |

**"I can't go"** rather than "Hand this back": it says why the person is tapping it, and it
is what they would say out loud.

### 4b. The `Call <name>` question — RESOLVED, and it needs no change

The original ask read as *"just 'call' instead of 'call [name of person arriving]'"*. The
button carrying a name is `Call Sheetal`, and Sheetal is the traveller's **mother**, not the
traveller — the traveller's own button is already plain `Call`.

**Owner's decision: show the family member's name.** That is exactly what ships today, so
**this button is not touched.** The pair stays `Call` / `Call <family name>`, which also
keeps two very different phone calls — a traveller at a barrier, and their mother in India
at 3am — impossible to confuse.

The only label that changes in this group is `Call other number` → `Call second number`.

### 4c. The audit itself

Each action, traced from tap to every surface that must reflect it:

| action | server | board count | day list | traveller's screen | audit row | push |
|---|---|---|---|---|---|---|
| claim | ✓ | ✓ open→claimed | ✓ | ✓ "A Sarthi is coming" | ✓ | **none — gap** |
| met | ✓ | — | — | ✓ | ✓ | **none — gap** |
| completed | ✓ | ✓ (fixed today) | ✓ | ✓ | ✓ | none |
| no_show | ✓ | **dead end — §0** | — | ✓ | ✓ | none |
| release | ✓ | ✓ claimed→open | ✓ | ✓ | ✓ | **none — gap** |
| cancel | ✓ | ✓ hidden | ✓ | ✓ | ✓ | none |
| familyNotified | ✓ | — | stamp only | — | ✓ | n/a |
| editFlight | ✓ | ✓ | ✓ | ✓ | ✓ | **none — §5** |

Known defects to fold in while here:

- **`releaseReason` is written and never displayed.** `updateAirportPickup.ts:238` stores
  it, `types.ts:782` declares it, no component reads it. A Sarthi's "car trouble" goes into
  the database and no human ever sees it. Surface it on the card once the trip is back on
  the board.
- **`alertsSent` is never cleared on release.** A band that already fired while the trip was
  open earlier will not fire again after it comes back, so a late hand-back can go
  unannounced. Clear `alertsSent` in the `release` branch.
- **`familyNotified` is fire-and-forget** (`.catch(() => undefined)`). Deliberate and
  correct — the WhatsApp message has already gone — but worth a comment saying so.

### 4d. Tests

Per the standing convention, every defect above leaves a named test. New cases:

- `no_show` → `release` → back on the board as `open` (the §0 guard).
- The transition table no longer contains `reassign`, in both mirrors.
- A manager (`activeRole: 'manager'`) sees no claim button but **does** see the switch hint.
- A Sarthi (`activeRole: 'driver'`) still sees it.
- `releaseReason` renders on a released trip.

---

## 5. Traveller edits, and telling the Sarthi

### 5a. What can be edited

`editFlight` today accepts only the flight block — `arrivalDate`, `arrivalTime`,
`airportCode`, `airline`, `flightNumber`, `terminal`, `isInternational`
(`arrivalInput.ts:166`). Everything else a traveller typed is frozen the moment they
submit.

Proposal: rename to **`editRequest`** and widen it to cover what the form collects, minus
identity and status. `parseFlight` stays as-is and gains a sibling for the rest, reusing
the validators `requestAirportPickup` already runs — so the edit path cannot accept
anything the create path would have rejected.

Not editable: `requesterUid`, `status`, any `claimedBy*` field, `createdAt`.

Timing stays as the table already has it — `['open', 'claimed']`. Once the Sarthi taps
"I've found them", the trip is not editable, which is right: they are in the car.

### 5b. Which changes reach the Sarthi — the rule

The test I applied: **would the Sarthi drive differently, arrive at a different time or
place, or fail to recognise the person?** If not, it does not interrupt them.

**Notified:**

| field | why |
|---|---|
| arrival date / time | already the loudest case |
| airport code | a different city |
| terminal | where they physically stand |
| party size, large bags, cabin bags | whether their car fits it |
| destination address | how long the drive is |
| `hasUsWorkingPhone`, meeting point | how the two of them find each other |
| traveller phone | how to reach them |

**Not notified** (still saved, still visible on the card): preferred name, university or
employer, notes, stop-on-the-way, family contact name, relationship, language.

**Owner's decision: the family contact's phone does NOT notify.** It joins the quiet
group — saved, shown on the card, no interruption. Right call: it changes who the Sarthi
reassures afterwards, not how or when they drive.

### 5c. How the Sarthi is told — two channels, not one

**In-app is the guaranteed path. Push is the backstop.** Airport Seva already says exactly
this in `alertUnclaimedArrivals.ts`, and it is right: push has delivered essentially
nothing in this app's life because nobody has been asked to enable it. A feature whose only
channel is push reaches nobody today.

**In-app.** Generalise the existing marker. Today `arrivalTimeChangedAt` drives one red
line on the card. Replace with:

```ts
changedAt?: string | null;
changedFields?: string[] | null;
```

so the card can say *"The flight time and terminal changed since you claimed this"* instead
of a fixed sentence about time alone. `arrivalTimeChangedAt` is removed in the same commit —
it exists in both `types.ts` mirrors, `updateAirportPickup`, `ArrivalCard`, and its tests.

**Owner's decision: clear the marker on `met`.** Today it is set and never cleared, so the
red line persists for the life of the trip and decays into wallpaper. Clearing it when the
Sarthi taps "I've found them" is right — by then they have the person, and whatever changed
is behind them.

Concretely, the `met` branch of `updateAirportPickup` sets `changedAt: null` and
`changedFields: null` alongside `metAt`. Needs a test: a trip edited *and then* met must not
still be showing the warning.

**Push.** Follow the sabha pattern exactly — a named helper in
`functions/src/utils/notifications.ts` beside `notifyStudentDriverAssigned` and friends,
called **after** the transaction commits, never throwing:

```ts
notifyArrivalChanged(recipients, summary)
```

Recipients come from `tokensOf(pickup.claimedByUid, sarthiDoc)`. Only when the trip is
`claimed` — an edit to an unclaimed request is news to nobody.

### 5d. Where the edit button goes

`ArrivalStatusCard.tsx`, above "Cancel this pickup": **"Change my details"**, rendered only
when the table permits it. Reuses `ArrivalRequestForm` in an edit mode pre-filled from the
live document, rather than a second form to keep in step.

**Ripple:** `AirportShell.tsx`'s `TravellerView` currently shows *either* the form *or* the
status card, keyed on whether a live arrival exists. It gains a third state — status card
plus form-in-edit-mode. The `resetKey` remount trick already there covers the return trip.

### 5e. Rules and trust boundary

No `firestore.rules` change. `airportPickups` is already `allow create, update, delete: if
false` for every client (`firestore.rules:916`), so the callable **is** the boundary and the
widened validation is the whole guard. This is the part not to be lazy about: the edit path
must run the same validators as create, or a traveller could put through a value the create
path refuses.

---

## Order of work, and what must ship together

| # | commit | why grouped |
|---|---|---|
| 1 | **Words only** — §1, §2a, §2b, §4a/§4b, plus the `PhoneNumberInput` doubled-dial-code fix | no logic; safe to ship and eyeball first |
| 2 | **Reassign out + `no_show` release in + dependent wording** | §0 — *must* be atomic, or the app has a dead end |
| 3 | **Claim gated on `activeRole` + the switch hint** | small, and reads better once §2 has cleared the card |
| 4 | **The button audit** — `releaseReason` surfaced, `alertsSent` cleared, tests | tidies what §2 exposed |
| 5 | **Edit + notify** — §5 | the only one touching functions; deploy needs the functions step |

Commits 1–4 are client-only; 5 is the one that makes `firebase deploy --only functions` do
real work. Deploy order is unchanged: **rules → functions → hosting**, then fast-forward
`main`.

## Verification

Full sweep, no shorter subset, before each deploy:

```
npx vitest run
npm test --prefix functions
npm run test:rules
npm run build
npm --prefix functions run build
npm run typecheck
```

Plus, because §2c touches a component Sabha Seva shares, the sabha suites are part of the
blast radius rather than a bystander.

And **look at it** — `npx vite build --config preview/vite.config.ts`, then
`preview/airport.html`. The preview fixtures cover open / claimed / mixed / past /
completed; they will need a `no_show` one for §0 and a `changedFields` one for §5, since
neither state exists in any fixture today. Every airport defect found by eye this week was
found in a state that had no fixture.

## Decisions taken, 2026-08-25

| # | question | answer |
|---|---|---|
| 1 | `Call` vs `Call family` vs the family member's name (§4b) | **the family member's name** — which is what ships today, so no change |
| 2 | Does a manager keep the oversight buttons (§3) | **yes** — `claim` is the only role-gated action |
| 3 | Does the family's phone number notify the Sarthi (§5b) | **no** — it joins the quiet group |
| 4 | Does the change flag clear on "I've found them" (§5c) | **yes** — cleared in the `met` branch |

Nothing is open. The plan is ready to build in the five-commit order above.
