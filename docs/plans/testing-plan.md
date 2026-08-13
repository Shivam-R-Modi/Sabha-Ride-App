# Sabha Ride Seva — Testing Plan

Draft for review. Add your own cases, delete what you think is not worth the
time, and mark anything you disagree with — this is meant to be edited.

---

## 1. What this plan is for

The app already runs **743 automated tests**. This plan deliberately does **not**
repeat them. It covers the things a test suite structurally cannot reach:

- **Two people acting at the same moment.** Dispatch is driver-pull — a driver
  taps and claims riders. Two drivers tapping within the same second is the
  single most likely way this app goes wrong in the field, and it needs two real
  devices.
- **Time.** Almost everything here is gated on a ride window that the server
  opens and closes. Most of it cannot be exercised without either waiting for a
  Friday or deliberately moving the window.
- **Real phones.** Touch targets, one-handed reach, sunlight, a cracked 5-year-old
  Android, iOS Safari's own opinions.
- **Real data.** A family of five. A rider with no phone number. A driver who
  goes offline mid-run.
- **Whether it is any good.** No test says "this screen is confusing".

### Who this is for

Whoever runs a release. Expect **90 minutes** for a full pass, **15 minutes** for
the smoke suite before a routine deploy.

---

## 2. Already covered — do not retest by hand

| Layer | Count | What it proves |
|---|---|---|
| Firestore rules | 81 | Who can read and write what. Includes revoked-manager cases. |
| Cloud Functions | 245 | Assignment, seats, splitting, invites, CSV, auth guards. |
| Client logic + components | 417 | Screen states, seat maths, the rider state machine, theme tokens, contrast. |

**Run these first. If any fail, stop — there is no point hand-testing a broken build.**

```
npx vitest run
npm test --prefix functions
npm run test:rules
npm run build
npm run typecheck        # 55 errors is the expected baseline, not a failure
```

---

## 3. Environment

**There is one Firebase project, and it is production.** See
`docs/environments.md` for why staging was removed.

| | Use for | Notes |
|---|---|---|
| **Preview** (`preview/`) | Every screen, both themes, no sign-in | Stubbed data. Cannot break anything. **Start here.** |
| **Local** (`npm run dev`, :3000) | Everything except push notifications | Needs `.env.local`. Points at **real Firebase — this is live data.** |
| **Production** (deployed) | Smoke only, after deploy | Service worker caches hard; unregister it before checking. |

⚠️ **Local is not a sandbox.** `npm run dev` reads and writes the same database
the congregation uses. A ride you create on localhost is a real document. Every
case below that writes data says so, and says how to clean up.

**Rule: anything you create, you delete.** Test rides, test events and test
accounts left behind end up in a manager's export alongside real families.

### Test accounts needed

| Account | Role | State |
|---|---|---|
| `rider-a@…` | student | approved |
| `rider-b@…` | student | approved, address on the far side of town from rider-a |
| `rider-family@…` | student | approved, will request 5 seats |
| `rider-pending@…` | student | **pending** — never approve it |
| `driver-a@…` | driver | approved |
| `driver-b@…` | driver | approved — needed for the concurrency suite |
| `manager@…` | manager | approved |
| `dual@…` | driver **and** manager | for role switching |

---

## 4. Controlling time — read this before anything else

Nearly every case depends on which ride window is open. There are three states:

| Window | What riders see | What drivers see |
|---|---|---|
| `home-to-sabha` | Request a ride | Find my next riders → pickups |
| `sabha-to-home` | I'm ready to leave | Find my next riders → drop-offs |
| closed (`null`) | Neither | Nothing to collect |

**A manager can move the window without waiting for Friday**, from the app —
no console, no code.

**Manager → Setup → Ride window.** Three buttons:

| Button | What it does |
|---|---|
| **Open ride requests now** | Riders can book. Drivers can collect pickups. |
| **Open drop-off now** | Riders can say they are ready to go home. |
| **Back to automatic** | Hands control back to the schedule. Only appears while an override is on. |

Each asks for confirmation first, and the panel says which window is live right
now.

⚠️ **This sends a push notification to everyone with notifications on.** It is
not a quiet test switch — it tells the congregation their ride window is open.

If nobody presses **Back to automatic**, the override expires at midnight in
Sabha local time and the schedule resumes on its own. Press it anyway — leaving
it on is the easiest way to confuse the next person, or a real rider.

### The better method: move the sabha, don't override the window

The override button writes a hand-built window and skips the real scheduling
logic. Editing the sabha's own times makes the **real** scheduler compute the
window from real data — the same code path that runs on a Friday night. Higher
fidelity, and it exercises the timezone handling too.

**Manager → Setup → Sabha Calendar** → edit the event. Set the start a few
minutes from now and the end at least 20 minutes after that. Example, at 1:57pm:

| Set | Result |
|---|---|
| Start `14:00`, End `14:20` | Pickup open until 2:00 · "Sabha in progress" 2:00–2:05 · Drop-off from 2:05 |

Four things to know:

1. **It must be the Sabha Calendar.** Setup → Location & Times sets defaults for
   *new* events only. Editing it does nothing to an already-scheduled sabha,
   despite showing a success message. (Tracked as a separate defect.)
2. **Leave more than 16 minutes between start and end.** Drop-off opens 15 min
   before the end. Any tighter and "in progress" collapses to nothing — pickup
   flips straight to drop-off.
3. **Wait up to 60 seconds.** The scheduler ticks every minute.
4. **If an override is active, time edits are ignored** until midnight. Press
   **Back to automatic** first.

### The one quiet window

Notifications fire on a *transition into* a ride type, not on every tick. So:

| Testing | Notifies? |
|---|---|
| Pickup, during the normal 2-day pickup window (already `home-to-sabha`) | **No** — no transition |
| Pickup, from a closed window | Yes |
| Drop-off, ever | Yes |

**So test pickup in the two days before sabha and it costs nothing.** Drop-off
testing always alerts the congregation — batch those cases into one session and
tell the coordinators first.

### Create a throwaway event, don't edit the real one

Add a **new event on today's date** rather than editing the upcoming sabha.
Test rides then file under today's key instead of polluting the real sabha's
attendance and reports. Delete it when you are done.

Two limits of a same-day test event:

- **Attendance is already locked** — it locks at 6pm the day before, so a
  same-day event is born locked. Attendance cases need an event 2+ days out.
- **Requests are already open** — `requestsOpenAt` is 2 days before. To test the
  "not open yet" state you need an event 3+ days out.

---

## 5. Suite A — Smoke test (15 min, before every deploy)

Stop and investigate on any failure.

| # | Step | Expect | ✅ |
|---|---|---|---|
| A1 | Load the app cold | Splash appears, dismisses itself in ~2s. No white flash. | |
| A2 | Sign in as a rider | Home shows **one** card | |
| A3 | Answer the attendance card "Yes" | Booking sheet opens over home | |
| A4 | Request a ride | Confirmation, and home now says waiting | |
| A5 | Sign in as driver, go on shift, pick a car | Car shows with plate | |
| A6 | Find my next riders | Preview lists the rider from A4 | |
| A7 | Accept, tick every stop, complete | Completion screen with the stats | |
| A8 | Manager → Dispatch | The ride appears under "Out now" | |
| A9 | Profile → Appearance → Night | Whole app goes dark, no light patches | |
| A10 | Reload | Still dark. No flash of light on load. | |

---

## 6. Suite B — Rider

| # | Case | Steps | Expect | ✅ |
|---|---|---|---|---|
| B1 | Attendance is not a trap | Answer "Not this time" | Card collapses to a short note. **Dashboard is still there** — it must not be replaced. | |
| B2 | Change of heart | Then tap "Actually, I'm coming" | Returns to the request card | |
| B3 | Attendance lock | As manager, pass the attendance lock time. As rider, try yes → no | Refused, with a reason naming the coordinator | |
| B4 | One action only | Look at home in each state | Never two competing primary buttons | |
| B5 | Window shut | With the window closed | "I'm ready to leave" is **not on screen at all** — not greyed out | |
| B6 | Booking keeps context | Open the request sheet | Home is visible behind it; Escape closes it | |
| B7 | Seat stepper | Try to go below 1 and above 8 | Buttons disable at the limits | |
| B8 | Keep together | Set 2+ seats | "Keep us in one car" appears, with the longer-wait warning | |
| B9 | Waiting state | After requesting | "Looking for a driver" — no fake ETA, no pulsing card | |
| B10 | Driver assigned | Once a driver accepts | Name, car, plate all fully readable — **not truncated** | |
| B11 | Call / Text | Tap each | Phone dialler / SMS composer open to the right number | |
| B12 | No phone on file | Driver with no number | Text button is **absent**, not dead | |
| B13 | Split party | Request 5 seats, have a driver take 3 | Banner: "3 of your 5 seats are with X … other 2 still waiting" | |
| B14 | Dismissed | Manager dismisses the request | Rider sees who dismissed it and a way to call them | |
| B15 | Ready to leave | Drop-off window open | Confirmation asked before the driver is told | |
| B16 | No sabha | Manager cancels everything | "No sabha scheduled yet" — not an error, not an empty screen | |
| B17 | Pending account | Sign in as `rider-pending` | Held at the pending screen; cannot reach the dashboard | |

---

## 7. Suite C — Driver

| # | Case | Steps | Expect | ✅ |
|---|---|---|---|---|
| C1 | Off shift | Fresh sign-in | One button: "Go on shift". **No second card repeating it.** | |
| C2 | Car is part of the shift | Go on shift with no car | Car picker opens as part of the flow | |
| C3 | **No dead button** | On shift, no car chosen | Button reads **"Pick a car to start"** and opens the picker. It must never be grey and unexplained. | |
| C4 | Passenger seats | Open the car picker | Shows **passenger** seats (capacity − 1), not capacity | |
| C5 | Car taken | Have driver-b take the last car first | "Every car is taken", not an empty list | |
| C6 | Nobody waiting | Tap Find riders with an empty queue | "Nobody is waiting right now" — button stays usable | |
| C7 | Preview then release | Get an assignment, release it | Riders return to the queue and can be claimed again | |
| C8 | Focus mode | Accept and start a run | **No bottom nav, no double header.** Full screen. | |
| C9 | Leaving mid-run | Tap back after ticking a stop | Asks first; progress is kept | |
| C10 | Navigation | Open in Google Maps | Opens with the full route, not just one stop | |
| C11 | No route | A ride with no route data | Button is disabled **and says why** | |
| C12 | Complete early | Complete with stops unticked | Asks for confirmation | |
| C13 | End shift | End my shift | Confirms; car returns to the fleet; today's tally resets | |
| C14 | Dark at night | Whole flow in Night mode | Readable at arm's length, **no glow around buttons** | |

---

## 8. Suite D — Manager

| # | Case | Steps | Expect | ✅ |
|---|---|---|---|---|
| D1 | One nav | Look at any manager screen | Bottom nav + the two dispatch tabs. **No unlabelled icon toolbar.** | |
| D2 | Counts | With riders waiting | Tab reads "Waiting · N" and people count when they differ | |
| D3 | **Assign asks who** | Tap Assign on a request | Picker opens showing drivers, cars, seats free, runs today | |
| D4 | Too-small car | Assign a 4-seat party | Driver with fewer seats is flagged "Only N" — but still selectable | |
| D5 | Nobody on shift | Assign with no drivers | "No driver is on shift", not silence | |
| D6 | Bulk on desktop | Tick rows, Assign Bulk | Only ticked rows are assigned | |
| D7 | **Bulk on a phone** | Long-press a card | Selection mode starts; swipe actions suspend | |
| D8 | Partial bulk failure | Assign more than a driver can hold | Reports honestly: "Assigned 3 of 5" | |
| D9 | Approvals | People tab | Drivers and riders separated, with counts | |
| D10 | Turn down asks | Turn down someone | Confirms first, and says what it means for them | |
| D11 | Setup sections | Open Setup | Five named sections, one open at a time | |
| D12 | Raw records warning | Open Setup → Raw records | Warning shown before the editor | |
| D13 | Release a driver | Live Operations → release | Soft vs full checkout both behave as labelled | |
| D14 | CSV | Download attendance | File downloads with the right people | |
| D15 | Empty CSV | Download with nobody attending | Clear message — **not a silently empty file** | |
| D16 | Role switch | As `dual@…`, switch driver ↔ manager | State survives the switch | |

---

## 9. Suite E — Two people at once ⚠️ highest risk

**These need two devices, side by side.** This is the area most likely to break
in real use and least covered by automation.

| # | Case | Setup | Expect | ✅ |
|---|---|---|---|---|
| E1 | Simultaneous claim | 1 rider waiting. Both drivers tap "Find my next riders" **on a count of three**. | Exactly one gets the rider. The other gets a clear message — never the same rider twice. | |
| E2 | Last car | 1 car free. Both drivers open the picker and tap it together. | One gets it. The other is told it has gone. | |
| E3 | Manager vs driver | Driver taps Find riders as the manager assigns the same rider by hand | One wins; the rider is not double-booked | |
| E4 | Live updates | Manager watching Dispatch while a driver claims riders | Queue updates without a refresh | |
| E5 | Rider watching | Rider on the ride card while the driver is assigned | Card updates itself to show the driver | |
| E6 | Driver goes offline mid-run | Driver ends shift with riders assigned | Riders return to the queue and are visible to the manager | |
| E7 | Two managers | Both approve the same person at once | No error; ends approved | |

---

## 10. Suite F — Seats and splitting

**The production fleet is two cars, three passenger seats each.** So any party of
four or more *cannot* fit in one car. This is the common case here, not an edge case.

| # | Case | Expect | ✅ |
|---|---|---|---|
| F1 | Party of 2 | Travels together in one car | |
| F2 | Party of 3 | Fills a car exactly | |
| F3 | Party of 4, splitting allowed | Split across two cars; both halves visible to the rider | |
| F4 | Party of 4, "keep us together" | **Not** split. Manager's queue shows "No car this big". Nobody is quietly stranded. | |
| F5 | Remainder priority | After a split, the leftover is offered to the next driver **first** | |
| F6 | Counting | Manager queue counts **people**, not rows | |
| F7 | Completion | Rider is only marked arrived once **every** leg completes | |

---

## 11. Suite G — Theme and accessibility

| # | Case | Expect | ✅ |
|---|---|---|---|
| G1 | Three choices | Day / Night / Auto all present in Profile | |
| G2 | Auto follows device | Change the phone's appearance | App follows | |
| G3 | Persistence | Choose Night, force-quit, reopen | Still Night, **no flash of light on launch** | |
| G4 | Status bar | In Night | Phone status bar matches the app, not cream | |
| G5 | No light patches | Every screen in Night | No white boxes, no pale bands | |
| G6 | No glow | Buttons in Night | No halo around buttons or cards | |
| G7 | Pinch zoom | Pinch any screen | Zooms — it must not be blocked | |
| G8 | Text size | Set phone text to largest | Nothing clipped or overlapping | |
| G9 | Keyboard | Tab through a screen | Visible focus ring everywhere; nothing unreachable | |
| G10 | Escape | Any sheet or dialog | Escape closes it; focus returns to what opened it | |
| G11 | Screen reader | VoiceOver / TalkBack on the rider home | Dialogs announced; buttons have real names | |
| G12 | Reduced motion | Enable it on the device | Animation stops; glass blur drops | |
| G13 | One-handed | Reach the primary action with a thumb | Reachable on a large phone | |

---

## 12. Suite H — PWA, offline, install

| # | Case | Expect | ✅ |
|---|---|---|---|
| H1 | Install prompt | Appears; installing works | |
| H2 | Installed launch | Opens standalone, correct icon and name | |
| H3 | Offline load | Turn off data, reopen | Loads rather than a browser error page | |
| H4 | Offline action | Try to request a ride offline | Fails **visibly** — never silently | |
| H5 | Reconnect | Restore data | Recovers without a manual reload | |
| H6 | **Stale cache after deploy** | Deploy, then open on a phone that had the old version | Gets the new version. This one has bitten before. | |
| H7 | Notifications | Trigger one | Arrives; tapping opens the right screen | |

---

## 13. Suite I — Security and safeguarding

This app holds **children's names, phone numbers and home addresses.** These
cases are not optional.

| # | Case | Expect | ✅ |
|---|---|---|---|
| I1 | Pending account | Cannot reach any real screen | |
| I2 | Rejected account | Told plainly; cannot proceed | |
| I3 | Rider isolation | A rider cannot see another rider's address or phone | |
| I4 | Driver scope | A driver sees only riders assigned to them | |
| I5 | Ex-driver | After ending a shift, previous riders' details are no longer visible | |
| I6 | Revoked manager | Demote a manager mid-session | Loses access; **cannot export the CSV** | |
| I7 | Manager code | The invite code is not in the client bundle | |
| I8 | Audit trail | Approve, dismiss, delete | Each writes an audit row | |
| I9 | CSV contents | Download it | Only this sabha's attendees; no extra fields | |
| I10 | Sign out | Sign out, press Back | Cannot get back in without signing in | |

---

## 14. Device matrix

Minimum before a release:

| Device | Browser | Why |
|---|---|---|
| iPhone (recent) | Safari | Most riders |
| iPhone (older, small screen) | Safari | Where truncation shows up |
| Android mid-range | Chrome | Where glass blur costs frames |
| Desktop | Chrome | Manager's Friday-night machine |
| Desktop | Safari | Different focus and form behaviour |

Add: **one deliberately old, slow Android**, because the drivers are volunteers
using whatever phone they own.

---

## 15. Severity and sign-off

| Severity | Meaning | Blocks release? |
|---|---|---|
| **S1** | A rider is stranded, or personal data leaks | Yes — stop |
| **S2** | A core journey fails, or a control silently does nothing | Yes |
| **S3** | Wrong or confusing, but there is a way round it | No — fix next |
| **S4** | Cosmetic | No |

**Release criteria**

- All automated suites green
- Suite A passes on the target device
- Zero open S1 or S2
- Suites E and I passed within the last two releases

---

## 16. Notes for whoever runs this

There is no staging. Every case below runs against the live database, so the
discipline matters more than the checklist.

- **Reset the ride window when you finish**, and delete any throwaway event.
- **Suite I uses test accounts as the subject, never a real family's record.**
  The isolation cases (I3, I4, I5) need two accounts — make both of them test
  accounts. Demoting a real manager mid-session (I6) locks a real volunteer out.
- **I9 downloads a real export.** It contains real names, phone numbers and
  addresses, including minors'. Delete the file when you have checked it. Do not
  leave it in Downloads, and do not attach it to a defect report.
- **Delete every test rider, driver, event and ride you create.** Otherwise they
  surface in a coordinator's export next Friday looking like real people.
- Log defects with: device, role, what you did, what happened, what you expected.
- If something merely feels wrong, write it down anyway. "This screen confused
  me" is a finding, and it is the one type this plan cannot pre-write.

---

## Answered questions

1. ~~Does staging use a separate Firebase project?~~ **There is no staging.** It
   was created and never finished — no Cloud Functions were ever deployed to it,
   so it could not exercise a single meaningful path. Removed 2026-08-13; see
   `docs/environments.md`.
2. ~~Is the ride-window override in the UI?~~ **Yes** — Setup → Ride window. But
   prefer editing the sabha's times in the Calendar (section 4): it runs the real
   scheduler rather than bypassing it.
3. ~~Is there a quiet way to test the window?~~ **Partly.** Pickup testing during
   the normal two-day window notifies nobody. Drop-off always notifies.
3. Are there real test accounts already, or do we need a seed script?
4. Who runs this — you alone, or do the coordinators help?
5. How often? Every deploy, or only for larger releases?
