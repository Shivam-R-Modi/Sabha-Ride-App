# Where this project is right now

**Handover note between machines.** Read it at the start of a session; update it
at the end. Last updated **2026-08-24**. Two separate pieces of work that day.

**One IS deployed** — the notice board's Publish and Take-down buttons, which had
never worked in production. Hosting only; `main` is fast-forwarded and pushed. See
*Fixed 2026-08-24* below.

**The second is user profile management in the manager's dashboard** — roles
change in place, Bhulku <-> Sarthi. Rules, functions and hosting all released; see
*Shipped 2026-08-24* below.

**The third is housekeeping that came out of the second** — `functions/lib` was
committed, and the sweep that ships it dirties the tree on every run. It is
gitignored now, and functions were redeployed off a clean build. See
*Housekeeping 2026-08-24* below.

Before that, **2026-08-21** shipped, in order: live ride
progress and the venue roster; the nudge; the sabha calendar as one card; the
standing schedule set to **Friday 20:30–22:00** and rides reopened; reorderable
sidebar tabs, built and then removed again at the owner's instruction; four UI
defects reported from screenshots; **feedback on every profile with a CSV
export**, tested end to end against production; and three stale facts corrected
in `CLAUDE.md` itself. Each has its own section below. `main` was also pushed —
it had been **39 commits** behind `origin`.

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

## Fixed 2026-08-24 — the notice board's two dead buttons

**Deployed 2026-08-24** as `234b2f9`. Client-side change, so `firestore.rules`
and `functions/` were untouched and **hosting was the only step** — the usual
rules -> functions -> hosting order still held, the first two were simply no-ops.
`main` fast-forwarded to `234b2f9` and pushed to `origin`.

Verified the way `CLAUDE.md` requires, against the service worker rather than
around it: the live bundle is `index-Br9FPv2Y.js`, fetched fresh with a
cache-buster, **byte-identical** to `dist/assets/index-Br9FPv2Y.js` (580,233
bytes both). The bundle contains `"publishNotice"` and `"deleteNotice"` and zero
occurrences of the quoted form.

**Still unverified: nobody has pressed the button in production.** Doing that
means posting a real notice to a live congregation, so it was left alone. The
evidence above is that the correct code is being served, not that a manager has
published a notice. Worth doing on the next real sabha.

**Managers already running the PWA will not get this until they reload.**
`registerType: 'prompt'` means the new worker waits and `UpdateBanner` offers the
reload — so anyone with the app open still has the broken buttons until they
accept it. That is the intended behaviour, not a second bug.

### What was wrong

`src/utils/cloudFunctions.ts` passed two callable names with **literal double
quotes inside the string**:

```
callFunction('"publishNotice"', input)      // publishNotice
callFunction('"deleteNotice"', { noticeId }) // deleteNotice
```

`httpsCallable(functions, name)` builds the URL from `name` verbatim, so both
requests went to `.../"publishNotice"` and `.../"deleteNotice"` and returned 404.
The functions themselves were fine and correctly exported at
`functions/src/index.ts:45-46`; only the client's spelling of their names was
wrong. All 20 other call sites in that file pass a bare name.

Effect: the manager Notices tab's **Publish** and **Take-down** buttons
(`components/manager/NoticeComposer.tsx:53` and `:73`) have never published or
removed a notice. Both looked completely normal — enabled, clickable, no error.
The house failure mode again: a control that looks wired up and silently does
nothing.

Both lines were **born quoted** in `766c51c` ("a notice board, and a Notices tab
for managers", 2026-08-19) and have no other commit in their history, so the
notice board has been inert for its whole life in production — about five days.
It surfaced from reading the code, not from a report, which is the thing to take
from it: a manager who posts a notice, sees no error, and then finds nothing on
the board has no reason to think the app is broken rather than that they used it
wrong. This class of bug does not generate reports.

### Why 2,003 tests did not catch it

`tests/utils/cloudFunctions.test.ts` existed and nominally covered this module.
**It never imported it.** It kept a local copy of `downloadCSV` — "Replicate the
logic here since the module import triggers Firebase init" — so not one wrapper
in the file had ever been executed by a test. The copy had also drifted: the real
`downloadCSV` prepends a UTF-8 BOM (added 2026-08-21, so Excel stops mangling
non-ASCII names) and the replica did not, meaning a test asserting on the replica
would have certified behaviour the shipped function does not have.

Mocking `firebase/functions` and `@/firebase/config` costs six lines and makes the
whole module reachable. That is the actual fix; the two strings are the symptom.

### The check that now stands there

25 new cases. Every one of the module's 22 `callFunction` sites is asserted three
ways, cheapest first:

1. the name equals the expected bare string;
2. the name contains no quote character — the bug, stated as a class;
3. the name is one that `functions/src/index.ts` **actually exports**.

(3) is the one that earns its keep. A typo, a rename, or a callable deleted
server-side all produce the same silent 404, and only parity against the deployed
export list notices. Same reasoning as `tests/quality/agenda-cap.test.ts`: a value
written down in two places must be checked, because the drift is invisible from
either side alone.

A table drives the common wrappers, so a new one is a single line. Three wrappers
get their own cases because their callable name is not their own name and so
cannot be derived: `previewDeleteSabhaEvent` and `deleteSabhaEvent` both call
`deleteSabhaEvent`, and `adminDeleteUserViaCloud` calls `adminDeleteUser` from two
branches. A final case asserts the number of covered sites equals the number of
`callFunction` sites in the source, so adding a wrapper without a test fails
loudly instead of going quietly uncovered.

Both checks were confirmed to bite by breaking the code on purpose: re-adding the
quote fails, and renaming to a plausible-but-undeployed `publishNoticeV2` — with
the expected name in the test updated to match, so only (3) can object — fails
with `no export of publishNoticeV2 in functions/src/index.ts`.

One trap worth recording, since it cost a debugging pass: the BOM assertion has to
read **bytes**, not `blob.text()`. `text()` runs UTF-8 decode, which per spec
*strips* a leading BOM, so the string comparison comes back without the single
character it exists to check and passes whether the BOM was written or not.

### Verified

Full sweep on the Mac, all green: **1,177 client** (up 25), **681 functions**,
**170 rules**, `npm run build` clean, `npm run typecheck` **zero errors**. Total
**2,028**; the count in `CLAUDE.md` was updated to match.

Note for the next session in this worktree: its `node_modules` was stale
(mtime 2026-08-10, predating the component-test suite) and missing
`@testing-library/*` entirely, so **no** client test could run here — every file
failed to collect — until `npm install --legacy-peer-deps`. The lockfile did not
change. Worth checking first in any worktree rather than trusting a green run.

## Shipped 2026-08-24 — roles change in place, from the Records tab

**Deployed**, rules -> functions -> hosting, `main` fast-forwarded. Live bundle
`index-C2eDH5w9.js` matched `dist/`, `managerSetUserRole` reports
**"Successful create operation"**, and the deployed ruleset was read back through
the Rules API and is **byte-identical** to `firestore.rules` — a compile success
only proves some ruleset shipped.

### What was actually wrong

The owner asked for the ability to move somebody between **Bhulku** and
**Sarthi** without creating a duplicate profile. The duplicate was never a second
document — there is exactly one `users/{uid}` per person, and `students/` and
`drivers/` have been `allow read, write: if false` for months. The duplicate was
a **half-written identity**.

A role lives in FOUR fields and different readers read different ones:

| field | who reads it |
|---|---|
| `role` | ManagerReports, the Records role filter |
| `registeredRole` | both pending-approval queues |
| `roles[]` | `useAvailableDrivers` — the driver picker |
| `activeRole` | a UI preference, authority nowhere |

The only way to change any of them was `DocumentEditorModal`, which edits fields
**one at a time**. Set `role: 'driver'`, leave `roles: ['student']`, and the
person is a Sarthi to `recordsRole()` in firestore.rules and invisible to the
driver picker, with no field that settles which is true. That exact shape had
already shipped once: `roles: ['manager']` at signup made every manager invisible
to `useAvailableDrivers`, so "assign to any driver" could only ever report none.

`adminDeleteUser` has been telling managers to use a control that did not exist
since it was written — *"That account is a manager. Remove the manager role
first"* and *"Demotion is the intended route: clear the role, then delete if
wanted."* There was no route.

### What it does now

- **`functions/src/http/managerSetUserRole.ts`** — one callable, one batch, one
  authorisation check, one audit row, modelled on `managerReleaseVehicle`. Writes
  all four fields from `roleFieldsFor(role)`, so they cannot drift apart again.
  `roles` is the GRANTED set (`['driver','student']` up, `['student']` down),
  because that is what every other writer in the app puts there.
- **It REPAIRS a half-written document** rather than reporting it as already
  done. `hasRecordedRole` cannot tell a healthy Sarthi from a half-write — both
  report 'driver' among their recorded roles — so the new
  `statesRoleConsistently()` compares all four fields one by one. Mirrored in
  `src/roles.ts` and `functions/src/utils/roles.ts`, like the rest of that table.
- **Demotion never strands a run.** Refuses once a ride is past `assigned`,
  naming the riders (`"Nilesh is out on a run with 2 ride(s) — Asha, Ravi"`).
  Rides still `assigned` are handed back to the pool, and the car is freed
  through `releaseVehiclesHeldBy` — skipping that is how a three-car fleet
  reached zero available cars on 2026-08-14.
- **Promotion refuses while the person is riding as a passenger.** `status` on
  this document is overloaded — DriverStatus for a Sarthi, StudentStatus for a
  Bhulku — so writing `offline` over a live `in_progress` would take them off
  their own driver's roster mid-journey. A `requested` ride is fine and is left
  alone: a Sarthi is still a Bhulku, which is the point of changing role in
  place.
- **`functions/src/utils/assignments.ts`** — `releaseRideToPool` extracted from
  `releaseAssignment` and now shared with the demotion, rather than copied. Also
  the canonical `ACTIVE_RIDE_STATUSES`; `managerReleaseVehicle` and
  `releaseIdleVehicles` import it now. Five other copies under three different
  names remain, and are reachable from that file's comment.
- **Records tab, Users: four columns.** Name / Role / Status / Actions. The
  email-and-phone sub-line and the whole Address column are gone — four columns
  of a child's contact details on a screen a manager leaves open, when the reason
  for opening the tab is almost never either. Both are one tap away now. The
  select checkbox and the raw-edit pencil stay; bulk delete still needs one and
  hand-fixing a broken document still needs the other.
- **The name is a button** — the first clickable name anywhere in the manager UI
  — opening `UserDetailSheet`, built on `Sheet` because
  `tests/quality/native-dialogs.test.ts` caps hand-rolled overlays at exactly
  five with `.toBe()`.
- **The role badge and filter read all four fields.** The filter used to be
  `doc.role || doc.activeRole || doc.registeredRole`, which took the first field
  that happened to be set, ignored `roles[]` entirely, and consulted a UI
  preference. A disagreeing record now shows a **`mixed`** badge, and the dialog
  says which fields disagree and offers BOTH directions — its current role is not
  a fact, so offering only the opposite of a guess would make the manager demote
  and re-promote to land where they wanted.
- **A Bhulku can ask.** `roleUpgrade` on their own user document — no new
  collection, no new index, and the manager's row already carries the name and
  phone beside it. `UpgradeRequestCard` on Profile, last of the five cards,
  rendering nothing at all for a Sarthi or manager.
- **A refusal stays on screen until it is read.** The rejected state is a real
  state the rider dismisses themselves. A decline that merely made the request
  vanish would have them asking again, and again.
- **People tab gains "Wants to drive"**, first of the three sections, with the
  button reading **Make Sarthi** rather than Approve — approving a sign-up and
  handing somebody a carload of children are not the same act.

### Rules

Two changes to `match /users/{userId}`, both tested.

- **`touchesRoleFields()` — the four role fields are refused to every browser,
  managers included.** The manager arm of `allow update` was unrestricted, which
  is exactly what let the raw editor write one field and leave three stale. A
  browser cannot make four writes atomically, so it no longer makes them at all.
  `accountStatus` is deliberately NOT in the list: it is one field, it means one
  thing, and `updateUserStatus` writes it from People with an audit row.
- **`writesOwnRoleRequestOnly()`** pins what a rider may say about wanting to
  drive. Not an escalation guard — the field grants nothing — but a rider who
  could write `status: 'rejected'` or a `decidedBy` could make their own profile
  and the manager's queue disagree about whether anyone had looked.

Consequence, and the point: `DocumentEditorModal`'s three role dropdowns and its
`roles` text field are now **read-only**, with a line pointing at the name in the
table. Leaving them editable would have been a control that silently failed.

`touchesPrivilegeFields()` is unchanged — all six fields stay in it, which is
what `tests/quality/role-table-parity.test.ts` asserts.

### Deliberately NOT done

- **Manager promotion or demotion.** Manager targets are refused in both
  directions. Removing the role also needs the `mgr` custom claim cleared and
  refresh tokens revoked, plus a last-manager lockout guard — creating an invite
  requires being a manager, so a congregation that demotes its only one cannot
  appoint a replacement. That gap is already recorded at `hooks/useUsers.ts:183`.
  Refusing beats half-doing it.
- **Telling the rider their request was decided, by push.** Push has never
  delivered anything in this app and is out of scope. The profile card is the
  channel.
- **A count badge on the People nav item.** `NavItem` has no support for one and
  nothing in the app has one; it would mean threading a number through both the
  sidebar and the mobile dock.

### Verification

**2175 tests — 1256 client, 732 functions, 187 rules.** Build clean.
**Typecheck 0.** Up from 2003.

Rebased onto `2fbaba5` and re-run there, not just on the branch point. That
mattered: the notice fix landed a guard asserting every `callFunction` site's name
is one `functions/src/index.ts` actually exports, **and** that the count of sites
matches its own table. `managerSetUserRole` passed the first two checks and failed
the third until it was registered in that table — which is the guard working
exactly as intended, and the reason the sweep is worth re-running after a rebase
rather than trusting the pre-rebase green.

Three deliberate breakages, each observed RED before being reverted:

| breakage | caught by |
|---|---|
| write only `role`, leave `roles[]` stale | 4 tests in `managerSetUserRole.test.ts` |
| allow a demotion mid-run | 5 tests in the same file |
| let a rider write `roleUpgrade.status = 'approved'` | 2 rules tests |

One more was checked rather than assumed, because getting it wrong would have
broken a screen silently: `DocumentEditorModal` posts the whole form back, role
fields included at their existing values, so if `affectedKeys()` counted a field
re-sent unchanged, the new guard would have refused **every** save of a user
record. It does not — and there is now a rules test pinning both that and the
fact that a REORDERED `roles[]` is still refused, which is a loud failure rather
than a half-write.

A fourth was found by a test rather than planted: the first version of the
"disagrees with itself" badge used `recordedRoles(...).length > 1`, which flagged
**every healthy Sarthi** in the congregation, because driver implies student.
That is what `statesRoleConsistently` exists for.

Looked at in the preview harness (`preview/records.html`, `preview/manager.html`)
with `preview/admin-db-stub.ts` extended with a Sarthi holding a car, a Bhulku
with a pending request, and a deliberately half-written record. Confirmed: four
columns, no email or address in any row, the `mixed` badge on the broken record
only, the detail sheet, the confirm naming the car and the riders, and
"Wants to drive · 1" above the two sign-up queues. No console errors.

### Fixed same day — promote and demote did not look like the same act

Reported from two screenshots of the same dialog. **Make Sarthi** was a FILLED
green button with a car icon; **Return to Bhulku** was an OUTLINED red one with a
generic down-arrow. Same screen, same consequence class — and because only one of
them is visible at a time, the difference did not read as "one of these is the
safer option" the way the Approve / Turn-down PAIR does on the People page. It
read as two unrelated controls, and which weight a manager saw depended purely on
which direction they happened to be going.

They were two separately written `<button>` blocks, which is the whole reason they
drifted. There is now exactly **one**, `RoleChangeButton`, taking the direction as
a prop, so the geometry and weight cannot diverge again. Only the things that
carry meaning vary: the fill, and the icon of the role the person is BECOMING —
`Car` for Sarthi, `GraduationCap` for Bhulku, which is the app's existing role
language from `RoleSwitcher`'s `roleConfig`, not something invented here.

Filled in both directions rather than outlined in both. `--danger-fill` is already
the weight this app gives a consequential manager action — the bulk delete in this
same console, the destructive arm of `useConfirm` — and a demotion frees a car and
puts riders back in the queue, so it is not the lighter of the two. Measured
`--text-on-accent` against both fills in both themes: **5.02, 6.47, 6.10 and
7.89:1**, all clear of the 4.5 floor.

`tests/quality/role-button-parity.test.ts` pins it, and it is textual rather than a
render test for the reason `records-tab-stability.test.ts` gives — jsdom computes
no Tailwind, and `tests/setup.ts` bans class-name assertions from component tests,
which is exactly why this kind of check belongs in `tests/quality/`. Six cases,
five of which were confirmed to fail when the old outlined button was pasted back.

### Also fixed same day — the name was printed twice, and hiding it moved the X

Reported from a screenshot with a box round the duplicate: `UserDetailSheet` showed
the person's name as the Sheet's heading AND again beside the avatar, which is the
first thing in the body.

The obvious fix is the wrong one. That heading is what `aria-labelledby` points at,
so deleting it leaves a `role="dialog"` with no accessible name — a screen reader
announces "dialog" and nothing else, and nobody who does not use one can see that
it broke. `Sheet` already had **`hideTitle`** for exactly this: the heading stays in
the DOM as `sr-only`, announced and not drawn.

Passing it exposed a **latent bug in `Sheet` itself**, and `UserDetailSheet` was the
first caller in the app ever to use `hideTitle`, so nothing had exercised that path.
`sr-only` is `position: absolute`, so the header row lost one of its two in-flow
children — and `justify-between` puts a LONE child at the *start*, which slid the
close button to the top **left**. Seen in the preview harness, not reasoned about
after the fact. Fixed with `ml-auto` on the button, in `Sheet` rather than worked
around in the caller, because it would have hit every future `hideTitle` user. With
two in-flow children `ml-auto` changes nothing, so every other sheet is untouched —
checked against the `useConfirm` prompt and `DriverPicker`.

Verified in the browser: accessible name still `Priya Desai`, the heading is
`position: absolute` at 1px, and the name renders **once**. Two guards, both
confirmed red: `tests/quality/sheet-hidden-title.test.ts` (5 cases — CSS facts,
which jsdom cannot see) and a case in `tests/components/UserDetailSheet.test.tsx`
that follows `aria-labelledby` to its element, which is the one that fails if
somebody removes the title instead of hiding it.

### The functions build is a gate the sweep in CLAUDE.md does not include

`npm run deploy:functions` runs `tsc` against **`functions/tsconfig.json`**, which
is stricter than the root one — `strict` plus `noUnusedLocals`. It refused the
first functions deploy with two errors the documented sweep had passed clean:

- `SettableRole` declared but never used, left behind when a local helper moved to
  `utils/roles.ts`.
- `LABEL[role]` an unchecked index. `data` is `any`, and **narrowing `any` with
  `!==` leaves it `any`** — so the argument validation did not actually give
  `role` a type. Fixed by binding the validated value to `SettableRole`, which is
  also the honest shape: untrusted until the check, typed after it.

Neither was reachable from `npx tsc --noEmit` at the root, which reported zero
throughout. **`npm --prefix functions run build` belongs in the sweep**; it is the
only gate that compiles what is actually uploaded. Rules were already live when it
failed, which is exactly the safe intermediate state the deploy order is for — old
client plus new rules is a clean permission error, not a half-write.

### Cannot be reported as working, and was not tested

- ~~**No production document was read.**~~ ✅ **CHECKED 2026-08-24, and production
  is clean.** All **4** user documents have role fields that agree with
  themselves: 2 Bhulka, 1 Sarthi (`roles: ['driver','student']`, correct — driver
  implies student), 1 manager (`['manager','driver','student']`). **Zero `mixed`.**
  So the half-write this feature exists to prevent had not yet happened; the guard
  went in ahead of the bug rather than after it, which is the unusual direction for
  this repo.

  Read through the **Firestore REST API with a `select`** limited to the four role
  fields plus `accountStatus`, so no name, phone number or home address ever left
  the database — only the fields the question is about, and the uids. Then re-run
  through the **real `src/roles.ts`** rather than the throwaway script's own copy of
  `recordedRoles`/`statesRoleConsistently`: a hand-copied role table drifting is the
  entire defect class here, and trusting a re-implementation to answer "is
  production clean?" would have been committing it one more time. Both agreed.

  Worth repeating after any signup or invite: Records → Users, look for a `mixed`
  badge. It is a one-glance check and it did not exist before today.
- **Not exercised against real data.** No role was actually changed in
  production, no Bhulku has asked for an upgrade end to end, and the mid-run
  refusal has never fired against a real Friday-night run. All of it is proved by
  tests and by the preview harness only.
- **Not seen on a real phone.**

### One thing to know about this worktree

It had no `node_modules`, no `functions/node_modules` and no `.env.local`, so the
typecheck reported 422 errors and four test files failed before anything was
written. Both installs were run (`--legacy-peer-deps`) and `.env.local` is
symlinked to the main checkout. `functions/package-lock.json` was rewritten by
the install and has been reverted — it is not part of this change.


## Housekeeping 2026-08-24 — functions/lib was committed, and had drifted

**Deployed**: `functions` redeployed off a clean build, `main` at `f305156`.
Nothing else changed — this was about what goes into the upload, not about what
runs.

### What was wrong

`functions/lib`, the compiled output of `functions/`, was **tracked** — all 102
files. Two costs, one of them new that day.

`npm --prefix functions run build` became step 5 of the verification sweep (see the
section above for why it had to). That step rewrites every `.js` and `.js.map`, so
**running the documented checks dirtied the tree**. Two branches touching one
callable also conflicted in generated output as well as in source, which is noise
that teaches nobody anything.

And it had drifted, because **`tsc` does not prune its own output directory**. Git
was carrying compiled code for three functions deleted from source long ago:

| orphan | deleted because |
|---|---|
| `http/geocodeAddress.js` | returned 500 for its entire life — a referer-restricted browser key cannot work server-to-server |
| `http/verifyManagerCode.js` | one shared, never-expiring code any manager could read back in plaintext; replaced by single-use invites |
| `utils/clustering.js` | superseded in the dispatch overhaul |

**Checked before claiming anything: none of the three was ever a live endpoint.**
All three appear in `functions/src/index.ts` only inside the comments explaining
their removal, never in an `export` statement, and the deployed function list has
never contained them. They were dead weight in the upload archive, not a hole. The
one that would have mattered is `verifyManagerCode`, since it was removed for a
security reason.

### What it does now

`functions/lib/` is gitignored, and the 102 files are untracked. Verified this
cannot affect a deploy **before** doing it, because getting it wrong would ship an
empty function:

- `firebase.json`'s `predeploy` hook is `npm --prefix "$RESOURCE_DIR" run build`,
  so lib is rebuilt from source ahead of every functions deploy. A fresh clone with
  no `lib/` deploys correctly. `functions/package.json` still points `main` at
  `lib/index.js`, and that stays correct.
- **firebase-tools never reads `.gitignore`.** It builds the upload archive from
  `functions.ignore` in `firebase.json`, defaulting to `node_modules` and `.git`.
  Read out of `lib/deploy/functions/prepareFunctionsUpload.js` rather than
  recalled — `const ignore = config.ignore || ["node_modules", ".git"]`, and a grep
  for "gitignore" across the whole `deploy/functions` path returns nothing.

### The redeploy, and why lib was deleted first rather than rebuilt

`tsc` does not prune, so an incremental rebuild would have left the three orphans
exactly where they were. `functions/lib` was **deleted outright** and the predeploy
hook allowed to regenerate it: 48 files, all corresponding to real source.

`functions/src` was unchanged since the previous functions deploy, so this carried
**no behaviour change** — and the log says so, 26 lines all reading *"Successful
update operation"*, nothing created and nothing deleted.

Run on a **Monday afternoon**. Redeploying cycles all 26 functions, and doing that
during a Friday 20:30 sabha is the kind of avoidable risk this file exists to
record.

### Verification

`firebase functions:list` compared against the real `export` statements in
`index.ts`, in **both** directions, because each direction is a different bug:

- **25 exported, 25 deployed, exact match.**
- Nothing exported without a live endpoint — that would be a client control that
  404s, which is precisely the notice-board bug fixed earlier the same day.
- Nothing deployed that is not an export — that would be an orphan endpoint.

Tree clean after a fresh build: **0 changed files**, where it was 102 before.

`docs/environments.md` already said the predeploy hook made stale `lib` a
non-footgun; it now also records that `lib` is ignored, and how to be certain what
is being shipped.

## Shipped 2026-08-21 — the run records who actually travelled

Deployed rules -> functions -> hosting, `main` fast-forwarded. Live bundle
`index-0y4OnqVz.js` matched `dist/`, and the deployed ruleset was read back
through the Rules API to confirm the new fields are in it.

### What was actually wrong

A Sarthi collects three or four Bhulka in one run. `startRide` flipped the whole
carload to `in_progress`, `completeRide` closed it all together, and **nothing
recorded who got in the car**. So a rider who never came out of the house was
written down as `completed` and `at_sabha`. Three consequences, worsening:

1. The manager's board said a child was at the temple who was at home.
2. The attendance figures and the exported CSV counted them present.
3. `at_sabha` is what unlocks "I need a lift home", so the app would later offer
   a ride home from a sabha they never reached.

And the screen made it worse rather than better. **"Complete Ride" was `disabled`
until every stop was ticked**, so the `!allVisited` confirmation sitting behind
it could never be reached — and one Bhulku who did not travel left the Sarthi
with no way to end the run *at all* except by ticking a child off as collected.
The dead button and the lie were the same bug.

### What it does now

- **`src/utils/rideProgress.ts`** — `advanceVisits` / `hasReachedEnd`, built on
  `judgeFix`, so a fix too vague to tell one neighbour's house from another's
  ticks nothing. Never un-ticks; the car drives away from every house it visits.
- **Display only.** Reaching a house is not proof anybody boarded. A web page
  gets no location while backgrounded and a service worker cannot read location
  at all, so while the Sarthi is in Google Maps nothing is observed — one fresh
  fix arrives when they glance back, with no history.
- **`route[].visited` persists** to the ride, which is what makes progress
  survive the trip out to Maps. iOS discards suspended pages.
- **The roster at the venue is the record.** Pre-ticked, one tap on a normal
  night. `completeRide` takes `absentStudentIds`; those rides are `cancelled`
  with a `noShowAt` stamp, left out of seat counts and attendance rows, given no
  arrival push, and the rider's status says what happened — `missed_pickup` on
  the way there, `at_sabha` on the way back, where it is both the truth and what
  lets somebody who missed their car ask again. **Never `home_safe`.**
- **`nudgeRider(rideId, studentId)`** — the wait-and-nudge policy's other half.
  Fixed text chosen server-side, one rider not the car, cooldown per rider in a
  transaction, and `delivered` comes back so a bell that reached no phone says
  "No phone registered. Call instead" rather than showing a tick.

### Deleted

- `updateWaypointVisits` / `isNearWaypoint` in `functions/src/utils/routing.ts`:
  a 50m geofence with no accuracy guard, exported, never called, never tested.
- **`hooks/useDriverDashboard.ts`, all 159 lines.** It held the second model of
  stop progress (`passengers[].stopStatus`, with an unused `'skipped'`) rendered
  nowhere — and the whole hook turned out to have **no consumer**, barrel
  re-export included. This corrects a claim made during the role-access audit:
  its unscoped rides query was the right shape for a real leak but the hook was
  never mounted, so it was not shipping data. The rules hole it illustrated was
  real on its own and is closed either way.

### Rules

`arrivedAt`, `nudges` and `noShowAt` joined `touchesRideServerFields()`.
`arrivedAt` is what makes `sarthiArrived` idempotent, so a rider who could write
it would silence their own "your Sarthi is outside"; clearing `nudges` turns one
tap into twenty buzzes; and the rider named by `noShowAt` is the last person who
should be able to erase it. The stop-progress write itself needed **no** rule
change — the assigned driver already had update — but four tests now pin that it
is the Sarthi driving the run and nobody else.

### Cannot be reported as working, and was not tested

- **How the geofence behaves in a moving car with real GPS.** Everything here was
  driven by synthesised fixes. The radius is 100m, reused from the presence
  check; two homes closer together than that will tick together, which is
  marked with a `ponytail:` note naming the upgrade path.
- **How often a Sarthi actually has the app in front of them.** The whole design
  assumes rarely, which is why the roster and not the geofence is the record —
  but the real number needs a sabha evening.

Both need the owner's phone on a Friday.

### Process note against myself

I ran `git log --oneline HEAD..main` — the standing check from the 2026-08-13
incident — **after** deploying rather than before. It was empty, so nothing was
dropped, but the order was wrong and the check is worthless in that order.

### Numbers

1071 client tests, 681 functions, 157 rules. Both builds and typecheck clean
(typecheck is now at **0** errors, not the 22 that CLAUDE.md still records as the
baseline — worth updating there). Every new test was seen red first, and each fix
was broken on purpose to confirm the test catches it: the whole-roster nudge, the
missing cooldown, the missing roster check, un-ticking, the bare distance check,
the client reporting success regardless of delivery, closing every document as
`completed`, and the three stamps removed from the denylist.

## Shipped 2026-08-21 — the sabha calendar, and the schedule that was never missing

**One card, not twelve rows.** `SabhaCalendar` rendered up to twelve near-identical
rows, each with its own times, derived ride window, Edit and delete. Under a
repeating rule those rows are identical by construction, so the screen grew with
how far ahead you could see and said nothing more — and twelve one-tap deletes
beside twelve identical rows is how you cancel the wrong Friday. Now: the next
sabha in full, the rest as date chips, and only the weeks that DIVERGE coloured.
There is deliberately no "cancelled" chip — `useUpcomingEvents` filters those out
before they arrive, so one could never render, and a state the data cannot reach
is the dead-control bug this repo keeps removing.

**Two clock formats on one card**, found by looking at it rather than by a test:
the header printed the stored `20:30–22:00` directly above `8:30 PM – 10:00 PM`.
`describeRule` could not use `formatTime` because that helper lived in
`hooks/useSettings.ts`, which imports `firebase/config` — out of reach of every
pure module. Moved to `src/constants/schedule.ts`; `useSettings` re-exports it, so
no import changed.

### Rides were closed, and not for the reason the notes gave

Diagnosed wrong twice before it was diagnosed right, which is worth keeping:

1. The first check looked for a recurrence rule on `settings/main` and concluded
   there was no standing schedule. **It lives at `settings/sabhaRecurrence`.** The
   rule existed and was enabled, and being a rule with no horizon it cannot run
   dry.
2. What actually closed rides was **17 `override` documents**, one per Friday from
   28 August to 18 December, all written within 40 seconds on 2026-08-19 during
   time-shift testing. Under the rule model a document IS an exception, so those
   masked the rule for four months.

Cleared narrowly — override, cancelled, and dated today or later only — with one
audit row naming the dates. **The schedule is now every Friday 20:30–22:00**, and
the fallback times on `settings/main` were moved off `04:00–04:30` at the same
time: those stand in for a gathering with no times of its own, so any such date
would have opened a ride window at four in the morning.

**`SABHA_DAY = 5 // Friday` deleted** from `functions/src/utils/schedule.ts` — an
exported hardcoded weekday with zero consumers, sitting in the first file anyone
would search when asking which day sabha is. `settings/sabhaRecurrence` was also
written out twice, once exported and once inline in `RecurringSabha.tsx`; a typo in
the client copy would not have errored, it would have looked like the rule
resetting itself. Both pinned by `tests/quality/schedule-not-hardcoded.test.ts`.

## Shipped 2026-08-21 — four defects reported from screenshots

All four were **chrome that looked like content, or a control that looked like
text**. None of them could fail a test as written, which is the theme.

**1. The withdraw button was a line of text.** `RiderHome`'s "I no longer need a
ride" carried `clay-button` — a deliberately COLOURLESS base that supplies
geometry and the 44px target and nothing else, because the utilities on the
element are meant to own the colour. Every other user pairs it with a background
and a radius; this one supplied only `text-coffee-700`, so the app's one way to
withdraw a ride rendered as a caption. Now `clay-button-secondary`, labelled
**"Cancel request"**.

Nothing could have caught it: the screen's tests query
`getByRole('button', { name })`, which passes on unstyled text inside a button
exactly as happily as on a button. Proved rather than assumed — with the bug put
back, all 49 of RiderHome's own tests still passed. `silent-css` case **2b** now
requires `clay-button` to bring a background or a border.

**2. Reports opened with a two-step no other tab did.** It returned a full-page
spinner while fetching, so switching to it was: page gone, "LOADING REPORTS…",
page fading in. Its siblings render their frame and load inside it. The `duration-500`
on that screen LOOKS like the culprit and is not — `.animate-in` and `.fade-in` are
both hardcoded to `0.3s` in index.css, and `duration-*` is Tailwind's
**transition**-duration, which does nothing to an animation. The new guard
immediately found `DriverHistory` doing the same thing, unreported.

A first version of that guard pinned every tab to `duration-300`. It passed and was
worthless — it asserted a class that changes nothing on an animated element.
Deleted before committing; a guard that pins a no-op reads like cover.

**3. The selected Records tab inverted between themes.** `bg-coffee` is
`--text-strong`, a TEXT token, and the text ramp inverts by design — so the pill
was dark brown in light mode and **near-white in dark**, among `--surface`
siblings. Contrast was fine both ways, which is why no ratchet saw it, and it was
the only control in the app that inverted, so it read as a glitch. Now
`bg-cream-400 text-coffee` with the accent on the icon — the sidebar's language,
measured 10.48:1 light and 14.62:1 dark. Two more sites had the same fill (the
bulk-action bar, and a RideWindowControl button) and were fixed with it.

**The guard's own advice had caused it.** `silent-css` case 3 prescribed
`bg-coffee text-cream` as "an inverted PAIR where both tokens flip together" —
true about contrast, wrong about appearance, and all three sites took the advice.
It now rejects the text ramp as a fill at all.

**4. The orange bar under the table was the scrollbar.** A full-strength accent
gradient at 10px with an inset white highlight, over a gradient track — on a wide
element that draws a solid saffron slab that reads as a progress bar.
`.no-scrollbar` was not the fix: the records table genuinely is wider than its
card, so the affordance is wanted and the colour was wrong. Thumb is now
`--text-faint` at 55%, accent on hover only, and `scrollbar-color` is set on
`html` so Firefox matches instead of being left native.

**Swept all four preview pages in dark mode for anything rendering near-white:
zero.** The first run of that sweep reported 13 hits on the manager page, every one
a mid-transition sample. See the warning at the end of this section.

## Shipped 2026-08-21 — feedback, on every profile

A **Give feedback** card at the bottom of Profile for every role, and the
collected feedback both **listed in Reports and downloadable as a CSV**.

`ProfileEditor` is the one screen all three roles reach — manager and driver
through `App.tsx`'s switch, riders through `StudentDashboard.tsx` — and already
carries ThemeToggle, InstallAppButton and PushToggle for exactly that reason, so
one component covered every role. 1–5 rating as a radiogroup with `sr-only` radios
copying ThemeToggle, and it **says "sent with your name" above the box**: named was
the owner's decision, and somebody who would rather not be identified needs to
know before they type.

**One submission per person per day, enforced by the database.** The document id is
`feedback/{uid}_{YYYY-MM-DD}` and the rules deny `update`; `create` only applies to
a document that does not exist. No callable, no rate limiter, and unlike a
client-side counter it cannot be got around by reloading. The cost, stated rather
than hidden: a second thought that afternoon waits until tomorrow.

**No name on the document** — only `uid`, pinned to the caller by the rule. A
client-supplied name is unverifiable, and a forged one on a complaint about a
named volunteer would send a manager to the wrong person. `useFeedback` joins the
display name from `users` at read time; an unresolvable account reads `Unknown`.

Rules follow `clientErrors` exactly: anyone signed in may file one, size and rating
bounded server-side, append-only for everyone **including managers**, and a
manager-only read that never touches `resource.data` so the collection query
cannot fail wholesale.

**The list matters as much as the export.** This app already writes crash reports
to `clientErrors` that no screen has ever displayed — collected since the
collection existed, never read once. Download-only goes the same way.

### The CSV bug that was already shipping

Excel reads a UTF-8 file without a BOM as Latin-1 and mangles every non-ASCII
name, while the file still opens and the columns still line up. **Both existing
exports were missing it** — attendance downloads have been quietly corrupting
names — and all three now carry it. No spreadsheet library was added; Excel opens
a CSV directly.

### Tested end to end against production

21 checks, all passed, with **real signed-in accounts** — tokens minted from the
project's own service account, so the live rules and the live database answered
and no password was involved. Every test document was removed; the collection is
back to zero.

A rider could file their own and was refused: filing under another uid, a rating of
6, a rating as a string, a 1001-character comment, a second submission the same
day, reading one back, and listing the collection. A manager could read and list
and was refused editing and deleting.

**One result was not taken at face value.** The second-submission test first
returned `409 ALREADY_EXISTS`, because the REST call used `createDocument` — a
different code from what the app sees. The friendly "you have already sent
feedback today" message depends on which error arrives, so it was re-tested using
the write `setDoc` actually performs: `PERMISSION_DENIED`, which is what the card
translates, **and the first submission survives untouched**.

The export was then built by the real function from real documents, including a
comment containing a comma, a quote and a newline, and one from a non-existent
account: names resolved, `Unknown` rather than `undefined`, the awkward comment
kept in one cell, BOM first.

**Still unproven: nobody has tapped the button on a real phone.** Everything
behind it is verified; the last mile needs a sign-in, which this session could not
do.

### Where the suite stands at the end of the day

**1152 client, 681 functions, 170 rules.** Both builds and typecheck clean — typecheck
is at **0** errors, not the 22 that `CLAUDE.md` recorded as the baseline. That
line has since been corrected — see *The agent instructions were lying* below,
which also corrects the claim made here that `CLAUDE.md` is untracked. It is
tracked.

### Harness gaps this work closed

`preview/` gained a `firebase/firestore` stub, a live user profile that echoes
writes back, `ManagerReports`, `ProfileEditor`, and a snapshot that supports
`forEach` — without which any hook walking a collection crashed the whole preview
tree. **ProfileEditor had never been previewable at all**, which is why the
feedback card and the three toggles beside it had never been looked at outside a
sign-in.

## Shipped 2026-08-21 — the agent instructions were lying, in three places

`CLAUDE.md` is the first thing a session reads, and three of its statements of
fact had gone stale. All three were true when written.

- **"clean baseline is 22 pre-existing errors; 22 means clean."** It is **zero**,
  and has been since the typecheck pass earlier the same day. This was the
  dangerous one: a session that introduced 22 errors of its own would have
  compared the count to the note and called it clean.
- **"This repo runs 396 tests — 245 in `functions/`, 70 client, 81 rules."** All
  three suites were re-run rather than copied from this file: **1,152 client, 681
  functions, 170 rules — 2,003.**
- **"Both this file and `.claude/skills/` are deliberately untracked."** Both are
  tracked, committed in `0406ab8` *"commit the agent context so a phone session
  starts informed"* — which is the reason a phone session sees the file at all.
  The instructions were contradicting the commit that made them work.

`CLAUDE.md` exists as **two separate files on disk** — the repo root and the
worktree each have their own copy, same bytes, different inodes. Editing one
leaves the other stale, and a session reads whichever is nearer. Both were
updated.

Committed `8e8214b`. Docs only, so nothing was deployed.

### And `main` had not been pushed for 39 commits

Discovered while pushing this: `origin/main` was **39 commits behind**, covering
everything from the live-ride-progress work through the day's feedback form. All
of it was already deployed to production, so the remote was the only thing
lagging — production was never running unpushed code, which is the failure this
would otherwise imply.

Before pushing to what is a **public** repo, the outgoing diff was scanned for
credential-shaped paths. The only config files in 39 commits were `firebase.json`
and `package.json`; no `.env`, no admin SDK JSON, no keys. **Check this every
time the remote is this far behind** — a gitignore only protects files it was
already covering when they were created.

## A warning to the next session: measure with transitions off

Colour and geometry were measured wrongly **five times** on 2026-08-21, and every
one produced a confident, plausible, wrong number:

- clicking at coordinates in the wrong frame, and concluding a `draggable` row
  swallowed its own click — it does not;
- reading a computed colour from a stale element reference after removing sibling
  nodes;
- sampling a colour **mid CSS-transition**, which made light and dark look nearly
  identical;
- the same again on the manager page, reporting 13 near-white elements that were
  all one animation caught halfway;
- scraping `rgb(...)` out of a `backgroundImage` string and picking up a **shadow**
  colour, then a gradient stop that is not behind the text.

The habit that works: inject `*{transition:none!important;animation:none!important}`,
re-query the element inside each theme, walk up to the first genuinely opaque
ancestor for the backdrop, and compare against the worst stop. Every number in
these sections was taken that way.

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

Last deploy `acdf9b9`, 2026-08-18. `main` = branch = production.

| | Deployed | Notes |
|---|---|---|
| Firestore rules | ✅ | Unchanged since the redesign |
| Firestore indexes | ✅ | Redeployed |
| Cloud Functions | ✅ | **20** functions (`sarthiArrived`, `managerBroadcast` added). `ensureSabhaEvents` and `geocodeAddress` **deleted** — see below |
| Hosting | ✅ | bundle `index-4uVxg9FQ.js` / css `index-T7da3jeJ.css`, verified by CONTENT |

**Test suites, all green:** `functions` **574** · client **887** · rules **97** —
**1558 total**.

**Everything in this file is deployed EXCEPT the last section** — *the notice
board* — which is committed and swept but **NOT released, and blocked**: Cloud
Storage is not provisioned on this project. A full both-legs cycle ran on 2026-08-18 — see *Verified
2026-08-18* below.

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

## FIXED 2026-08-17 (late): the three drop-off bugs

Found while hand-testing the drop-off run, fixed the same evening. Kept here
because each one has a test that fails if it returns, and because two of the three
are the same shape: **a guard that was never asked the right question.**

### 1. Two driver screens ignored dark mode — FIXED

`AssignmentPreview` and `CompletionScreen` painted their root with literal hex
(`from-[#FAF9F6] to-[#F5F0E8]`). A hex cannot follow `data-theme`, so both stayed
cream while the rest of the app went dark — on the two screens a driver sees most
during a run.

Both stops had exact tokens: `#FAF9F6` is `cream`, `#F5F0E8` is `cream-200`. Now
`from-cream to-cream-200`. Measured from the built stylesheet, both themes:

| | from | to |
|---|---|---|
| light | `rgb(250 249 246)` | `rgb(245 240 232)` | 
| dark | `rgb(28 24 21)` | `rgb(33 29 25)` |

Light is byte-identical to the old hardcoded gradient, so nothing changed visually
for anyone in light mode.

### 2. The colour ratchet had no hex rule at all — FIXED

Worth stating precisely, because the earlier note here was wrong: the ratchet did
not "miss gradient stops". It had **no arbitrary-value hex check whatsoever**. It
only matched Tailwind's *named* palette (`bg-blue-500`), so every `bg-[#…]`,
`from-[#…]` and `text-[#…]` in `components/` was invisible to it. That is how
bug 1 shipped past the very test built to prevent it.

`tests/quality/theme-tokens.test.ts` now has `RAW_HEX`, plus a `HEX_ALLOWED` map
with one entry — `LoginScreen`'s heading, which sits on a fixed background
**photograph** and so is correctly a fixed colour. A third test fails if an
allowlist entry outlives its reason.

Closing the hole properly also meant adding `shadow`, `via` and `outline` to the
named-palette rule, which immediately found two more real ones:

- `CompletionScreen` — `shadow-green-200`, a pale light-mode glow under the
  success circle, now `shadow-[rgb(var(--success))]/25`
- `DatabaseConsole` — `via-amber-500/10` and `shadow-orange-500/20` in a gradient
  whose other two stops were already tokens, now `via-gold/10` and
  `shadow-saffron/20`

### 3. `surveyTheQueue` was missing the direction filter — FIXED (was mine)

The end-shift warning counted waiting riders by **event key only**;
`globalAssignDriver`'s `isValidPendingRide` filters by event key **and
direction**. A pickup request writes no `rideType` field at all, so during a
drop-off run a leftover pickup counted in one place and not the other:

| | event | direction | |
|---|---|---|---|
| "Find my next riders" | yes | yes | "Nobody is waiting right now" |
| "End my shift" warning | yes | **no** | "1 rider is still waiting" |

Two screens contradicting each other one second apart, with no way to tell which
was lying — and the warning was the useless one, because staying on shift could
not have served a request that was not dispatchable to anybody.

**The fix is that `surveyTheQueue` now calls `isValidPendingRide` itself**, rather
than filtering its own way. Copying the one missing condition across would have
fixed the symptom and left two lists to be kept in step by hand; this way they
cannot disagree. It also inherits the coordinate and `studentId` checks, which is
the same argument — a request with no usable pickup point cannot be served by
staying either.

This was the fourth time in this project that two correct halves disagreed at the
join. The lesson that keeps repeating: **share the predicate, do not restate it.**

`lastDriverWarning.test.ts` covers all of it. Note that its queue fixtures had to
be made realistic first — the rows were `{ status, eventId }` with no coordinates
and no `studentId`, a shape the dispatcher would always have refused. **A fake
easier to satisfy than production is a test that cannot see the bug**, and that is
part of why this drifted unnoticed.

Sweep after the three: **client 660 · functions 499 · rules 81 = 1240**, build
clean, typecheck at its 19 baseline (verified by stashing — 19 with and without
the changes).

### 4. A comment re-emitted the classes it described — FIXED

Caught only because the hosting deploy was verified by **content** rather than by
bundle filename: `shadow-green-200`, `shadow-orange-500` and `via-amber-500` were
still in the live CSS after being removed from every `className`.

**Tailwind's content scanner is a plain regex over file TEXT.** It does not parse
JSX and does not skip comments — so the comments written to explain which
utilities had been removed regenerated those exact utilities. Nothing referenced
them, so it was dead CSS and not a visual defect, but it silently resurrects the
classes the ratchet exists to keep out.

Both comments now spell the names around rather than writing them out, and say
why. Bundle CSS 74.0 → 72.6 kB.

> Worth remembering for the next colour cleanup: **matching a bundle filename
> proves a release shipped, not that it shipped the change.** Grep the served
> asset for the thing you removed.

---

## Verified 2026-08-18: a full cycle, and the presence fallback's first real run

Event `2026-08-18` was a **same-day one-off** (11:05–11:25) created by the manager;
the Friday rule was untouched. Both legs ran end to end:

| leg | driver | riders | runs |
|---|---|---|---|
| Home → Sabha | Tala Das | 5 | 2 |
| Sabha → Home | Dido Re | 6 | 2 |

All 11 rides reached `completed`, **zero** left in `requested`, and every rider
ended `home_safe`. No orphans, no residue.

### The presence fallback finally ran for real

Five of the six returning riders recorded `{"method":"pickup"}` — the `at_sabha`
short-circuit, because this app had driven them there. No GPS needed.

**Wej Ewe did not ride out**, and recorded:

```json
{"method":"manual","distanceMeters":2370}
```

That is the case the whole presence redesign exists for, exercised in production
for the first time. GPS put them 2370 m away — 23× the 100 m radius — so it fell
through to "Are you at the sabha?", they confirmed, and they got a ride home.
Under the old `at_sabha` gate `studentReadyToLeave` would have thrown, and the
client would have advised "Please try again", which could never have worked.

The implausible distance is **recorded, not enforced**: a manager can see the
claim is doubtful, and nobody was stranded to achieve that. Record-don't-enforce,
working as designed.

### Privacy held

The presence claim stores `method` and `distanceMeters` and nothing else. Scanned
every drop-off ride for coordinate-shaped keys (`lat`, `lng`, `coord`, `accuracy`,
`position`): **none**. Pickup rides carry `presence: null`, as they should.

### Carload grouping clustered correctly

| run | riders |
|---|---|
| 1 | 717 E 5th St · 474 E 7th St · 442 E 5th St — all South Boston 02127 |
| 2 | 1 Andrew St Cambridge · 111 Browne St · 33 Dwight St — both Brookline 02446 |

### Attendance header still correct

`startsAt` 11:05, `endsAt` 11:25 — matching the event document. The old defect
(4:00 AM published for an 11:00 PM sabha) stays fixed.

### Two things checked and cleared, so nobody re-investigates

- **`attendanceLocksAt` looked wrong** — 6 PM on 08-17 for an 08-18 sabha, i.e.
  ~21 hours in the past by the time this same-day event was created. It is not a
  defect: `canWithdraw` gates **only** a yes → no withdrawal
  (`hooks/useAttendance.ts:104`). An initial answer and no → yes are always
  allowed, so a short-notice sabha cannot dead-end a rider.
- **This run did NOT decisively exercise the end-shift count.** Dido Re's shift
  ended with counters zeroed, so the write path completed without a spurious
  warning — but Tala Das was still holding Car1 at that moment, so
  `otherDriversOnShift > 0` would have suppressed any warning regardless. The
  decisive proof stays the deployed-code check against the real stale row: old
  filter warned "1 rider still waiting", deployed filter and dispatch both say 0.

### Open, benign

**Tala Das still holds Car1** (`in_use`, driver `available`, runs=2 ppl=5). They
never tapped "Done for Today". That is the intended model — a driver keeps their
car all evening — so the car stays held until they end the shift or
`releaseIdleVehicles` reclaims it.

---

## 2026-08-18: production-readiness pass, and the ONE thing still blocking

Four items were agreed. Three are code and deployed; the fourth was a data reset.

### RESOLVED: the venue is set to 346 Huntington Ave

`settings/main.sabhaLocation` is now:

```json
{ "lat": 42.3395281, "lng": -71.087883, "address": "346 Huntington Ave, Boston, MA 02115" }
```

Written in exactly the shape `hooks/useSettings.ts → updateSabhaLocation` writes,
so the Settings UI reads it back as its own value, with an audit row recording
the change and the reason. Verified through the **deployed** server helper, not
just by reading the document back:

| check | result |
|---|---|
| `getSabhaLocation()` | returns 346 Huntington, no "using default" warning |
| `resolveVenue(rule.venue = null, default)` | 346 Huntington |
| next gathering from the rule | `2026-08-21` 15:45, venue resolves to 346 Huntington |

**346 Huntington Ave is Blackman Auditorium / Ell Hall, Northeastern** — which is
why this was so easy to miss: the hardcoded placeholder `360 Huntington Ave` is
about **50 m away**, the same campus entrance. That is *inside* the 100 m presence
radius, so the drop-off GPS check would have passed happily; only the address
drivers navigate to would have been wrong. A wrong venue that still passes its own
proximity test is the worst kind.

Coordinates came from **OpenStreetMap Nominatim** (the Blackman Auditorium node),
because the app's own geocoder is broken — see below. Worth confirming once in
Settings, where `AddressAutocomplete` will show Google's own pin: if it differs by
more than a few metres, re-save from the UI and it will overwrite this.

### FIXED: `geocodeAddress` always failed, and is now gone

It returned 500 for every call it ever received:

```
REQUEST_DENIED – API keys with referer restrictions
                 cannot be used with this API.
```

`GOOGLE_MAPS_API_KEY` in `functions/.env` is HTTP-referer-restricted. **Referer
restrictions are a browser mechanism — a server sends no referer**, so such a key
can never work server-to-server.

The obvious fix is a second, unrestricted or IP-restricted key. That is another
credential to store, rotate and leak, and it needs a console action. So the fix
taken was to **stop needing a server key**.

**Verified before acting, not assumed.** Loaded the Maps JS SDK on the production
origin with each key in the bundle and actually called `geocode()`:

| key | result |
|---|---|
| the Firebase key | loads, then times out — not authorised for Maps |
| `VITE_GOOGLE_MAPS_API_KEY` | **OK** → `42.339362, -71.0878001` |

That is the key already powering autocomplete, and `hooks/useGooglePlaces.ts` says
so in its own header: *"works with referer-restricted API keys"*.

So `geocodeAddressInBrowser()` now lives in that hook, reusing its single SDK
load, and the two callers moved to it — `ProfileEditor`'s fallback for a typed
address, and the manager's admin edit. The callable, its two client wrappers and
its `GeocodeResult` type are **deleted**; `firebase functions:list` is now 18, and
the endpoint returns **404**. A deployed endpoint that always fails is a control
that cannot work.

**`GOOGLE_MAPS_API_KEY` is no longer read by anything and can be dropped from
`functions/.env`.** One fewer credential.

The trust model is unchanged: autocomplete has always produced coordinates in the
browser and `ProfileEditor` has always written them, so client-supplied
coordinates were already accepted. This closed the one path that was broken.

`tests/quality/geocoding-stays-client-side.test.ts` pins the decision, because the
tempting fix for the next person who wants server-side geocoding is that second
key. It matches `process.env.` rather than the bare key name, since the name
appears in `functions/src/index.ts` explaining the deletion — the same trap as
naming a Tailwind class in a comment and having it re-emitted.

**Venue coordinates corrected as a side effect.** They had come from OpenStreetMap,
because the app's own geocoder did not work at the time. They are now Google's own
value — **19.7 m** from the previous point, with an audit row recording it. Both
were well inside the 100 m presence radius, so nothing behaved differently; the
stored value now simply matches what the Settings UI would write.

### The original problem, for the record: the venue was a developer placeholder

`settings/main` has **no `sabhaLocation`**, so `getSabhaLocation()` logs
*"Invalid sabhaLocation in settings — using default"* and falls back to
`DEFAULT_SABHA_LOCATION` in `functions/src/utils/settings.ts`:

```
360 Huntington Ave, Boston, MA 02115   (Northeastern University)
```

This was masked until now: every test gathering was a one-off event carrying an
explicit venue, and the venue chain is `ride → event → settings/main → DEFAULT`.
With the test events cleared, the weekly rule's venue is `null`, so the chain now
reaches the placeholder — **every ride would route to the wrong address.**

**A manager must set the sabha location in Settings before anyone uses this.**

Worth considering separately: the fallback is silent, which is this project's
named failure mode. A missing venue currently produces confidently wrong routing
rather than a refusal. Left as-is because making it throw would stop all
dispatch, and that is a decision, not a cleanup.

### Deployed: the PWA update prompt

The app was on `registerType: 'autoUpdate'`, whose generated `registerSW.js` is a
bare `register('/sw.js')` with **no update handling at all**. The new worker
installed and claimed clients while an already-open page kept running old code,
and nothing told the user. That is what made 2026-08-17 take an hour, and on an
installed PWA it lets a driver run a stale client against current rules and
functions indefinitely.

Now `registerType: 'prompt'`, `skipWaiting` off so the worker parks in `waiting`,
and `components/UpdateBanner.tsx` offers the reload. Not automatic — a driver
mid-carload must not have the page pulled from under them. Not dismissible —
hiding the notice and continuing on a stale build is the failure. `swUpdate.ts`
also polls every 15 min, without which a PWA that never navigates never notices.

### Deployed: crash reporting, with no third-party processor

Deliberately **not** Sentry. It is a dependency for something twenty lines of
Firestore does, and this app holds children's names, phone numbers and addresses
— an error reporter that posts state and URLs to a vendor is a data-processing
decision with legal weight, not a `package.json` diff.

Reports go to `clientErrors`: create-only, `uid` pinned to the caller, readable by
managers alone, immutable from any client. Redaction is one pure function — query
string and hash dropped, message and stack truncated, recorded fields asserted as
a whitelist so adding `state` later fails a test. Capped at 5 per session and
deduped, so a render loop cannot bill by the write. It records **which bundle was
running**, the field whose absence cost that hour.

### Deployed: limits on the two riskiest callables

`generateEventCSV` emits every rider's name, phone and address; `adminDeleteUser`
is irreversible and takes a batch. Both were authorised but unthrottled while four
less sensitive callables already had limits. Now 20/hour and 30/hour, placed
AFTER the manager check so a stranger cannot spend a real manager's allowance.

### Done: the data reset

`scripts/clear-database.cjs` was **deleted rather than fixed** — it would have
crashed on a filename this repo never used, deleted the FLEET, left the `cars`
mirror populated against an empty `vehicles`, and deleted zero users (it matched
them by a hardcoded list of names from a dataset that no longer exists).

Replaced by `scripts/reset-to-clean-slate.cjs`, dry-run by default. Applied with
the owner's confirmed scope:

| cleared | kept |
|---|---|
| 12 users + their 12 Auth accounts | the manager (`tonnystark83@gmail.com`) |
| 48 rides · 24 events · 6 attendance · 5 statistics | fleet Car1–3, reset to `available` in **both** mirrors |
| 4 `managerInvites` | `settings/main`, `settings/sabhaRecurrence` |
| dead `settings/rideContext` | 86 `auditLogs`, `system/*` |

Reasoning behind the edges:

- **The manager survives** — invites can only be issued by an existing manager, so
  deleting the last one is a lockout with no route back in.
- **Audit rows survive.** They reference accounts that no longer exist, which is
  what an audit log is for. Two rows were added recording the reset itself.
- **Invites do not.** An unredeemed `managerInvite` is a live credential to become
  a manager. Four were outstanding from testing.
- **`system/eventGenerator` survives.** It looks like residue of the deleted
  seeder, but it now carries `pendingAttendanceDeletes` and is still read by
  `updateRideTypeContext`. Checked before assuming.

### Still outstanding, not blocking

- **Orphaned Auth logins: done.** 71 → 59 (the reset) → **7**. The 52
  test-shaped ones are gone, with an audit row. **Six real-looking addresses were
  deliberately kept** and the script will never delete them:
  `shivammodi6@`, `janimohak03@`, `shivam1@1123.com`, `kushalpanchal2497@`,
  `m49914899@`, `r@gmail.com`. Two of those (`r@gmail.com`,
  `shivam1@1123.com`) are almost certainly debris too, and the other four look
  like real people — deleting a real login is low harm (the next sign-in creates a
  fresh signup awaiting approval) but it is not a call to make silently.

  `--orphans-only` was added for this, and the reason is worth keeping: the rest of
  that script is a ONE-SHOT. A day after the reset, `weeklyAttendance` holds the
  header the scheduler published for the next gathering and `events` holds real
  exceptions. Re-running the full script to reach one flag would have wiped live
  data as collateral. It nearly did.
- ~~`npm run lint` checks nothing~~ and ~~typecheck baseline is 19~~ — both fixed;
  see *Lint and typecheck* below.
- **The `cars` / `vehicles` mirror** remains two collections for one fleet.

---

## 2026-08-18: lint and typecheck, and the three bugs they found

`npm run lint` had a script and no config for the life of this repo, so it always
exited with *"couldn't find a configuration file"* — **a gate that looked green and
checked nothing.** Typecheck sat at a 19-error baseline. Both are clean now:

```
npm run lint        passes, zero suppressions
npm run typecheck   0 errors   (was 19)
```

### The config, and what it deliberately does not enforce

`.eslintrc.cjs`, eslintrc format — the installed ESLint is **8.57** and the script
passes `--ext`, which flat config rejects. Don't "modernise" it without also
changing the script.

A lint that fails on 400 pre-existing style opinions gets switched off within a
week, and the script runs `--max-warnings 0`, so a warning is as fatal as an
error. So: rules that catch **bugs** are on, rules that catch only style are off
**with a stated reason** in the file. `no-explicit-any` is off — the Firestore
boundary is genuinely untyped until validated, banning it is a hundreds-of-sites
refactor, and it would not have caught anything this project has actually hit.

It also encodes the `window.confirm` / `alert` / `prompt` ban as a lint error,
which is faster feedback than the existing quality test.

### Three real defects, all from the first run

**1. `useDriverDashboard` showed drivers the placeholder venue.** (That file was
deleted on 2026-08-21 — it had no consumer. Kept here as the record of a real
dependency-array bug, not as a pointer to live code.) The one that was
genuinely live. `venueAddress` was missing from a dep array; it resolves through
`useSettings()`, which starts at `DEFAULT_SABHA_LOCATION` and only becomes the
real venue once the snapshot lands. With `[driverId]` alone the effect captured
the placeholder and never re-ran, so a drop-off ride with no venue of its own
showed **360 Huntington Ave** for the life of the listener — the same placeholder
that was live in production until today. Fixed by declaring the dependency.

**2. `RoleSwitcher` called `useState` after an early `return null`.** Hook count
depending on live data. **Measured rather than assumed: React 19 tolerates this**
— it throws nothing and logs nothing, so this was latent fragility, not the crash
first suspected. Fixed anyway; the note in the file records the measurement so
nobody re-investigates.

**3. `ManagerDashboard` held ~57 lines of dead duplicates.** Four approve/deny
handlers with no button, an attendance CSV download with no button, and two
pending-user hooks whose results were never read — **two live Firestore listeners
on every manager's dashboard, feeding nothing.** Checked before deleting:
`ManagerPeople` owns approvals, `ManagerReports` owns the CSV, both working. Not a
missing feature — a second, unreachable copy of one. Confirmed gone from the
deployed bundle by grepping for its toast strings.

### How typecheck got to 0

- **Eleven** were `err.message` on a value correctly typed `unknown`. Now routed
  through `src/utils/errorText.ts` (`messageOf` / `codeOf`), so the narrowing
  lives in one tested place. **Deliberately not `(e as Error).message`** — that is
  the same bug with a cast on top: a thrown string or a `{ code }` literal yields
  `undefined`, and the user reads "undefined" in a toast.
- **Two** were fields the documents genuinely carry but the interfaces omitted:
  `Ride.studentPhone`, `RideStudent.avatarUrl`.
- **Three** were one line — spreading a `Record<string, any>` drops the index
  signature, so TS inferred bare `{ updatedAt: string }`.
- **Two** were `scripts/setRideContext.ts`, which is **deleted, not fixed**. It
  pointed at a service-account filename this repo has never used, and it wrote a
  hand-rolled `system/rideContext` with **no `eventId`** — and
  `isValidPendingRide` treats a null event key as *accept any event*, so running
  it would have made every stale request from every past sabha dispatchable.
  Superseded by the `manuallyUpdateRideContext` callable.

### No suppressions in the final state

The two `exhaustive-deps` warnings that were correct as written are resolved
properly rather than silenced — one with `useCallback`, one with a ref.
`--report-unused-disable-directives` stays on, and earned its keep by catching two
misplaced directives written along the way.

---

## 2026-08-18: the selected tab had no fill in dark mode

Reported as *"a UI issue on the left panel on any dashboard"*. It is a dark-mode
**token collision**, not a layout fault.

```
--surface      39 34 29    the sidebar panel   (bg-surface)
--canvas-deep  39 34 29    the selected pill   (bg-cream-300)
```

In light those are `255,255,255` and `237,232,224` — an obvious pill. In dark they
are **byte-identical**, so the selected nav item had no fill; the only cues left
were a hairline border and orange text. Backwards in a telling way, too:
`hover:bg-cream-200` (`33 29 25`) *does* differ from the panel, so **hovering an
unselected item looked more selected than the selected one.**

Three places on the same screen, all fixed to `bg-cream-400` (`--sunken`), which
clears `--surface` in both themes — channel-sum distance light **96**, dark **48**,
where it was **0**:

- the sidebar's active nav item
- the sidebar's Sign Out button
- the mobile bottom nav's active chip (`.clay-bottom-nav` is a `--surface`
  gradient, so it had the identical bug)

### Why the theme tests missed it

They check that each token differs **between** light and dark. Both tokens pass
that — they each change. **Nothing checked that two DIFFERENT tokens differ from
each other WITHIN a theme**, which is the property "a fill is visible on the panel
it sits on" actually depends on.

Added to `tests/quality/theme-tokens.test.ts`: a general guard that fails on any
NEW collision among the stacking ramps (the three existing ones recorded and
annotated), a specific assertion that the nav fill clears the panel by a real
margin in both themes, and a **drift guard pinning the classes `Layout.tsx`
actually uses** — without that last one the assertion would keep passing while the
screen was broken, which is precisely what happened the first time.

### Then fixed at the ramp as well, which cleared the rest

The component fix covered the three navigation surfaces. The **cause** was that
the two ramps met:

```
--canvas: 28 24 21   --canvas-mid: 33 29 25   --canvas-deep: 39 34 29
--surface: 39 34 29  <- the same value
```

Canvas climbed `28 → 33 → 39` and surface *began* at 39, so any `bg-cream-300`
chip, badge or hover on a `bg-surface` card had zero contrast in dark mode. The
navigation was just where somebody noticed.

The dark surface ramp is now lifted one existing step — `--surface` becomes
`46 40 34`, the value `--surface-mid` already carried, so it is a shade this
palette had vetted rather than a new invention. `mid 54 47 40`, `deep 62 54 46`.

Chose the smaller of two candidates on purpose. Lifting to `48 42 36` gave a
channel-sum separation of 24 but cost more text contrast; `46 40 34` gives **18**,
the same order as the light ramp's own steps (`250 → 245 → 237`), and keeps more
headroom. Checked against the contrast suite, not by eye:

| role on `--surface` (dark) | before | after | floor |
|---|---|---|---|
| `--text-strong` | 12.34:1 | **11.40:1** | 4.5 |
| `--text` | 9.12:1 | **8.42:1** | 4.5 |
| `--text-soft` | 5.68:1 | **5.25:1** | 4.5 |
| `--accent-text` | 7.11:1 | **6.57:1** | 4.5 |
| `--text-faint` | 3.55:1 | **3.28:1** | must stay *below* |

Elevation ordering still holds — `sunken < canvas < surface < surface-mid <
surface-deep` — which `theme-contrast.test.ts` already pinned.

**The documented dark ratios were wrong before any of this.** theme.css claimed
`14.8 / 11.4 / 6.1` for the dark text roles on surface; the real values on the old
surface were `12.34 / 9.12 / 5.68`. Nothing caught it because the "ratios in
comments are true" test only covers the **light** block — light was accurate to two
decimals, dark had never been checked. Now measured, and labelled as measured.

The dark entry is gone from the collision allowlist. The two remaining light
entries are annotated as **unexploitable** rather than merely unexploited:
`bg-surface-mid` and `bg-surface-deep` have **zero usages** anywhere, so nothing
can stack on them. A new assertion pins `--canvas-deep` clearing `--surface` by a
real margin in both themes, so a future squeeze fails instead of quietly hiding
chips again.

The navigation keeps `bg-cream-400` (`--sunken`) rather than reverting: on the
lifted surface that is a distance of 66 versus 18, and a selected tab deserves the
stronger of the two.

### The sidebar had never been viewable

`preview/shell.html` was added to the screen harness, with an auth stub, because
the shell only exists behind a sign-in — which is why a zero-contrast selected tab
survived this long. Built by `preview/vite.config.ts`, not shipped.

> Method note for whoever debugs theming next: reading `getComputedStyle` in the
> same tick as setting `data-theme` in a headless pane returns **stale values**. It
> produced two false readings during this investigation — first "the whole panel is
> white in dark mode", then "light mode reports dark values". Neither was real.
> Take the numbers from `theme.css`, which is the source of truth.

---

## 2026-08-18: the white border blink on every nav click

Reported as: clicking a left-panel button makes that button **and the one
above/below** blink a white border in sequence, dark mode only.

Not the panel, not the pill — **Tailwind's preflight**:

```css
*,:before,:after{ border-width:0; border-style:solid; border-color:#e5e7eb }
```

Every element defaults to a **fixed light grey** border colour at zero width. The
selected nav item added `border border-hairline/10`; the unselected one had no
border utility at all. So with `transition-all`, one click animated:

```
border-width   0        ->  1px
border-color   #e5e7eb  ->  rgba(255,255,255,.1)      (opaque grey to 10% white)
```

For 150 ms that drew a near-opaque light line on a `46 40 34` panel. The
previously selected item ran the same transition in reverse and got **brighter as
it shrank** — which is why two adjacent buttons appeared to blink in sequence.
Invisible in light mode because `#e5e7eb` on cream is nothing, exactly as
reported.

Measured every frame of the transition on both buttons, before and after:

| | before | after |
|---|---|---|
| `border-width` across the click | `0px → 1px`, animated | **constant `1px`** |
| brightest border frame | opaque `#e5e7eb` | **`rgba(255,255,255,0.1)`** |
| bright frames | — | **0** |

Two changes. `borderColor.DEFAULT: 'transparent'` in `tailwind.config.js`, because
a border nobody coloured should not appear rather than appear in a colour that
cannot follow the theme — verified first that **no** element in `components/` sets
a border width without also setting a colour, so nothing relied on the grey. And
the inactive nav state now carries `border border-transparent`, holding the width
constant: no animation, and no 1px content nudge on every tab change (box-sizing
is border-box, so the icon and label used to shift inward each time).

### The ratchet had two holes, and closing them found three more fixed colours

**1. Directional variants.** `border-l-blue-500` never matched `border-` followed
by a palette name, so `DriverHistory`'s stat stripes carried stock blue and green —
beside a themed `border-l-saffron`, with the numbers next to them already on
`--info-text` and `--success-text`.

**2. The walker only inspected lines containing `className=`.** Class lists here
are routinely built across several lines, and the continuation line holding the
offending class mentions neither `className` nor stands alone in quotes, so it was
**skipped outright**. It now tests inside quoted spans wherever they appear, which
immediately surfaced `border-green-500/50` in `PhoneNumberInput` (beside a
checkmark already using `--success-text`), `border-red-400` in `LoginScreen` and
`border-red-300` in `VehicleForm` — all invalid-state borders that belonged on the
danger ramp.

That change also broke a meta-test I had written, which probed for `className=` —
a string that cannot appear inside a quoted span, so it would have passed
vacuously forever. It now probes for a class `App.tsx` really contains.

> Worth internalising: this is the third distinct bug in this file's history caused
> by a **pattern-matching guard that quietly matched nothing**. The audit-collection
> guard, the recurrence drift guard, and now the colour walker. When adding one,
> always break the thing on purpose and watch it fail.

`#e5e7eb` no longer appears anywhere in the shipped CSS.

---

## 2026-08-18: manager navigation reorganised

Three things moved out of places nobody would look for them.

| what | from | to |
|---|---|---|
| **Fleet** | a section in Setup's accordion | sidebar, 4th |
| **Raw records** | a section in Setup's accordion | sidebar, **last, behind a divider** |
| **Manager invites** | inside Setup → **Venue** | the **People** page |

Setup keeps the three things that actually describe a sabha: calendar, ride window,
venue. Fleet is an operational list touched most weeks, not configuration. Invites
were filed under a heading about where drivers are routed to; granting someone
manager rights is a people decision.

### Records is last and separated on purpose

It edits live documents holding riders' names, phone numbers and home addresses,
with no undo, so it must not sit beside the button a manager presses every Friday.
The `danger` warning Setup drew above it **moved with it**, verbatim, into
`components/manager/ManagerRecords.tsx` — losing that while making the tool easier
to reach would have been strictly worse than leaving it in the accordion.

`ManagerRecords` exists as a wrapper for a second reason: `DatabaseConsole`'s root
is `space-y-6 pb-12` with **no horizontal padding**, because it borrowed the
accordion's `p-4`. Rendered directly it would run to both viewport edges.
`FleetManagement` had the same gap and gains `max-w-3xl mx-auto` so it does not
stretch the full width of a desktop window while every sibling page stays in one
column.

### The bottom nav went 5 → 7, and the labels are why it fits

**Measured, not assumed.** At a 343px row — a real 375px iPhone minus the nav's
padding — the seven labels total **306px**, so nothing truncates. But only because
they read `Fleet` and `Records`: `RAW RECORDS` at `text-[10px]` uppercase does not
fit, which is why the nav label differs from the old section title.

One caveat left deliberately: last in the sidebar means bottom, but in the bottom
nav last means **rightmost** — a comfortable thumb position. If that turns out to
matter, moving it is one line.

### Incidental cleanups this made possible

- `NavItem` is a real type, so `id` is a `TabView` and the two `item.id as TabView`
  casts are gone.
- The `danger` machinery in Setup's `Section` went with Raw records — 8 references,
  and that was its only caller. Restore from git if a genuinely destructive setting
  ever lands there.
- `preview/cloud-functions-stub.ts` gained `createManagerInvite` and lost
  `geocodeAddressViaCloud`, which no longer exists in the real module.

### Two traps the tests pin

- **Invites must render OUTSIDE People's `total === 0` branch.** That branch returns
  an "All caught up" card *instead of* the sections, so nesting invites there would
  make the feature vanish for most of the week and look deleted. Verified by moving
  it in and watching the test fail.
- **Every nav id needs a `case` in App.tsx.** A nav item with no case renders
  `ManagerDashboard`, so the button "works" and shows the wrong page. Also verified
  by deletion.

> Self-correction worth recording: the first attempt appended "Invite a manager
> below." to People's subtitle, and an existing test caught it. That was the right
> call — the sentence made the approval-queue line a run-on when the invites section
> already carries its own heading. Reverted rather than updating the test to match.

---

## 2026-08-18: four classes of silently-dead CSS

All four came out of **one screenshot** of the Raw records page. None errored, none
warned, and every one looked fine in light mode.

| # | shape | count | effect |
|---|---|---|---|
| 1 | `border-hairline/20/60` — two `/alpha` modifiers | 3 | not a Tailwind class, so **no rule at all** — the border never existed |
| 2 | `clay-btn-cta` — never defined | 2 | buttons rendered as **unstyled text** |
| 3 | `bg-coffee text-white` — a TEXT token as a background | 6 | **1.28:1** in dark; white on near-white |
| 4 | `overflow-x-auto` without `no-scrollbar` | 1 | a solid **orange bar**: the global thumb is a 10px saffron gradient |

### Why #3 is the interesting one

`bg-coffee` is `--text-strong`, and **the text ramp inverts between themes** —
`61 41 20` in light, `232 227 220` in dark. So `text-white` on it measured 13.76:1
in light and **1.28:1** in dark, against a 4.5 floor. That was the unreadable active
tab in the screenshot, both toasts (including the UpdateBanner written the same day,
where the pattern was copied without checking), a `RideWindowControl` button, and the
bulk-delete bar — whose secondary text was `text-coffee-400` *on* `bg-coffee`, low
contrast in **both** themes.

Fixed as an **inverted pair**: `bg-coffee text-cream`, where both tokens flip
together — **13.07:1** light, **13.82:1** dark. `RideStatus` keeps a bare `bg-coffee`
dot and is allowlisted: with nothing rendered on it, "the strongest text colour" is
exactly the right maximum-contrast mark.

### Also: the Records page had two titles

`DatabaseConsole`'s banner repeated the page heading directly beneath
`ManagerRecords`' `<h1>` — a consequence of moving it out of Setup without stripping
the old header. The banner now carries only what that component alone can say: the
mode badge and the action.

### The guards, and how the first draft of them was wrong

`tests/quality/silent-css.test.ts`, one guard per shape. Two properties matter more
than the rules themselves:

**It strips comments before scanning.** Every fix left the offending string in a
comment explaining it, and this project has *twice* shipped a guard that matched its
own prose — a Tailwind class named in a comment got re-emitted into the bundle, and a
key name in a comment failed a "nothing reads this" test.

**Its first draft passed with two of the four bugs reintroduced**, and only
reintroducing them found it:

- the span reader worked **line by line**, so a multi-line template literal
  (`` className={`clay-btn-cta … ${ ``) was invisible and guard 2 passed with the bug
  in plain sight. It now reads whole-file spans.
- guard 4 allowlisted by **file**, and `DatabaseConsole` holds both a legitimate
  table wrapper *and* the buggy strip — so the allowlist excused both. It now
  allowlists the **exact class string**.

All four fire on reintroduction. That is now three separate occasions in this project
where a pattern-matching guard quietly matched nothing; the rule stands — break the
thing on purpose and watch it fail.

---

## "It looks right on localhost but wrong on the live site"

Reported 2026-08-18. **The deployed bundle was correct.** This is worth writing down
because the report is ambiguous by construction and the two causes need opposite
fixes.

### It was not the build

Served the real production bundle locally (`.claude/launch.json` → **`prod-build`**,
`vite preview --outDir dist` on 4175) and compared computed styles against the dev
server and the live site on the same page:

| | dev `:3000` | prod build `:4175` | live |
|---|---|---|---|
| h1 | Great Vibes 36px/700 `rgb(184,67,24)` | identical | identical |
| card | Inter 16px, radius 24px | identical | identical |
| button | Inter 14px/600, radius 9999px | identical | identical |
| `--canvas` / `--surface` / `--accent` | `250 249 246` / `255 255 255` / `255 107 53` | identical | identical |

Byte-for-byte across all three. Ruled the build out in one step — that is what the
`prod-build` entry is for.

### The asymmetry that makes localhost misleading

**Dev never registers a service worker at all.** Its `/sw.js` returns the SPA
fallback *HTML*, so registration fails outright:

```
localhost:3000/sw.js  ->  200  Content-Type: text/html   <!DOCTYPE html>…
live /sw.js           ->  200  content-type: text/javascript
```

So localhost can never be stale and the deployed origin can. "Works locally" carries
no information about the deployed bundle here.

### And it was partly self-inflicted

Moving the PWA to `prompt` mode (to stop a driver being reloaded mid-carload) meant
new versions **wait for consent**. A client that never notices the banner therefore
runs old code indefinitely — which is precisely what happened.

Fixed with `applyUpdateWhenUnobserved` in `src/utils/swUpdate.ts`:

- **tab hidden** → apply the waiting worker now; the reload happens off-screen and
  the next look at the tab is already current
- **tab visible again** → re-check for a newer worker, so returning after a day does
  not wait out the 15-minute poll

The banner stays for an actively-used tab, where being asked is right rather than a
nuisance.

> **It cannot rescue a client that does not have it yet.** Anyone already on a stale
> bundle needs one manual clear to pick this up; after that it maintains itself.
> The console one-liner:
>
> ```
> navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister()))
>   .then(()=>caches.keys()).then(k=>Promise.all(k.map(c=>caches.delete(c))))
>   .then(()=>location.reload())
> ```
>
> And to check which version a browser is on:
> `document.querySelector('script[type=module]').src`

---

## 2026-08-18: the install prompt was invisible on every iPhone

Asked whether the app could be installed on a phone the way it can on desktop. The
answer surfaced a live defect rather than a missing feature.

`components/PWAPrompt.tsx` offered installation **only** in response to
`beforeinstallprompt`. **WebKit never fires that event**, and WebKit is the only
engine allowed on iOS, so the banner returned `null` on every iPhone and iPad, for
every user, permanently. Nothing failed and nothing appeared. "Use Chrome instead"
is not a workaround either — Chrome for iOS is Safari's engine wearing Chrome's
interface, so it behaves identically here.

This matters more than it looks: **most of this congregation's drivers are on
iPhones.** The one platform that got no prompt is the majority platform.

### What replaced it

`src/utils/pwaInstall.ts` holds one verdict function that both consumers read, so
the banner and the Profile entry cannot disagree:

| verdict | when | what is shown |
|---|---|---|
| `installed` | already running from the home screen | nothing — never nag |
| `prompt` | the browser handed over an event | one-tap Install button |
| `manual` | iOS, where only the user can do it | the two actual taps, worded per browser |
| `none` | no route exists (desktop Firefox, a real Mac) | **nothing at all** |

`none` is the important row. A permanently visible "Install" on a browser that
cannot install is this repo's standing failure mode, so the absence is the feature.

Three details that are easy to get wrong and are each pinned by a test:

- **iPadOS 13+ sends a desktop Mac user-agent.** Touch points are the only thing
  separating an iPad from a MacBook, and the distinction is load-bearing: a real
  Mac must NOT be told to hunt for a Share icon it does not have.
- **Safari puts Share in the bottom toolbar; Chrome and Edge for iOS put it in the
  address bar.** Naming the wrong end of the screen is how a two-step instruction
  gets abandoned, so step one names the right place per browser.
- **The event is captured at module scope**, from `index.tsx`, not in a hook.
  Chrome fires it once and early — often before React mounts — and it cannot be
  requested again. A listener added on mount can miss it outright.

### A defect written and caught inside this change

The first draft held `dismissed` in component state. The banner and the Profile
entry are separate `usePwaInstall` callers, so pressing the entry wrote the
storage key and **notified nobody** — the banner's own copy had been read once at
mount and would never look again. Wired up, silently inert: the same shape as the
bug being fixed. Dismissal now lives in module state with a subscription, and
`tests/components/InstallAppButton.test.tsx` fails if the notification is removed.

### Where it lives

Profile, for the same reason `ThemeToggle` is there — it is a property of the
device, and Profile is the one destination all three roles share. The desktop
sidebar footer gets it too. **Not** in onboarding, and not in the nav lists:

- onboarding runs **once**, so skipping it or signing up on a laptop means never
  seeing it again;
- drivers land on `PendingApproval`, so an icon installed there opens to "waiting
  for approval";
- the manager's bottom nav is already seven items at 375px, with no room for an
  eighth;
- and asking for commitment before the first ride is asking before the app has
  been any use.

### The quality guard that had to be narrowed, carefully

`tests/quality/native-dialogs.test.ts` bans `window.prompt`. Chrome's install
event **also** has a method called `prompt`, and its type must be written down
because `lib.dom` has no definition for it. The guard now skips method signatures
in type declarations — a return-type annotation directly after the parameter list
is not valid as a call expression — and the ban was re-verified against four real
call forms (`prompt(...)`, `window.prompt(...)`, `alert(...)`, `confirm(...)`),
each of which still fails it. **Narrowed, not weakened.**

### Verification

41 new tests (**769** client, up from 728). Four deliberate breakages, each
confirmed to fail:

| breakage | failures |
|---|---|
| iOS gets no verdict (the original bug) | 9 |
| a real Mac told to hunt for a Share icon | 2 |
| dismissal stops notifying the other caller | 2 |
| an Install button rendered on iOS | 1 |

Also checked in a real browser against the production build, because no test
covers `index.tsx` itself: dispatching a cancelable `beforeinstallprompt` returns
`false`, proving the module-level listener is present in the shipped bundle and
called `preventDefault()`.

**Not visually confirmed on a real iPhone**, and not verifiable from here — the
banner lives in the authenticated tree, and the browser pane cannot present itself
as iOS. The DOM assertions cover the wording and the absent Install button; the
appearance on a physical device has not been seen.

### Deployed

Released hosting-only on 2026-08-18 (rules and functions untouched by this
change). Live bundle `index-BZOSUz-K.js`, verified by content: the live file
contains `beforeinstallprompt`, `sabha-install-dismissed`, and both per-browser
Share strings.

Clients already running the previous build pick this up **on their own** — that
build carries `applyUpdateWhenUnobserved`, which applies a waiting worker while
the tab is hidden. No cache-clearing instructions needed this time.

### Still open

The **post-ride trigger** was planned and is not built. `CompletionScreen` already
fires confetti and "Great job!", which is the highest-goodwill moment in the app
and the natural place to ask. Today the banner appears on first visit and once
only; the Profile entry is the permanent way back.

---

## 2026-08-18: the dark-mode banner, and a dock with seven items on a phone

Two mobile reports, from screenshots of the real app.

### 1. The update banner was a bright slab in dark mode

Not a token that failed to switch — a token switching in the *wrong direction*.
`UpdateBanner` and `PWAPrompt` both used a deliberate inverted pair: the coffee
background utility with cream text. That background reads `--text-strong`, and
the **text ramp flips between themes** — 61 41 20 in light, 232 227 220 in dark.
So the panel itself became near-white on a dark app. Contrast was never the
problem (13.8:1); the banner was simply painted from the text ramp instead of
the panel ramp.

Both now use `bg-surface`, which moves with every other card, plus a saffron
accent bar carrying the "this is a notice" weight the inversion used to.
Measured in a real browser, reading a frame after the theme switch:

| | light | dark |
|---|---|---|
| banner background, new | `rgb(255,255,255)` | `rgb(46,40,34)` |
| banner background, old | `rgb(61,41,20)` | `rgb(232,227,220)` |
| heading text | `rgb(61,41,20)` — 13.76:1 | `rgb(232,227,220)` — 11.40:1 |
| muted second line | 5.15:1 | 5.25:1 |

The accent is a positioned span, not a border: the elevation rule is border OR
shadow, never both, and `shadow-2xl` is what lifts these off the page.

`bg-coffee` is **not** banned generally — it is a deliberate emphasis idiom in
`RideWindowControl` and `DatabaseConsole`, where a dark chip on a page is the
point. It is banned only for these two, which are panels. A new guard in
`theme-tokens.test.ts` keeps the pair together, because the likely regression is
restyling one and forgetting the other, leaving two differently-coloured notices
in the same corner.

### 2. Seven destinations across a 390px phone

~47px each, which is why the labels are `text-[10px]` and only just fit. Now four
stay docked — **Dispatch · People · Fleet · Setup** — and Reports, Profile and
Records move behind a More control. Five slots at ~78px, the budget iOS uses.

**The overflow opens UPWARD as a drawer, and the dock's own height never
changes.** That is the constraint that shaped the design: `--bottom-nav-h` is a
static token and `<main>` in Layout.tsx reserves exactly that much bottom
padding, so a dock that genuinely grew would hide the last row of content behind
itself and make the page jump on every open.

Two details that are easy to miss:

- **Drivers and riders get no More control at all.** They have three
  destinations, and a button opening an empty drawer is the dead control this
  repo keeps deleting. `primary` is simply unset for them, and the split
  degrades to "show everything".
- **More is marked active while a hidden destination is current.** Without it a
  manager sitting on Records looks down at a dock with nothing lit and has lost
  their place.

A side effect worth keeping: Records edits live names, phone numbers and home
addresses with no undo. On desktop it sits behind a divider for exactly that
reason; on mobile it now sits behind a deliberate tap rather than beside the
button a manager hits every Friday.

The **sidebar is untouched** and still shows all seven — a desktop rail has the
room a phone does not. `getNavItems` still returns all seven in order, so
`managerNavigation.test.tsx` keeps parsing what it always did.

### Two guards moved, neither weakened

- `native-dialogs.test.ts` — the drawer's click-catcher is a `fixed inset-0`,
  which trips the hand-rolled-overlay ratchet. `Layout.tsx` joins `RoleSwitcher`
  in `NOT_DIALOGS` for the identical recorded reason: a dropdown is not modal,
  and trapping focus inside three nav destinations would make the rest of the app
  unreachable to a keyboard.
- `theme-tokens.test.ts` — the `bg-cream-400` count went 3 → 4. The fourth is the
  More control, which takes the same active chip. The assertion it protects
  (none of these fills use the colliding `cream-300`) is unchanged.

### Verification

14 new tests, client **769 → 783**. Four deliberate breakages on the dock, each
confirmed to fail: a More control with nothing to overflow (2), the active
marking dropped (1), no split at all (2), and a drawer that stays open after a
choice (1). Every new utility was confirmed present in the built stylesheet —
`clay-bottom-drawer`, `z-dropdown`, `grid-cols-3`, `w-1.5`, `pl-5`,
`text-coffee-400` — because silently-dead CSS is the standing failure here.

**Not seen on a real phone.** The dock is mobile-only and behind auth, so the
browser pane cannot reach it; the DOM structure and the theme colours are
measured, the appearance is not.

### Follow-up, same day: the seam, and swipe-to-open

A screenshot from the phone showed the drawer and the dock reading as two
stacked cards rather than one panel. Three things caused it, all of them the nav
still claiming to be the top edge of the chrome while the drawer sat above it:

- its `border-radius` cut two notches of drawer colour into the join — the most
  visible part of the seam;
- its upward cast shadow drew a dark line across the join;
- its inset highlight drew a second, lighter line just under that.

`.clay-bottom-nav.is-expanded` drops all three, and the drawer takes the lift and
the highlight instead. The drawer is also **flat `--surface` rather than the
nav's gradient**: carrying the same gradient meant it ended on `--surface-mid`
and the nav restarted on `--surface`, a tonal step exactly at the join.

**Swipe up to open, down to close**, past 24px of travel. It is an ADDITION to
the More button, never a replacement — a gesture with no visible control is
undiscoverable and unreachable by keyboard. A grab handle sits in the nav's
existing 8px of top padding, positioned absolutely so it adds NO height;
`--bottom-nav-h` is what everything else clears by, and growing the nav for a
decoration would put the two out of step.

The non-obvious part is the click guard. A swipe that STARTS on a nav button
still fires that button's click when the finger lifts, so swiping up from Fleet
would open the drawer *and* navigate to Fleet. A capture-phase handler on the
nav stops it before the button's own handler — the only place it can be stopped.

The grab handle first used `bg-coffee-400`, which the silent-CSS guard rejected:
`coffee-400` is `--text-faint`, a TEXT-ramp token, and the guard bans those as
backgrounds. Rather than widen its allowlist it moved to `--hairline`, which is
what a decorative rule is for. No guard was touched.

8 more tests (client **783 → 791**), four more deliberate breakages each
confirmed to fail: no click guard, no swipe threshold, the nav keeping its top
edge, and gestures attached to a dock with nothing to overflow.

### Then the More tab came out

Asked for on sight of the working gesture: four destinations plus a fifth tab
that was not a destination read as five peers.

It was NOT replaced with nothing. The pull handle became the control — same
pill, now a `<button>` with the same accessible name. Swipe-only would have
stranded Reports, Profile and Records: **on a phone this dock is the only
navigation there is**, the sidebar being desktop-only, so anyone who cannot make
a touch swipe (keyboard, switch access, VoiceOver) would have had no route to
three destinations at all.

The handle also inherits the job the More tab was doing: it turns **saffron**
while a hidden destination is current. Without that the dock reads as "nothing
selected" whenever a manager sits on Records. It stays inside the nav's existing
8px of top padding — no height added, and entirely above the 64px row, so it
cannot swallow taps meant for a destination.

`bg-cream-400` in `theme-tokens.test.ts` went 4 → 3 with the More chip gone; the
handle marks the same state with a bar, so it needs no fill.

2 more tests (client **791 → 793**). Three deliberate breakages confirmed to
fail — the loudest being the handle reverting to decoration, which fails **10**
of the 21 dock tests.

### And then gesture-only, by decision

The handle was a `<button>` for one commit. The owner was shown the trade-off and
chose **swipe-only** anyway, so the handle is a hint again.

**What that costs, recorded so nobody rediscovers it as a bug:** on a phone this
dock is the only navigation there is — the sidebar is desktop-only — so a swipe
is now the ONLY route to Reports, Profile and Records. Anyone who cannot make one
(keyboard, switch access, VoiceOver) cannot reach those three on a phone at all.
`tests/components/bottomNavOverflow.test.tsx` asserts the absence of a control on
purpose, so it reads as a decision rather than something that fell off. Restoring
it is small: wrap `GrabHandle`'s bar in a `<button>` with `onClick`,
`aria-expanded` and an `aria-label` of "More destinations".

**A real bug fell out of making the gesture the only way in.** The click guard
used a bare "a swipe just happened" flag, and that flag stayed armed after the
swipe that opens the drawer — so the very next tap, on a destination inside the
drawer the swipe had just revealed, was swallowed and the drawer sat there doing
nothing. While a More button existed this was rare; with the gesture as the only
entry it was on the path **every single time**. The guard now matches the element
the finger STARTED on: the synthetic click a swipe produces always targets its
origin, and anything else is a real tap.

Released as bundle `index-DuHkD1EE.js` / css `index-DXyTT9ex.css`. Verified
against the LIVE files: the touch handlers are present, the seam rule
`.clay-bottom-nav.is-expanded{border-radius:0;box-shadow:none}` is in the
stylesheet, and both "More destinations" and the three-dot glyph appear ZERO
times.
Verified against the LIVE stylesheet, which carries
`.clay-bottom-nav.is-expanded{border-radius:0;box-shadow:none}` and the drawer's
flat `background:rgb(var(--surface))`, and the LIVE bundle, which carries the
touch handlers.

### Deployed

Released hosting-only on 2026-08-18 — bundle `index-CBEY3OUO.js`, css
`index-FZb-2q1w.css`. Verified against the LIVE files, not just the filenames:
the stylesheet carries `clay-bottom-drawer` and the `dropdown` rung, the bundle
carries both More labels, and the old inverted panel markup appears **zero**
times.

---

## 2026-08-18: mobile layout polish, and a measurement that was wrong twice

Five phone screenshots. The complaints were "misalignment" and sizes; the causes
were shared, not per-screen.

### The one real defect: header actions wrapped their own labels

"Add Vehicle" and "Download CSV" were each broken across two lines beside titles
also broken across two lines. **This is a flex default, not a size choice.** In
`justify-between` a flex child will not shrink below its own content — but its
content is TEXT, whose minimum is one WORD, not one line. So the button narrowed
to the width of "Download" and put "CSV" underneath.

`shrink-0 whitespace-nowrap` on the action and `min-w-0` on the title block: the
title gives way, the control keeps its shape. Measured in a browser against the
real stylesheet:

| header | width | before | after |
|---|---|---|---|
| Fleet | 345px | "Add Vehicle" on 2 lines | 1 line |
| Weekly Attendance | 297px | "Download CSV" on 2 lines | 1 line |

### Two measurements that were wrong, and how

Both worth recording, because both would have produced a confident wrong answer.

1. **`getClientRects()` on a block element returns ONE rect** — the border box,
   not one per line. The first run reported "nothing wraps anywhere", which
   contradicted the screenshot. A `Range` over the text node gives one rect per
   line box, and that immediately showed 2 lines.
2. **The card width is not the page width.** The page has `p-6` and the card
   inside it has `p-6` again: 393 − 48 − 48 = **297px**, not 345px. Measured at
   345px the Weekly header does not wrap at all. Measuring the wrong box said
   "no bug" for a bug that is in the screenshot.

### Smaller fixes

- **The week-ending date broke at its own hyphens** — "Week ending 2026-08-" /
  "21", which reads as two dates until you look twice. The date is wrapped in a
  `whitespace-nowrap` span; the words before it may still wrap.
- **Day chips** wrapped 5 + 2 at widths from 44px to 54px. A 4-wide grid gives
  4 + 3 with every chip 68px. **Not 7-across:** `min-w-11` fights a 7-column
  track at 297px, and the measured result was SEVEN rows of one chip each.

### Not verified: the time inputs

The Setup screenshots suggest the two-up `Default Start` / `Default End` row is
overflowing its card on iOS. `min-w-0` is on the grid cells now, which is the
standard fix — a grid child will not shrink below its content, and a native time
control reports a wide intrinsic size on iOS.

**But it could not be reproduced here.** Chromium's time control shrinks happily
even at a 200px container, so the fix measured as an exact no-op at every width
tried (326, 240, 200). It is applied on the strength of the screenshot and a
known mechanism, not on a reproduction. **Worth a look on the phone.**

### Left alone deliberately

The stat cards on Reports look uneven because "STUDENTS SERVED" wraps and "THIS
WEEK" does not — but the 40px icon pins the row height, so the numbers below DO
align and the cards are the same height. Nothing to fix; changing it would be
churn.

Released as bundle `index-BCKCNHiN.js` / css `index-Ms4Cnfwp.css`. All three
header buttons verified present in the LIVE bundle by counting OCCURRENCES —
`grep -c` counts lines, and a minified bundle is a few very long ones, so it
reported 2 of 3 and looked like a missing button.

6 new tests (client **794 → 800**), three deliberate breakages each confirmed to
fail. The guard reads button classNames out of the source and **throws** on a
label it cannot find, so it cannot pass vacuously.

---

## 2026-08-18: the Fleet header, and the thing that was actually wrapping it

Asked to drop the `+` from "Add Vehicle" and align the header properly. The
first half was the ask; the second half needed measuring, and the obvious guess
was wrong.

**Removing the `+` did not unwrap the title.** It returned 26px — the button
measured 151px with the glyph and 125px without — but at 393pt the title and
subtitle both still broke across two lines.

**Shrinking the type did not help either.** `text-lg` in place of `text-xl` gave
exactly the same 2 lines / 2 lines / 96px. The constraint was never the font.

**The decorative shield tile in the header was the whole cause.** 40px plus a
12px gap is 52px out of 345px:

| header at 393pt | title | subtitle | height |
|---|---|---|---|
| shield + `text-xl` | 2 lines | 2 lines | 96px |
| shield + `text-lg` | 2 lines | 2 lines | 96px |
| **no shield** | **1 line** | **1 line** | **48px** |

So the tile is gone. `ManagerReports` never had one, so the two manager headers
now match. Measured across widths, with the action's top aligned to the title's
top to the pixel:

| device | title | subtitle | header |
|---|---|---|---|
| 393pt (iPhone 15) | 1 | 1 | 48px |
| 375pt | 2 | 1 | 76px |
| 320pt (SE) | 2 | 2 | 96px |

It degrades rather than breaking — nothing overflows at any width from 320 to
430.

2 new tests (client **800 → 802**), both confirmed to fail when the `+` and the
icon import are put back.

Released as bundle `index-QJhcNF9l.js`. Verified in the LIVE bundle: the header
button'''s `children` is the plain string "Add Vehicle" with no element beside it,
and the header goes straight from the `min-w-0` wrapper to the `h1` with no icon
tile between them.

---

## 2026-08-18: the iOS time inputs, reported twice

The Setup screen's `Default Start` / `Default End` pair looked cut off on a
phone. The first attempt added `min-w-0` to the grid cells — the textbook fix
for a grid child refusing to shrink — **and it changed nothing.**

### Why it could not be found from here

**Chromium does not have the bug.** Its time control shrinks happily, down to a
200px container and past it. Measured before and after at 326 / 240 / 200px,
`min-w-0` was an exact no-op at every width. The engine on this machine simply
behaves differently from the one on the phone, so no amount of local measuring
would ever have shown it. That is worth remembering as a category: *a fix that
measures as a no-op locally has not been tested, it has been skipped.*

### So it stopped being a diagnosis

Two changes instead, and the second does not depend on being right about the
first:

1. **Fix the mechanism.** WebKit's widget claims its own width and centres its
   value with its own margins. `index.css` now sets `appearance:none` on
   `time` / `date` / `datetime-local` and normalises
   `::-webkit-date-and-time-value` to `text-align:left; margin:0`, plus drops
   the inner spin and clear buttons this app never uses.
2. **Remove the constraint.** Every two-up time row now stacks below `sm`, so
   each control gets the full card width and there is nothing left to overflow —
   true whatever the widget decides it wants. Four rows across
   `LocationSettings`, `RecurringSabha` and `SabhaCalendar` (×2).

`SabhaCalendar`'s inputs also had no `w-full` at all — they were bare grid
children, which is the worst version of this — so they got `w-full min-w-0` too.

### What was verified, and where

Measured in a real browser against the built stylesheet:

| | result |
|---|---|
| narrow viewport | stacked, full width, **0px overflow** at 297 and 272 |
| 900px viewport | side by side, 294px each, **12px gap**, no overflow |
| control still works | focusable, accepts values, `showPicker()` present |
| value alignment | `text-align: start`, `margin: 0px` |
| desktop picker indicator | still `inline-block` — **not** hidden |

That last row is a deliberate guard: hiding the calendar picker indicator would
have removed the only affordance on desktop, so a test fails if it is ever added
to the hidden list.

**Still not confirmed on the device itself.** The stacking is deterministic and
does not rely on the diagnosis, but the phone is the only place that can say so.

8 new tests (client **802 → 810**), three deliberate breakages each confirmed to
fail: normalisation removed, a row back on a bare two-column grid, and
over-reaching to hide the desktop picker.

Released as bundle `index-CSXhoV4V.js` / css `index-T7da3jeJ.css`. Verified in
the LIVE stylesheet — the `appearance:none` rule, the normalised
`::-webkit-date-and-time-value`, and **zero** occurrences of a hidden calendar
picker indicator — and in the LIVE bundle, which carries all four stacking rows
(2 x `gap-2` from SabhaCalendar, 2 x `gap-3` from Setup).

---

## 2026-08-18: the white border on the home screen icon

Installed on a phone, the app icon sat inside a white frame while every other
icon bled to its edge. Three separate faults in the source art, and the first
guess about the cause was wrong.

**It was NOT transparency.** The usual reason for a white ring is a PNG with a
transparent margin, which iOS composites onto white. These files had **no alpha
channel at all** (`mode=RGB`) — the light surround was painted into the pixels:
**77px on every side of a 640px canvas, 12% of the image.**

The other two, found while fixing the first:

- The artwork had **its own rounded corners** inside that surround. iOS applies
  its own corner mask, so the two radii disagree and leak light pixels at the
  corners even after cropping to the plate.
- **`icon-512x512.png` was actually 640x640.** The manifest had been declaring a
  size the file did not have.

### What it took

Four attempts, because each intermediate fix left a different border:

| attempt | result |
|---|---|
| crop to the plate | plate's antialiased rim survives — light edge |
| + flood fill corners | fill colour sampled off the rim — lighter *frame* |
| + edge replication | rounded corners replicate their own arc — frame again |
| **composite onto a flat field** | **border is one colour** |

The last one works because the plate is genuinely flat — measured at
`(53,31,8)` from 4px inside the edge, over 6,354 samples. The mark is separated
by **saturation**, not brightness: the plate is a *warm* brown with saturation
45, so an early threshold of 22 would have half-erased it. Above 70 and below
the car's 140–190 separates them cleanly and keeps the artwork's antialiasing.

Result: the border of every icon is a single colour at every size, and the car
is pixel-identical.

### A second surface fixed while there

The plain icon clears Android's **centre-80% maskable safe zone by only 3px** —
fine as a square, a gamble as a circle. `icon-maskable-512x512.png` is now its
own file with the mark at 60% of the tile: furthest point 167px from centre
against a 205px safe radius. One file cannot be both full-bleed and maskable.

`index.html` now points at **180x180**, which is the size iOS actually asks for.
A side effect worth noting: the flat field compresses far better —
`icon-512x512.png` went from **372KB to 53KB**.

Released 2026-08-18. Verified against the LIVE files: all four are RGB with no
alpha, `icon-512x512.png` really is 512x512, and each one has exactly **one**
colour on its border.

**iOS caches the home screen icon at install time**, so this does NOT update an
icon already on a home screen. It has to be removed and re-added once.

11 new tests (client **810 → 821**), four deliberate breakages each confirmed to
fail. They read the PNG **header** rather than decoding the image, so no new
dependency: that pins the declared-size bug exactly, and pins "no alpha channel",
which is the property that lets iOS paint white in the first place.

---

## 2026-08-18: renamed to Bhulka Gaadi

| now | was |
|---|---|
| **Bhulka Gaadi** | Sabha Ride / Sabha Ride Seva |
| **Bhulku / Bhulka** | Student / Students |
| **Sarthi / Sarthis** | Driver / Drivers |

### The line this rename does NOT cross

`Student` and `Driver` live in three layers here, and only one of them is copy:

| layer | examples | changed? |
|---|---|---|
| copy | "Bhulka Served", "Looking for Sarthi" | **yes** — 46 lines, 19 files |
| **stored** | role literals `'student'`/`'driver'`; collections `/students`, `/drivers`; ride fields `studentId`, `driverId`, `students`, `assignedStudentIds`; status `driver_en_route` | **NO** |
| identifiers | `DriverDashboard`, `useDriverLocation`, `RideStudent`, `driverDoneForToday` | **NO** |

**Renaming the middle layer would be a live data migration, not a rename.**
Every user document in production holds `role: 'student'`, the security rules
match on it, and custom claims are minted from it. Change the literal and the
rules stop matching the data — a silent permission denial, or a guard that
quietly allows, on an app holding children's names, phones and addresses.

`tests/quality/vocabulary.test.ts` asserts in **both** directions: the copy has
moved, and the wire format has not. Verified in the built bundle — zero
occurrences of "Students Served", "Looking for Driver" or "Sabha Ride", and the
role literals still present 18 / 19 / 5 times.

### Judgement calls worth knowing

- **`formatRole` is the boundary in miniature.** Its keys are the stored role
  literals and did not move; its values are the labels people read and did.
- **Developer logs keep the old words.** `console.error('Error marking student
  ready:')` matches the code identifiers (`studentId`), and that is what makes a
  log greppable. The guard skips `console.*` for this reason.
- **The audit action label `'manually assign students'` was left alone.** Audit
  rows are a record; changing the action mid-stream splits the trail into
  before-and-after for no user-visible gain.
- **Comments were left alone.** They discuss the TYPES `Driver` and `Student`.
  An early pass rewrote one of them and it had to be undone.
- **The Firebase project and URL are unchanged** — `sabha-ride-app.web.app`
  stays. Renaming those is a separate job with auth-domain consequences.

### Tests updated rather than weakened

Nine assertions pinned the old wording — four in `functions` (which assert a
call is REFUSED, via a regex on the message) and five in the client. Each had
its wording updated and its strength left exactly as it was.

9 new tests (client **821 → 830**), four deliberate breakages each confirmed to
fail: old copy returning, the role literal being "finished", the collections
being renamed in rules, and the app name reverting in the manifest.

Released 2026-08-18 as **functions then hosting** (15 function files changed, no
rules). Verified against the LIVE site: title and `apple-mobile-web-app-title`
both `Bhulka Gaadi`, manifest name and short_name both `Bhulka Gaadi`, and in
the live bundle **zero** occurrences of the old copy alongside the role literals
still present 18 / 19 / 5 times.

---

## 2026-08-19: the notice board, and a new Notices tab

Managers had no way to say anything that was not a ride event. Push broadcasts
interrupt and leave no trace; there was nowhere to *look*.

A new manager tab holds both tools side by side, deliberately: a **notice** stays
where people can find it, a **broadcast** interrupts once and is gone. On separate
screens that choice would be invisible and broadcast would get used for
everything. The broadcast composer moved out of Setup.

The board renders on all three dashboards, newest first, and posts **delete
themselves** — document *and* image — once their day has passed.

### DEPLOYED 2026-08-19. Storage was enabled by the owner, and enabling it found two bugs

Storage did not exist on this project in any form until the owner clicked
**Storage → Get started**. That unblocked the deploy — and made two things
checkable that had been unverifiable, both of the house failure kind: code that
looks wired up and silently does nothing.

**1. The bucket is `sabha-ride-app.firebasestorage.app`. `appspot.com` does NOT
exist here.** Confirmed with the Admin SDK:

```
sabha-ride-app.firebasestorage.app  exists=true
sabha-ride-app.appspot.com          exists=false
```

`deleteNoticeImage` called `admin.storage().bucket()` with **no name**, which
resolves from the runtime's `FIREBASE_CONFIG` — a field that on a project of this
vintage can still be templated with the legacy `appspot.com` name. Deleting from a
bucket that is not there answers **404**, `ignoreNotFound: true` swallows 404, and
the caller is told the image is gone. Every notice image would have orphaned while
both callers logged success — defeating the entire reason the feature was asked
for ("so that image storage doesn't fill up if it accumulates").

Now resolved explicitly by `noticeBucketName()`, with the bucket's existence
checked **once per instance** so a wrong or missing bucket returns `false` and logs
loudly. A rejected check is deliberately not cached: one network blip must not
refuse every deletion for the life of the instance. The module had been mocked in
every other suite and had **no test of its own** — the one decision governing
whether Storage ever gets cleaned up. It has 12 now.

**2. `storage.rules` granted `allow write` beside `allow delete: if false`.** In
Storage rules `write` expands to create + update + **delete**, and allow statements
are **OR'd** — so the delete denial was decoration. It did deny in practice, but
only because the condition calls `isReasonableImage()`, which reads
`request.resource.size`, and `request.resource` is **null on a delete**, so the
condition errored and the engine denied. Security by accident. Now
`allow create, update`.

**No behavioural test can tell those two apart, and this is worth remembering.**
With `allow write` restored, all 16 new storage rules tests still passed —
verified by making the change and running them. `request.resource` is always null
on a delete, so the emulator can never see the difference. The methods named in
the grant are pinned textually in `tests/quality/storage-rules-shape.test.ts`
instead, in the same spirit as the other `tests/quality/` ratchets. Add one
image-independent clause to that condition and the hole opens silently.

**`storage.rules` also had no tests at all**, on a project holding children's
data. It has 16 now, against the Storage emulator, which `test:rules` starts
(`--only firestore,storage`). Cross-service `firestore.get()` **does** work in
that emulator — checked, not assumed — so the manager check is genuinely covered,
including a manager recorded only in `roles[]` and a caller with no user document
at all.

### Deployed, and how it was verified

Order was `firestore:rules → storage → functions → hosting`, then `main`
fast-forwarded to `0f0cfaf`.

- `storage.rules` **compiled** — which is the real check on the cross-service
  `firestore.get()` syntax, since a malformed rule fails the deploy.
- `publishNotice`, `deleteNotice` and `expireNotices` all reported
  `Successful create operation`.
- Live bundle matched the local build: `index-DLWae5QF.js` in both, HTTP 200.
- **Storage rules are enforced live, not default-open.** An unauthenticated read
  of a notice path returns **403 Permission denied** — a default-open bucket would
  have returned 404 for a missing object. Same 403 outside `notices/`.
- **The exact production code path was exercised server-side**: resolve the bucket
  name the way the deployed function does → `exists()` → write a probe object →
  delete it → confirm it is gone. All four passed; the probe was cleaned up.

**Still not verified, and only the owner can:** a real image upload from a phone.
The emulator proves the rules; it does not prove that a photo picked on an iPhone
uploads, renders the right way up, and is readable by another signed-in account.

### Both omissions are now closed

Both were recorded here as not-done, and both were finished the same day: the
sabha `agenda` field, and the board on the manager dashboard. See the two sections
below.

### The manager dashboard: why the placement took thought — DONE 2026-08-19

The board is on all three dashboards now. Where it goes on the manager's was the
whole problem, and **both obvious answers are wrong**:

- **Not the outer level.** `.app-panel` is a fixed-height flex column, so a sibling
  above `flex-1 overflow-hidden` steals height from whichever tab is showing,
  permanently. During a sabha that is the waiting queue.
- **Not the Waiting tab.** `RequestTable` returns `<EmptyState />` at line 119,
  **before** it renders its own `flex-1 overflow-auto`. So a board placed inside
  that scroller disappears whenever the queue is empty — exactly when a manager has
  time to read it. Placed above the table, it shrinks the queue again.

It sits in the **other tab's `h-full overflow-y-auto` region**, scrolling with the
ride cards at no cost to the queue. Pinned by
`tests/quality/manager-notice-placement.test.ts`, which checks position by SOURCE
ORDER: no DOM test can see a flex-height relationship, and standing up a
ManagerDashboard harness would mean mocking useAuth, six useFirestore hooks, the
toast context, the confirm dialog and two callables to assert a position.

**That still left a gap, so there are two placements, not one.** Managers LAND on
the Waiting tab, so the dashboard alone cannot answer "what does everyone see right
now?". The **Notices tab now ends with that answer** — the real `NoticeBoard`, not a
mock-up, because a preview that can drift from the thing it previews is worse than
none.

For that panel only, `NoticeBoard` takes a `whenEmpty` node. Dashboards pass nothing
and still render `null`, because an empty panel headed "Notices" is furniture. But
on the tab where a manager has just asked the question, silence is not an answer:
it now says what is missing, and that the agenda is set on a **different screen**
(Setup → Sabha Calendar). Leaving that vague is exactly how someone concludes the
feature is broken.

Client only — no rules or functions in that change. Three deliberate breakages
caught: the board hoisted to the outer level, the board removed, `whenEmpty`
ignored.

---

## 2026-08-19: the sabha agenda was dead code, and is now long-form and visible

Deployed. The plan item left out of `766c51c`. Widening the field turned out to be
the smaller half of the job.

### The field was carried perfectly through four layers to nowhere

A manager typed an agenda in the Sabha Calendar → `editOccurrence` wrote it to
`events/{date}` → the recurrence resolver carried it → `updateRideTypeContext`
published it onto `system/rideContext` → `useCurrentEvent` read it into
`CurrentEvent.agenda` → **and no component in the app rendered it.**

Grepped every `.tsx`: outside the manager's own calendar, `agenda` appeared only
in that hook. So a manager could write an agenda and no rider or Sarthi could ever
see it — the repo's signature failure, four layers deep and invisible because
every individual layer was correct. Widening a field nobody reads would only have
produced a bigger invisible field, which is why this is three changes and not one.

### What shipped

- **Long-form.** Both edit surfaces — editing an occurrence and adding a one-off —
  are textareas with a 2000-char `maxLength`. The calendar row shows
  `agendaSummary()`: the first non-empty line, with an ellipsis whenever anything
  was left out **including when the first line fits but more lines follow**. A
  summary that silently drops four paragraphs reads like a one-line agenda. The row
  previously interpolated the whole string into a single-row card.
- **Visible.** It renders on the rider and Sarthi dashboards, **inside the notice
  board** rather than in a panel of its own, so there is ONE place people look for
  "what is happening" — which was the point of the board. Labelled *Sabha agenda*,
  because an agenda belongs to a specific sabha and changes weekly, where a notice
  does not. Plain text with `whitespace-pre-line`, exactly like a notice body; a
  test pins that markup renders as text.
- **Self-clearing.** `clearPastAgendas` deletes **the FIELD, never the document.**
  The event document anchors `weeklyAttendance/{date}`, and removing it would
  strand names, phone numbers and home addresses with no screen that could ever
  show them again — the documented reason `events` is undeletable from the client.
  This sweep must not become a way around that.

Riders also stop *seeing* a past agenda without waiting for the sweep, because
`system/rideContext` republishes the next sabha's agenda every minute. The nightly
job is the durable half: it stops a year of past agendas accumulating on documents
nobody reads again.

### Checked before touching anything

- Event queries are bounded `documentId() >= today` (`functions/src/utils/events.ts`),
  so nothing regenerates or re-reads a past event — a cleared field stays cleared.
- The attendance CSV does not include the agenda, so clearing does not rewrite
  history.

### A new trust boundary, which did not exist before

`editOccurrence` and `createOneOff` write `events/{date}` **straight from the
browser** — no callable in between — and the `events` rules validated **no fields
at all**. Unbounded manager-authored free text on a document every signed-in client
reads is not something to widen and leave.

A 2000-character cap now lives in `firestore.rules`, and **tolerating absence is
part of the rule**: an ordinary times-only merge never sends `agenda`, and
requiring it would break every edit. The cap is mirrored in `src/utils/agenda.ts`
because rules cannot import a constant, and `tests/quality/agenda-cap.test.ts`
fails if the two drift. The dangerous direction is raising the TS constant alone —
the composer would then accept typing that Firestore rejects, losing the manager's
text behind a raw permission error.

### The 03:00 slot now runs two jobs, deliberately uncoupled

`clearPastAgendas` sits **outside** the notice sweep's `try`/`catch`, inside
`expireNotices`. Two tests pin that either half can fail while the other still
runs. Sharing one scheduler entry beats a second function for one bounded query,
but only if a notice failure cannot silently skip the agendas.

### Two tests that were passing for the wrong reason

Both found by making the change and reading the output, not by the suite going red:

- `NoticeBoard.test.tsx` never mocked `useCurrentEvent`, so the component reached
  **real Firestore**, the agenda was always `undefined`, and the whole agenda half
  would have looked covered while being untested. The Firestore warning in stderr
  was the only clue.
- `expireNotices.test.ts` mocked `firebase-admin` as a bare `() => db` with no
  `FieldPath`/`FieldValue`. The new agenda step therefore **threw on every run** and
  was swallowed by its own catch — ten tests stayed green while half the handler did
  nothing. The mock now tags by collection name, the same fix
  `DriverDashboard.test.tsx` needed.

### Verification

**1655 tests** — 933 client, 602 functions, 120 rules. Typecheck 0, build clean.

Eight deliberate breakages, each confirmed to fail: `<` → `<=` on the date
boundary (clears an agenda during its own sabha), the document deleted instead of
the field, the TS cap drifting from the rules literal, the rules cap raised, the
rules type check dropped, the board no longer rendering the agenda, the row
inlining the raw agenda again, and the textarea reverted to an input.

Deployed `firestore:rules → functions:expireNotices → hosting`, `main`
fast-forwarded. The **live** ruleset was then read back through the Firebase Rules
API and confirmed to contain the cap, the type check, the absence clause and both
guarded write paths — a compile success only proves some ruleset shipped.
Live bundle `index-P1By7aoe.js` matched the local build.

### Decisions, and the reasoning that is easy to lose

- **`delete: if false` on `notices`,** even for a manager. Taking a notice down
  must also delete its Storage object, and a client that deletes the document
  first has thrown away the only reference to the file. Deletion goes through
  `deleteNotice`, image first. Same reasoning that already makes `events`
  undeletable from the client.
- **Both `imagePath` and `imageUrl` are stored, and half a pair is refused.** A
  URL renders but cannot be deleted; a path deletes but cannot render. Accepting
  one without the other is precisely how a bucket fills with orphans nobody can
  account for.
- **The body is plain text, rendered with `whitespace-pre-line`.** No markdown, no
  sanitiser, no `dangerouslySetInnerHTML` — which appears nowhere in this app.
  Emoji and line breaks carry the formatting, which is what the real flyers use.
  A test pins that a body containing `<img src=x onerror=…>` renders as *text*.
- **The notice image has an `onError`.** No other `<img>` in this app has one. On
  failure the picture goes and the words stay.
- **Expiry compares dates in the sabha's timezone** via `zonedDateKey`, not
  `toISOString().slice(0,10)`. A UTC comparison would take an evening notice down
  five hours early on the east coast — during the sabha it was advertising.
  A notice shows for the whole of its own day.
- **`storage.rules` mirrors the Firestore manager check deliberately**, reading
  `role`, `registeredRole` AND `roles[]`. A single `role == 'manager'` test would
  silently miss a manager recorded only in the array. Checked, not assumed:
  `grantsRole(data, 'manager')` reduces to exactly `recordsRole(data, 'manager')`,
  because grantsRole's extra clauses only fire for `'student'` and `'driver'`.
- **Size and type are enforced in `storage.rules`,** not only the composer. The
  composer checks them for a readable message — "that image is 4.2 MB" beats a
  raw permission error after a slow upload.
- **A path containing `..` is refused** at both ends. Storage object names are
  literal so it cannot traverse, but the path is sent to the server and used to
  delete an object later, and it does not belong in that position. A test caught
  this; the first sanitiser let it through.

### Nav

The mobile overflow drawer went from three items to four, and it was a
`grid-cols-3` — three across and one orphan on a second row. Now `grid-cols-2`,
a clean 2×2. `Notices` is 7 characters, inside the 8-character ceiling
`managerNavigation.test.tsx` enforces, and sits before `Records`, which that test
pins as last.

One consequence: `DriverDashboard.test.tsx`'s Firestore mock returned the same
untagged shape for every collection, so the board's `notices` subscription
captured the rides listener and nine tests drove the wrong one. The mock now tags
by collection name.

### Verification

**1589 tests** — 890 client, 586 functions, 113 rules (97 Firestore + 16 Storage).
Typecheck 0, build clean. That is 80 new tests across the two commits
(functions 546 → 586, client 874 → 890, rules 89 → 113).

Deliberate breakages, each confirmed to fail: half an image pair accepted, an
image path outside `notices/`, a path reading like traversal, document deleted
before image, a notice expiring during its own event, a manager able to delete a
notice, the body size cap dropped, the bucket suffix set back to `appspot.com`,
the missing-bucket guard removed, a failed bucket check cached, `allow write`
reintroduced, and the catch-all deny removed.

**A note on the typecheck baseline:** `CLAUDE.md` says a clean run is 22
pre-existing errors. It is now **0**. Do not treat 0 as suspicious.

---

## 2026-08-19: the notice card glowed in dark mode, and two other things

Deployed, client only. Four screenshots, three separate problems.

**FINAL STATE FIRST, because the glow fix below was superseded within the hour.**
The notice board now uses **`clay-card`** — the ordinary card — and
`.clay-card-notice`, `--notice-1/2/3` and `--notice-shadow` are **deleted**. The
owner's call on seeing the toned-down version: *"No need to make it stand out. keep
it like other plain cards."*

Deleted rather than adjusted, because dead CSS nothing renders is how a "slightly
tinted" version quietly returns. `tests/quality/notice-card-plain.test.ts` pins that
no `--notice-` token or `.clay-card-notice` rule survives, and carries the reasoning
as the objection to answer if a notice ever genuinely needs its own treatment.

Order mattered: `silent-css.test.ts` asserts every `clay-*` class a component uses is
actually written, so deleting the rule before switching the components fails the
sweep. Verified by doing exactly that on purpose.

The rest of this section is kept because **the diagnosis is still the lesson**, even
though the tuning it describes no longer ships.

### The glow had TWO causes, and the second hides behind the first

**The cast shadow was painted in `--gold`.** On cream that is a warm lift. On a
near-black dashboard the same gold at 20% around a card IS a glow — there is
nothing behind it for a light-coloured shadow to be a shadow ON.
`theme-contrast.test.ts` already states the principle: on dark, elevation comes
from **lightness**, because a cast shadow cannot be seen. So a TINTED cast shadow
is never depth. It can only be glow. Worth remembering the next time a card needs
"a bit of warmth" in dark mode.

**The dark background ramp also climbed too fast.** 46 39 22 → 71 58 28 is a
25-step rise, beside a surface ramp that climbs 16 — steeper *and* far more
saturated, so the card brightened towards one corner like a light source. Fixing
only the shadow would have left half the effect and looked like the fix had not
worked.

Now `--notice-shadow` (gold in light, black in dark) and a 16-step ramp matching
surface, still warm enough to read as a notice rather than an ordinary card.
A **token**, not a `[data-theme]` override: claymorphism.css contains no theme
selectors at all, because theme.css re-pointing tokens IS the architecture.

### Why the Sarthi dashboard looked worse than the rider's

The owner spotted it as "Bhulku dashboard is more clean". The cause:

**`DriverShift` owns the page.** Its own `px-4 pt-6 pb-6` wrapper and the
`<header>` carrying the Sarthi's name. So placing the board around it in
`DriverDashboard` put it ABOVE that header — flush against the app chrome, with the
page's only title pushed below a wall of text. `RiderHome` renders
header → board → card, which is exactly why that screen looked composed.

`DriverShift` now takes an `afterHeader` slot, so the order matches: name, board,
action. A slot rather than an import, because it has no business knowing about
notices — and its POSITION is what the tests pin, not merely that it renders.

### A long agenda buried the primary action

2000 characters rendered whole fills a phone and pushes what each dashboard is FOR
below the fold: the rider's request button, the Sarthi's "go on shift". Both
screenshots show it happening.

Long text now collapses to six lines with a "Read more". **The clamp and the button
come from one call to `isLongForCard`**, so text can never be clipped without a
control to open it — silently truncated text reads as a short notice, and nobody
scrolls for the rest.

Deliberately a heuristic on the text rather than a measurement of the rendered box.
Measuring meant `getClientRects()`, which returns one rect for a block element
instead of one per line, and had already reported "nothing wraps" against a
screenshot that plainly wrapped. A character count cannot be wrong in that
direction: at worst a "Read more" appears on something that would just have fitted.

### Verified in the BUILT and LIVE css, not the JSX

A clamp class Tailwind never generated would be exactly the silent-CSS failure this
repo guards against, and the JSX looks identical either way. So the live stylesheet
was fetched and checked:

- `line-clamp-6{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6}`
- `--notice-shadow: 212 175 55` and `--notice-shadow: 0 0 0` both present
- zero occurrences of `gold` inside the `.clay-card-notice` rule

1681 tests (959 client, 602 functions, 120 rules), typecheck 0. Five deliberate
breakages caught: shadow back to `--gold`, the dark shadow token made warm, the
steep ramp restored, the clamp applied with no expand button, and the slot moved
above the header.

---

## 2026-08-19: Raw records shifted on every collection switch

Deployed, client only. Reported as "every element below feels like they are shaking
or readjusting upon switching". **Measured in `preview/records.html` at 1280x900,
before and after** — this is what that harness is for.

Four causes, none of them individually obvious:

1. **The count badge rendered only on the ACTIVE tab.** Switching moved a ~35px
   element between pills: the old tab lost 35px of width, the new gained 33, so
   every pill after them slid. It was also briefly WRONG — `documents` is not
   cleared while the next collection loads, so it showed the previous collection's
   count as the new tab's. Moved beside the search, always present, "2 records" or
   "1 of 2" when filtered, nothing while loading.
2. **`scale-105` on the active pill, animated by `transition-all`.** A transform
   moves no siblings, but one pill growing while another shrinks is movement
   whatever the layout says.
3. **The active pill had no border** while inactive ones had 1px, so it was 2px
   narrower and everything after it shifted 2px per switch.
4. **Switching sets `loading` true again** (`useAdminDatabase`, on every collection
   change), swapping a table of any height for a fixed `py-16` spinner and back.
   The four states now share a reserved `min-h-[26rem]`.

### Two layout rules worth keeping

**In a right-anchored flex group, only a TRAILING member can be removed for free.**
The Role filter is conditional and must therefore come FIRST, with the
always-present Status last. I "fixed" it the other way round and measured 136px of
slide on every switch away from Users. There is now a test asserting the order,
because the reason is invisible in the markup.

**`overflow-x-auto` SCROLLS rather than resizes when squeezed**, and a scrolled
group looks exactly like its contents jumping. Adding the record count left the
filter group 16px short of its content (`scrollWidth 320` vs `clientWidth 304`) and
that alone reproduced the symptom. Search narrowed to `md:w-64`, group
`md:shrink-0`.

### A measurement error of mine, recorded because it nearly sent the fix the wrong way

I first read the Status filter as jumping 166px. It never moved. Role is
`selects[0]` on Users and Status is `selects[0]` on every other tab, so I had
compared two different controls and "confirmed" a bug that did not exist. Keying
the measurement by label is what corrected it.

After, across all five tabs and back: **0px tab drift, 0px pill width change**, one
distinct Status position (x=880), one distinct results-region position (y=448,
h=416), no overflow. `tests/quality/records-tab-stability.test.ts` pins all four
causes; jsdom computes no Tailwind, so a rendering test cannot see a min-height, a
border width or a transform.

---

## 2026-08-19: the black gaps — `html` was never painted

Deployed, client only. Two reports, one root cause, and the way it was found is the
part to remember.

**Only `body` had a background.** `grep -rn "^html" *.css` returned exactly one
rule — four properties, none of them a background. So anything the body did not
cover fell through to the browser's default canvas, which in dark mode is pure
black:

- pull the page past the top and a black band appears above the app — **mobile and
  desktop**, anywhere the scroll rubber-bands;
- a black strip below the splash screen on a phone.

### The colour was the diagnosis

This app's dark canvas is `rgb(28 24 21)`, a warm near-black. What appeared was
**pure black — a colour `theme.css` does not contain anywhere.** So the app was not
painting it. That ruled out every component in one step and pointed at the only
element with no background rule. Worth reaching for again: when something renders a
colour the theme does not define, stop looking at components.

### Fixes

- **`html` gets `background-color: rgb(var(--canvas))`** — the TOKEN. A hardcoded
  colour here would be the `bg-coffee` trap in another costume: right in one theme,
  wrong in the other, and only visible in overscroll where nobody looks. Flat rather
  than the body's gradient, because it shows only in overscroll and the safe areas,
  where a second gradient would band against the body's.
- **`overscroll-behavior: none`** on html, so the document does not rubber-band at
  all. It also stops an inner scroller — the records table, a dashboard — chaining
  its overscroll to the page.
- **The splash gets `min-height: 100lvh`** plus a dark fallback. `inset-0` is the
  LAYOUT viewport, which on a phone can be shorter than the screen while chrome is
  out. `lvh` is the screen with chrome retracted; where there is no chrome, lvh and
  dvh are the same number. The fallback is a fixed `#1C1815` and deliberately NOT a
  theme token — that screen is dark in both themes, so `--canvas` would put a
  near-white band under a dark photograph in light mode.

### Verified in a browser, not inferred

html computes `rgb(28, 24, 21)` in dark and `rgb(250, 249, 246)` in light,
`overscroll-behavior` is `none` on both axes, and `100lvh` is supported and resolves
to the viewport height. The live stylesheet was then fetched and confirmed to carry
the rule.

`tests/quality/root-background.test.ts` pins all of it. Four breakages caught: the
background removed, the background hardcoded, overscroll dropped, and the splash's
lvh removed with its fallback themed.

---

## 2026-08-19: the splash waits for a tap, and covers the screen by overshooting

Deployed, client only. Two owner requests after seeing the previous attempt on a
phone.

### The tap is back, and that raises the stakes on one handler

The 1800ms auto-dismiss is gone. This **reverses** the Phase 3 change above, which
removed the tap as "one mandatory, meaningless tap before every launch" — so the
reversal is recorded here rather than looking like a regression later.

The consequence is what matters: the tap is now the **only** way out of this screen.
A broken `onClick` would brick the app at launch for everyone — no rider able to
request a ride, no Sarthi able to go on shift — and the screen would look completely
normal while it happened. `tests/components/SplashScreen.test.tsx` therefore proves
the behaviour, not the markup: a click calls `onComplete`, thirty seconds of fake
timers do NOT, and it is still tappable after being left. Confirmed by deleting the
`onClick` on purpose.

### Covering the screen — and the band that was never ours

**The band along the bottom of a phone is the BROWSER'S TOOLBAR, not this app.**
It took three attempts to see that, and the evidence was in the screenshots the
whole time:

1. It **clips the app's own text.** Page content cannot be clipped by something
   painted behind it, so it is drawn OVER the page — which no CSS in this app can
   reach.
2. It **changed colour when `html` got a background** (65da110): black before, the
   app's warm near-black after. Safari and Chrome on iOS tint the toolbar area by
   sampling the page background. Nothing in this app touched the browser's bar; it
   sampled the new colour.
3. It is absent on the dashboard screenshots, where the page had been scrolled —
   which is when the toolbar retracts.

Installing to the home screen removes it. There is no fourth round of viewport units
that will, and the reasoning is recorded in `SplashScreen.tsx` so it is not
rediscovered.

### The real bug in attempt two, which was mine

Sizing the whole screen to `100lvh + env(safe-area-inset-bottom)` pushed
"Tap to continue" off the bottom, because the content is bottom-aligned inside a box
taller than the screen. The next screenshot came back with that line sliced in half.

**Two viewports are in play and they are different sizes**, so one element cannot be
both:

- `svh` is the screen with browser chrome SHOWING — content must sit inside this;
- `lvh` is the screen with chrome retracted — the picture must fill this.

Now split: the content box is `100svh`, and the photograph is its own `aria-hidden`
layer at `calc(100lvh + env(safe-area-inset-bottom, 0px))` behind it, `-z-10` and
`pointer-events-none`. That last part matters because the tap is the only way off
this screen — a decorative div must not be able to swallow it, and a test clicks the
layer to prove it does not.

Measured in `preview/splash.html` at 375x812: tap line fully inside the viewport at
684-712, photo layer reaching the bottom, page not scrollable.

### Two things ruled out before changing anything

- **The image.** A baked-in dark band would have looked identical — and this repo has
  had exactly that bug once, on the app icon. It is 1280x988 **landscape**, so
  `cover` scales it to 1093x844 on a phone and fills. Not the image.
- **`viewport-fit=cover`** is present in `index.html`, so the page is allowed to paint
  into the safe areas. The gap was never a permission problem.

`preview/splash.html` was added to the screen harness for this. It is what turned
the question from argument into measurement.

---

## 2026-08-20: the role-access audit — 16 findings, all fixed and deployed

The owner asked whether the manager → Sarthi → Bhulku hierarchy had flaws, and for
**every** issue in that logic. **The hierarchy itself is sound.** `grantsRole`
expands downward only, nothing implies manager, and self-promotion is properly
blocked — `touchesPrivilegeFields()` covers all six privilege fields, including
`registeredRole` and `activeRole`. Also checked and NOT problems:
`settings/managerCode` is gone (single-use invites replaced it), and `activeRole` is
never trusted as authority anywhere.

The problems were **what a role could reach**, and one domain rule nobody had
written down.

### The one the owner found unaided: a Sarthi could be assigned to drive themselves

`globalAssignDriver` built its pool from every waiting request with no exclusion of
the driver doing the tapping. Switch to Bhulku, ask for a lift, switch back, tap
"Find my next riders" — and be assigned **yourself**. A phantom passenger holding a
real seat in your own car, your own address on the manifest, and a served count
including somebody who was never collected.

Fixed at three levels because one is not enough: `isAssignableTo` excludes the
caller from the pool (shared with `driverDoneForToday`, whose "1 rider still waiting"
would otherwise have been about the driver themselves — the same pair of contradictory
screens that file documents from 2026-08-17); `deriveRiderState` gained `onShift` and
the rider screen says **"You are driving tonight"**; and the rules refuse a ride
create from anyone holding a car, because ride requests are direct client writes with
no callable in between.

### Every Sarthi could read every family's name, phone and home address

`allow list` on rides carried a bare `isDriver()`. `read` is `get` + `list` and allow
rules are **OR'd**, so the scoped `allow read` beneath it could narrow nothing. And
`useDriverDashboard` queried rides with **no driver filter** and sorted them in the
browser, which is the shape of the mistake this arm invited.

**Corrected 2026-08-21:** that hook had **no consumer** — not one, barrel
re-export included — so it was never mounted and never actually shipped anybody's
data. This entry originally said "it was live", and that was wrong. The rules hole
itself needed no help from the hook: the grant was to any approved driver's
credentials, and a hand-written query is one line. The hook has since been
deleted outright.

Both scoped now. The `driverId + status` composite index it needs already existed.

### A Sarthi could forge a ride for any child

`allow create` had a bare `isDriver()` arm above the guarded student one, and OR
short-circuits — so a driver could create a ride for anyone, already marked
`assigned`, with seats out of bounds. **The comment directly above it described that
exact hole**; the fix had been applied to the student arm only. The arm is gone:
nothing needed it, because drivers get work through `globalAssignDriver` on the Admin
SDK.

### Five callables checked who you were and never whether you were allowed

`startRide`, `completeRide`, `releaseAssignment`, `driverDoneForToday`,
`studentReadyToLeave` — ownership only. A revoked account kept full control of ride
state for as long as its name sat on a document. `sarthiArrived` had already named
the gap in a comment. All five now assert before any document read, which also closes
two existence oracles ('not found' vs 'permission-denied' over arbitrary uids).
Adds `assertApprovedStudent`, which had never existed.

### The rest

- **A Sarthi could take a car another Sarthi was driving** — unconditional vehicle
  update, and `assignVehicleToDriver` wrote the document with no holder check. The
  callable guards it; that path never reached it.
- **No way to take a request back** — the rules had always allowed `cancelled`; no
  control was ever built. Now there is one, and the rule is *tightened* to
  `requested`-only so nobody vanishes from a moving car's manifest.
- **`allow write` where delete should be denied** on settings, statistics and
  attendance responses. A manager could have deleted `settings/main`.
- **A manager could lock the congregation out** — `adminDeleteUser` had no
  self-delete and no manager-protects-manager guard, and manager creation requires
  being a manager.
- **The `notifications` collection was dead and carried a live hole** — its update
  rule gated on the existing document, so its owner could reassign `userId` and
  forge a message into another inbox. Closed.
- **Six copies of the role hierarchy with nothing holding them together** — now
  `tests/quality/role-table-parity.test.ts`.
- **A demoted manager kept the manager UI** until reload, with the switcher hidden so
  there was no way out. `resolveActiveRole` re-validates every snapshot.
- **`roles[]` meant two different things** — signup wrote the recorded role, the
  invite path the granted set, and the driver picker queries that field.
- **A revocation left no trace** — `account.approved` / `account.rejected` now
  written, actor required.

### Stated plainly, and NOT half-fixed

Rejecting a manager still does not clear their `mgr` custom claim, because a client
cannot. `isManagerForRead()` honours it for up to an hour, so a just-revoked manager
keeps READ access to rider lists for that long; every write, delete and secret read
is on `isManager()`, which re-reads the document and cuts them off at once.
`node scripts/mint-manager-claims.cjs` is the remedy today. **A callable that does it
automatically is the real fix and is deliberately not done.**

### Deployment order was changed on purpose

`functions → hosting → rules`, not the standing rules-first. The rules change and the
client change are **coupled**: the new list rule refuses the unscoped query the
live bundle was making, so rules-first would have broken every Sarthi's dashboard
until they reloaded — and the service worker caches hard. Owner's call, taken with
the trade stated: a few more minutes of a months-old read exposure against breaking
dispatch.

### Verification

**1820 tests** — 1032 client, 637 functions, 151 rules. Typecheck 0, both builds
clean. Every new test was observed RED before its fix; deliberate breakages caught
the self-exclusion (5), a removed role guard (6), a drifted role table (3), the
stale hat (3) and the missing audit row (4).

The **live** ruleset was then read back through the Firebase Rules API and all seven
properties confirmed present — a compile success only proves some ruleset shipped.

**Cannot be verified from here:** that a real Sarthi on a real phone sees "You are
driving tonight" instead of the request button, and that the withdraw button works
end to end. That needs the owner's account on a sabha evening.

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

## Notifications are BACK IN SCOPE (2026-08-18)

**This reverses the 2026-08-17 decision below.** The owner explicitly reopened
push, including the manager-broadcast half that had been dropped. The old section
is kept underneath because its measurements are still the record of why push
never worked — but "do not re-raise it" no longer applies.

One correction to it: **the VAPID key was never the blocker.** The FCM SDK has a
`DEFAULT_VAPID_KEY` fallback, so an absent key degrades rather than throwing. The
real blocker was that `/firebase-messaging-sw.js` did not exist, and the SPA
rewrite served `index.html` for it — service worker registration fails on MIME
type, so `getToken` could never have succeeded.

### Landed so far — delivery is POSSIBLE, not yet HAPPENING

- Both rival client modules deleted. `src/utils/push.ts` is the pure decision
  layer (17 tests, no imports), `src/utils/pushClient.ts` the Firebase edge.
- `public/firebase-messaging-sw.js`, registered at
  `/firebase-cloud-messaging-push-scope` — a **different scope from the Workbox
  worker**, which is what stops it becoming the page controller and tripping
  `UpdateBanner`'s reload-on-`controllerchange`.
- `globIgnores` keeps it out of the Workbox precache; a `firebase.json` header
  entry stops it inheriting `max-age=3600`.
- **`fcmToken` (one string) → `fcmTokens` (a map).** The old shape was
  last-device-wins: enable on a phone, later open a laptop, phone goes quiet
  silently. Done now because zero tokens exist, so the migration is free.
- **Dead-token pruning.** `sendEachForMulticast` does not throw on partial
  failure — it returns a `responses[]` array that the old code discarded. That
  was the only signal a token had died. Now pruned, and deliberately NOT on
  transient errors: pruning during an FCM outage would silently unsubscribe the
  congregation.
- **Notification copy rewritten for lock screens.** It named the Sarthi and
  described their car, announced the child's destination, and announced arrival
  home. A push is read off a lock screen by whoever holds the phone, and the
  phone may belong to a child.
- **A rename gap closed:** `vocabulary.test.ts` never scanned `functions/`, so
  "assigned N students" was still in the copy that reaches a lock screen.

### Step 2 landed: there is now a way to turn it on

The VAPID key is configured (`.env.local`, gitignored — it is a PUBLIC key, so
shipping it in the bundle is correct). `hooks/usePush.ts` and
`components/shared/PushToggle.tsx` sit in Profile beside the theme and install
controls.

**The reachability check that matters:** before the UI existed, the VAPID key
appeared **0 times** in the built bundle — the client half was tree-shaken out,
exactly as it had been for the whole life of the app. It now appears, along with
the FCM scope and the toggle's copy. That is the difference between wired and
merely written.

"On" means THIS device holds a token the user's document still lists — not that
permission was granted. A granted permission with no token is a failed
registration, and calling that "on" would be a dead control.

The toggle renders null ONLY for `unsupported`. For `blocked` it explains how to
undo it, because the user can fix that — just not here — and Profile is where
they will look. An invisible control is the same family of defect as a dead one.

### DELIVERY CONFIRMED on a real iPhone, 2026-08-19

Three notifications landed on a locked iPhone: *Sarthi assigned*, *Sarthi on the
way*, *Ride complete*. **This is the first time push has ever delivered in this
app.** The privacy rewrite is visible in the result — no child's name, no
address, no destination on the lock screen, and "Ride complete" rather than the
old "Home Safe!".

### Step 3 landed: people are now asked

`components/shared/PushPrompt.tsx`, shown under the rider's assignment card and
on the Sarthi's dashboard — at the moment the value is obvious, not at signup.
Asking before the app has been any use is how a permission gets refused
permanently.

It is a PRE-prompt, and that is the design. The OS dialog is one-shot: on iOS a
refusal is only undoable in Settings. So the real dialog is raised only for
someone who already said yes to a reversible question. `shouldOfferPush` returns
false for `blocked`, `needs-install`, `on` and `unsupported`, caps at **two**
refusals, and waits a **week** between them.

Not inside `AssignmentPreview`: that screen is an accept-or-decline decision and
interrupting it with a permission ask is the worst possible timing.

One consequence worth knowing: `RiderHome` now renders a component that reads
`useAuth`, so its tests mock `AuthContext` the way `Layout.test.tsx` does.

### Step 4 landed: "I have arrived"

`functions/src/http/sarthiArrived.ts`, plus a button in `ActiveRide` above
Complete. The `arriving` status is finally written by something.

**Two traps, both now covered by tests named for them:**

1. **Only `ride.studentId` is told — never `ride.students`.**
   `globalAssignDriver` copies the ENTIRE car's roster onto every one of that
   car's ride documents, so iterating `students` here would tell all four riders
   the Sarthi is outside their house, and three would walk out to an empty
   street. `tells only this stop's rider` fails if anyone reintroduces
   `startRide`'s loop.
2. **`in_progress → arriving`, never before the start.** `startRide` refuses
   anything not `assigned` and fans out over that same query, so an earlier
   placement would make Start refuse outright and silently skip the one flipped
   document in a grouped car. `refuses a ride that has not started` covers it.

Idempotent on **`arrivedAt`, not status** — `completeRide` moves the document off
`arriving`, so a status guard would let a tap after completion re-announce.

Needed no edits anywhere else: `completeRide`, `driverDoneForToday`,
`managerReleaseVehicle` and `releaseIdleVehicles` all already listed `arriving`
among their active statuses. `driver_en_route` stays unwritten — deleting it
would fail `vocabulary.test.ts`, which pins it as stored vocabulary.

### Step 5 landed: manager broadcasts, and foreground messages

**Foreground.** `components/PushMessages.tsx` subscribes to `onMessage` and
routes to a toast. FCM suppresses the system notification while the tab is
focused, so a Sarthi looking at the route screen was previously never told a new
assignment had landed — the message was delivered and dropped. It returns the
unsubscriber, because StrictMode double-invokes effects and every toast would
otherwise appear twice.

**Broadcasts.** `managerBroadcast` plus a composer in Setup. The manager supplies
the BODY only; the title is fixed. A free-text title would let a broadcast
impersonate a system push — "Sarthi has arrived", to everyone.

Two limits, because one is not enough:

- per-manager via `checkRateLimit`, the house pattern;
- a **congregation-wide floor** in `system/broadcastState` — 10 minutes apart,
  5 a day — reserved in a transaction BEFORE anything is sent. `checkRateLimit`
  is keyed per user and fails open by design, so two managers each comfortably
  inside their own budget still double the noise. A per-user limiter
  structurally cannot see that.

Every send writes an audit row **pending first, closed after**, so a broadcast
that dies mid-fan-out still leaves evidence it was attempted.

### Two tests that looked right and were not

Worth recording, because the breakage check is the only reason they were caught:

- `sends the manager's words to everyone` asserted the title was fixed — but
  never SUPPLIED a title, so it proved nothing about impersonation.
- `leaves a failed row when the send throws` did not prove pending-first
  ordering, because the catch block writes a row either way.

Both are now real: one passes a title and asserts it is ignored, the other
records call order and asserts `['audit', 'send']`.

### Push is complete

All five steps are in. What remains is optional: FCM topics instead of the
whole-collection scan (only needed at multi-city), and an in-app notification
history — the `notifications` collection has rules but nothing reads or writes
it.

**So push can now be turned on, but nobody has been asked to.**

Released 2026-08-18 (functions then hosting). **The original blocker is gone:**
`GET /firebase-messaging-sw.js` now returns `text/javascript` with
`no-cache` — it returned `200 text/html` via the SPA rewrite before, which is
why service worker registration failed and `getToken` could never have
succeeded.

---

## Notifications were OUT OF SCOPE (superseded, kept for its measurements)

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
  instead of replacing the dashboard. The splash screen stopped demanding a tap —
  **reversed on 2026-08-19 at the owner's request; it waits for one again.**

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

### ~~Known blank-screen branches~~ ✅ FIXED, verified 2026-08-21

`DriverDashboard`'s three `return null` branches — `preview` without
`pendingAssignment`, `active` without `activeRide`, `completed` without stats —
each rendered a **blank page with no way back**, because ActiveRide puts the app
in focus mode and hides every navigation control. Flagged three times across
sessions and deferred each time; this entry described it as the oldest
outstanding defect long after it had been closed.

It is fixed. No `return null` remains on a render path, and
`tests/components/DriverDashboard.test.tsx` drives the reachable branch (the ride
window closing mid-read) end to end through the real subscription rather than by
poking state. The entry stays as a record of how long a fixed bug can sit in a
handover note claiming to be open.

### ~~Duplicate release paths~~ ✅ CLOSED, verified 2026-08-21

Client-side `releaseVehicle` used to serve two callers that wanted different
things: a manager hard-releasing another driver, and a driver swapping cars. It
did the second one active harm — it set `status: 'offline'` and zeroed
`ridesCompletedToday`, `totalStudentsToday` and `totalDistanceToday`, and nothing
restored them, so a volunteer who changed cars mid-evening silently lost their
whole day's tally and so did the manager's board.

Now split. The manager path goes through the `managerReleaseVehicle` callable,
which checks the role, writes an audit row and refuses while riders are aboard.
The swap path is `handBackVehicle(vehicleId)`, which touches the **vehicle only**
— both halves of the `vehicles`/`cars` mirror — because `assignVehicleToDriver`
overwrites the user document immediately afterwards anyway.

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

- ✅ **Resolved 2026-08-21 — rides are open, and the schedule is real.** This
  entry read "RIDES ARE CLOSED RIGHT NOW". Two corrections to how it was
  diagnosed, both worth keeping:

  **There was never a missing recurrence rule.** It lives at
  `settings/sabhaRecurrence`, not on `settings/main` — the first check looked in
  the wrong document and concluded "no standing schedule". The rule existed and
  was enabled, and being a rule with no horizon it cannot run dry.

  **What closed rides was 17 cancellations**, one per Friday from 28 August to
  18 December, all written within 40 seconds on 2026-08-19 during time-shift
  testing. Under the rule model a document IS an exception, so those masked the
  rule for four months. Cleared, narrowly — override, cancelled, and dated today
  or later only — with one audit row naming the dates.

  **The schedule is now every Friday 20:30–22:00**, given by the owner. The
  fallback times on `settings/main` were moved off `04:00–04:30` at the same
  time: those stand in for a gathering with no times of its own, so any such date
  would have opened a ride window at four in the morning.

- **Production is small.** Counted at the end of 2026-08-21: **4 users, 6 rides,
  3 vehicles, 1 events document, 1 statistics document, 0 notices, 0 feedback,
  109 audit rows.** The 11-rider evening from 2026-08-14 is no longer in the
  database. Worth knowing before reading any claim in this file as "proven at
  scale" — the scale is four people.

  Two of those numbers moved during the day and are worth reading as signals.
  `rides` went 2 → 6, so somebody has been exercising the app rather than only
  reading it. `events` went 18 → 1 because 17 of them were the stale cancellations
  cleared that afternoon; the one left is the past 2026-08-19 one-off, and every
  future Friday now comes from the rule rather than from a document.
- **Test events are still in the calendar.** Several past entries are time-shift
  test sabhas from the 7th–14th. Harmless; worth deleting.
- **Sabha Calendar is now viewable in the harness** — `preview/manager.html`
  renders it against stubbed Firestore, so the card, its chips and both themes can
  be looked at without a sign-in. That needed a `firebase/firestore` stub, which
  the harness had never had: hook stubs covered the hooks, but RecurringSabha
  holds its own listener and threw before anything rendered. Any component with a
  direct listener can be previewed now.

- **Two UI surfaces have never been seen rendered** — covered by tests and
  confirmed present in the live bundle, but nobody has looked at them in a browser,
  because reaching them needs a sign-in. Rider → *Request Pickup* (seat stepper,
  "Keep us in one car", and the "no sabha on the calendar" line); Manager →
  **Request Center** (Seats column). Note that is Request Center, *not* Live
  Operations.

  The list was longer. Sabha Calendar, Reports and **Profile** were all added to
  `preview/` during 2026-08-21 and are now viewable without signing in — which is
  how the two-clock-format bug and the missing feedback control were found. The
  route for the remaining two is the same: add the component to a `preview/*.tsx`
  entry and stub only the Firestore boundary. Anything holding its own listener
  works now that the harness has a `firebase/firestore` stub.

**Known gap — fixed 2026-08-12 in Phase 5.** Bulk-select on the manager's queue
used to exist only in the desktop table, leaving the checkboxes and "Assign Bulk"
unreachable on a phone. A long-press on a card now starts a selection.

---

## What comes next

The roadmap is [`roadmap.md`](roadmap.md); §10 records the four production
defects Phase 1 found by measuring rather than reading. Candidates, none started:

| | Phase | Why / why not |
|---|---|---|
| ~~Blank-screen branches~~ ✅ | ~~`DriverDashboard`'s three `return null` paths~~ | **Done.** Verified 2026-08-21; no `return null` remains on a render path. |
| **Phase 3 part 2** | Named passengers — dependents and guests | **Unblocked 2026-08-21.** The consent question is settled — see *Settled policy* below. No guardian field, no consent record, no separate account: the adult who books is responsible for everyone in the car. |
| **Phase 2** | Cities and locations; scope every query by `cityId` | **Deferred by the owner, reaffirmed 2026-08-21** — "keep the deferred expansion as deferred, I will get back to it later". Do not start it and do not re-raise it. The gate it was waiting on has since **passed**: `node scripts/tenancy.cjs verify` reads zero unstamped, checked 2026-08-21. So when the owner does return to it, the blocker is groundwork, not data. |
| **Phase 4** | Move dispatch to the server | **Half done, and the half that mattered.** Corrected 2026-08-21 — this row read "✅ Done" while `roadmap.md` still listed Phase 4 as pending, and the roadmap was closer. See below. |

**What "Phase 4" actually is now.** The hazard is closed: `useAutoDispatch` — the
hook that ran in every manager's browser and described itself as "the Server
logic" — is disabled, and assignment goes through `globalAssignDriver`, which is
server-side and serialised by `system/assignmentLock`. Two managers can no longer
assign the same riders.

But that is **driver-pull**: the Sarthi taps "Assign Me" and the function does the
work. The *push* auto-dispatch Phase 4 describes does not exist, and never
really did — the old browser hook threw a `ReferenceError` on the first matched
driver, the throw was swallowed, and the `finally` block logged "Processing
complete", so it read as success while assigning nothing. Nothing needs push
dispatch today. It becomes real work only when a second location exists, because
a client-side dispatcher replicated across cities would double-assign riders.

### Built, shipped, and removed again — reorderable sidebar tabs

**Do not rebuild this without reading the whole entry.** Shipped 2026-08-21,
reverted the same day at the owner's instruction. `git show 6c6fc1f 4415b64` has
the implementation if it is ever wanted.

The ask was to make the sidebar tabs draggable so a manager could prioritise
their own order. It worked on a desktop — the owner's saved order was
`home, people, setup, fleet, notices, history, profile, records`, which is how we
know the desktop half genuinely worked. Then:

**It did nothing on a phone, for two reasons, and the smaller one was the drag.**

1. **The sidebar does not exist below `lg`.** `hidden lg:flex`, so under 1024px
   it never renders and every handle lived on it. Measured in a browser at phone
   width: eight handles in the DOM, all zero pixels wide. Nothing to touch.
2. **HTML5 drag-and-drop is mouse-only.** `dragstart` is never produced from a
   finger on iOS Safari or Android Chrome. The first implementation used it, so
   it worked on a laptop and did nothing at all on a phone — no error, nothing
   to notice. That is the silent-failure class this repo keeps deleting, shipped
   by the very work that keeps deleting it.

The second was then fixed properly with pointer events (mouse, touch and pen in
one path), handles were added to the mobile drawer so a phone had a surface at
all, and it was verified with a simulated finger. The owner's call after that was
to remove the feature rather than carry it.

**What the revert did:** `git revert` of both commits, so `components/Layout.tsx`,
`firestore.rules`, `types.ts` and the rules test are byte-identical to `ddc4133`.
`src/utils/navOrder.ts`, `hooks/useReorderDrag.ts` and four test files are gone.
Test counts returned exactly to 1093 client / 157 rules, which is the check that
the revert was clean. One `navOrder` field left on the owner's user document was
deleted from production — nothing read it any more, and it sat on a document read
on every page load.

**Kept deliberately, because it is not part of the feature:** the preview
harness's `firebase/firestore` stub and its live user profile. Those are what let
`preview/shell.html` and `preview/manager.html` render at all, and they make a
preview able to tell working code from broken. Removing them would regress the
harness for every screen.

**If it is ever revisited**, the two things that decide the design: a phone has no
sidebar, so the mobile surface is the drawer or nothing; and the reorder must use
pointer events, never drag events.

### Settled policy — do not re-raise either of these

**A guest child is never unaccompanied.** Ruled by the owner 2026-08-21: a child
is always accompanied by their parent, guardian or an adult, that adult carries
the responsibility, and everyone in the congregation understands this. So the
question this file used to carry — *can a guest be a minor, and whose consent
covers them* — has no content. Accompaniment is the standing condition.

The practical consequence is that **naming passengers got smaller, not bigger**:
no consent record, no guardian field, no shadow account for a child. The person
who books the ride is the responsible adult for everybody in the car, which is
already how the seat count behaves, so the passenger model extends today's shape
rather than introducing a new one. Recorded as A10 in `roadmap.md` §8.

**Driver vetting is out of scope — permanently.** This used to be flagged here as
an open policy question. The owner ruled on it on 2026-08-15: drivers are known
volunteers within the congregation, the trust model is social and sits outside
the app, and it is not to be raised again. This does not weaken anything else —
`assertApprovedDriver`, `assertApprovedManager`, the Firestore rules and the
audit rows all stand, because those protect children's PII rather than vet the
volunteer.

**~~Still open~~ ✅ FIXED, and confirmed against production 2026-08-21.**
`at_sabha` was never cleared: `completeRide` set it on a completed pickup and
`studentReadyToLeave` read it, and nothing reset it — so five riders sat at
`at_sabha` from the 14th onwards and could have tapped "Ready to leave" the
following Friday without ever having been collected, sending a driver to a house.

The fix went where this entry predicted, into `expireStaleRequests`, which
already walks exactly these riders. `END_OF_EVENING_STATUSES = ['at_sabha',
'in_ride']` are swept at the end of the evening, and the status field is
**removed** rather than set to something new — signup writes no status at all, so
absent is already what a rider with nothing going on looks like. `home_safe` is
deliberately not swept: it is terminal and true, and resetting it would erase the
only record that an evening finished properly.

Verified in production, not just in tests: **zero** users are sitting at
`at_sabha` or `in_ride` as of 2026-08-21.

---

## Before starting

Read [`../CLAUDE.md`](../CLAUDE.md) — conventions, the verification sweep, deploy
order, and what a phone session cannot do.

The short version of that last part: **from the Claude mobile app you can read,
edit, test, build, commit and push — you cannot deploy, and you cannot see
production data.** Deploys happen from the owner's Mac, in the order
`firestore:rules → storage → functions → hosting`, then fast-forward `main`.
That order is encoded in `npm run deploy:prod`, so it no longer depends on
remembering it — `deploy:rules` now includes the `storage` target.

**Testing without waiting for Friday.** [`plans/testing-plan.md`](plans/testing-plan.md)
§4 has the method: edit the sabha's times in **Setup → Sabha Calendar** (not
Setup → Location & Times, which only sets defaults for new events and silently
does nothing to a scheduled one — tracked as a defect). Notifications fire only
on a *transition into* a ride type, so pickup testing inside the normal two-day
window alerts nobody; drop-off always alerts everyone.
