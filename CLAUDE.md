# Sabha Ride App — agent instructions

Two parts: the **ponytail** ruleset (vendored, verbatim), then the **project
conventions that take precedence over it**. Read the second part; it exists
because one rule in the first part conflicts with how this repo is built.

Ponytail is vendored at tag `v4.9.0`, licence and provenance in
`.claude/skills/PONYTAIL-LICENSE`. Intensity: **full**. This file and
`.claude/skills/` are committed (`0406ab8`) so that a session started from the
phone gets a fresh clone that already knows the conventions.

---

# Ponytail, lazy senior dev mode

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.

(Yes, this file also applies to agents working on the ponytail repo itself. Especially to them.)

---

# Project conventions — these win

Ponytail's own rule is "anything explicitly requested" is never simplified away.
The following is that standing request. It is written down because the next
session reads the ladder above with no counterweight otherwise.

## Tests are the standing ask

Ponytail says "no frameworks, no fixtures... trivial one-liners need no test."
**That does not apply here.** This repo runs **2,003 tests** — 1,152 client,
681 in `functions/`, 170 Firestore rules — and the convention is that every fixed defect
leaves a named test that fails if the defect returns. Those tests have caught real
bugs, including ones written in this repo by an agent: a seed function that could
never run once a slot was cancelled, and a manager check that let a revoked
manager keep exporting every family's name, phone and address.

So: keep using vitest, keep using `@firebase/rules-unit-testing`, keep adding
cases to the existing suites. Writing one throwaway assert instead is a regression
in this codebase, not laziness.

## This app carries children's personal data

Riders are members of a congregation, including minors, and records hold names,
phone numbers and home addresses. Never simplify away a Firestore rule, an
`assertApprovedManager` call, an audit row, or a validation at a trust boundary.
When in doubt on a security question, the wordier version wins.

## The failure mode to design against

The recurring bug class here is **code that looks wired up and silently does
nothing** — a dead button, a query that returns an empty list instead of erroring,
a guard whose failure mode is "quietly allow". Several releases have been spent
removing it. Prefer a loud failure to a silent one, and never leave a control
visible that cannot work.

## Verification sweep

Run before any deploy. Do not substitute a shorter subset.

```
npx vitest run           # client. NOT `npm test` at the root — that is watch mode and hangs
npm test --prefix functions
npm run test:rules       # starts its own emulator
npm run build
npm run typecheck        # must be zero errors. The 22 pre-existing errors this note
                         # used to allow were all cleared on 2026-08-21 — a
                         # non-zero count now means something you touched
```

`npm run lint` is configured but has no ESLint config file, so it always errors
and checks nothing. Ignore it; do not "fix" it by deleting the script.

## Deploy

Order is always **`firestore:rules` → `functions` → `hosting`**, then
fast-forward `main` so it matches production. Old client + new rules degrades to a
clean permission error; new client + old rules silently bypasses server-side
guards.

Verify a hosting deploy by matching the live bundle filename against
`dist/assets/index-*.js` — the service worker caches hard, so unregister it and
clear caches first or you will confirm the previous build.

## Housekeeping

- `npm install` / `npm uninstall` need `--legacy-peer-deps` (`vite-plugin-pwa`
  declares a Vite 5 peer range; this project runs Vite 6).
- Admin SDK keys are gitignored and must stay that way.
- `window.confirm` is banned — it silently returned false and made every
  destructive button inert. Use `components/shared/useConfirm.tsx`.

## Working from the Claude mobile app

Sessions started from the phone run in a **cloud sandbox with a fresh clone and
no credentials**. That changes what is honest to attempt.

**Cannot be done there. Do not try, and do not claim to have done it:**

- **Deploying anything.** No Firebase CLI login exists in the sandbox, so
  `firebase deploy` will fail or, worse, act on the wrong project. Rules,
  functions and hosting are released from the owner's Mac only.
- **Reading or writing production data.** The Admin SDK key is gitignored and is
  not in the clone, so `scripts/*.cjs` (tenancy, backfills, mint-claims) cannot
  run. Any claim about what production currently contains is a guess unless it
  came from an actual query.
- **`npm run test:rules`.** It boots the Firestore emulator, which needs Java.
  Assume it is unavailable and say so rather than reporting the suite as passing.

**Works normally:** reading code, editing, `npx vitest run`,
`npm test --prefix functions`, `npm run build`, `npm run typecheck`, committing,
pushing, opening pull requests.

So the split is: **write and test on the phone, deploy from the Mac.** End a
mobile session by pushing a branch and saying plainly that it is unverified
against production and undeployed. `docs/STATUS.md` is the handover note between
the two — read it at the start of a session and update it at the end.
