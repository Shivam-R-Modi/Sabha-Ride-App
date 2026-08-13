# Environment

One Firebase project. There is no staging.

| | Production |
|---|---|
| Project ID | `sabha-ride-app` |
| Alias | `prod` (also `default`) |
| Env file | `.env.local` |
| Build | `npm run build` |
| Deploy | `npm run deploy:prod` |
| Firestore region | `nam5` |
| Real user data | Yes, real families |

`.env.local` is gitignored. The Firebase web config is not secret — it ships in
the bundle regardless — but keeping the file out of git means the repo never
carries credentials.

## Why there is no staging

A `sabha-ride-app-staging` project was created in August 2026 and never
finished. It got a Firestore database and one hosting deploy, but **no Cloud
Functions were ever deployed to it** — the Blaze plan was never enabled.

That made it worse than useless. Every meaningful action in this app runs
through a Cloud Function: creating a ride, assigning a driver, seeding the
calendar, opening the ride window. A front-end with no functions behind it
cannot exercise any of them. Anything that "passed" on staging would have
proved nothing, which is the most dangerous kind of test environment.

It was removed on 2026-08-13. Nothing was migrated because nothing existed to
migrate.

**If staging is ever rebuilt, it needs the Blaze plan and a functions deploy on
day one, or it should not be built at all.**

## What guards production instead

Staging was meant to catch the mistake where a bad deploy takes the app down
for real people on a Friday night. That has happened — one deploy shipped a
bundle with `apiKey: undefined` and everyone got a blank page until it was
diagnosed. Three things now stand in for it:

1. **`vite.config.ts` fails the build** when Firebase env vars are missing.
   That is the specific `apiKey: undefined` class of failure, closed off.
2. **The verification sweep** in `CLAUDE.md` — 743 tests across client,
   functions and Firestore rules, plus a build and a typecheck. Run it in full
   before every deploy. Do not substitute a shorter subset.
3. **`preview/`** renders the real rider, driver and manager screens against
   stubbed data, with no sign-in. Use it to look at a change before shipping it.
   Two screens in this app went months without anyone seeing them rendered,
   because reaching them required signing in as the right role at the right
   time of week.

None of this covers a Firestore rules mistake as well as a second project
would. When changing `firestore.rules`, lean on `npm run test:rules` — 81 cases
against the emulator — and read the diff twice.

## Regenerating the env file

Config values come from the project itself, so there is nothing to copy by
hand:

```bash
firebase apps:list WEB --project prod
```

```bash
firebase apps:sdkconfig WEB <appId> --project prod
```

Map the values to `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`,
`_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`.

## Deploy

Order is always **rules → functions → hosting**. `npm run deploy:prod` builds
and then runs the three in that order:

```bash
npm run deploy:prod
```

The order is not cosmetic. Old client plus new rules degrades to a clean
permission error. New client plus old rules **silently bypasses server-side
guards** — the failure mode is invisible, which is exactly the one this app
cannot afford.

Deploy a single part when that is all that changed:

```bash
npm run deploy:rules
```

```bash
npm run deploy:functions
```

```bash
npm run deploy:hosting
```

`firebase.json` has a `predeploy` hook that builds `functions/` before shipping
it, so stale compiled output in `functions/lib` is no longer a footgun.

After deploying, fast-forward `main` so it matches what is live.

## Verifying a hosting deploy

Match the live bundle filename against your local `dist/assets/index-*.js`:

```bash
curl -s https://sabha-ride-app.web.app | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

The service worker caches hard. Unregister it and clear caches first, or you
will confirm the previous build and think the deploy worked.

## Production safety settings

Both of these were disabled last time the database configuration was read.
Neither is enabled by deploying — they are one-time account actions.

- **Delete protection.** Free, and it prevents anyone accidentally deleting the
  database holding every ride and member record:

  ```bash
  firebase firestore:databases:update "(default)" --delete-protection ENABLED --project prod
  ```

- **Point-in-time recovery.** Gives a 7-day recovery window for a bad write or
  a faulty migration. It has a cost. Worth it before any data migration.
