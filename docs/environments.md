# Environments

Two Firebase projects. **Nothing reaches production without going through
staging first.**

| | Staging | Production |
|---|---|---|
| Project ID | `sabha-ride-app-staging` | `sabha-ride-app` |
| Alias | `staging` | `prod` (also `default`) |
| Env file | `.env.staging` | `.env.local` |
| Build | `npm run build:staging` | `npm run build` |
| Deploy | `npm run deploy:staging` | `npm run deploy:prod` |
| Firestore region | `nam5` (to match prod) | `nam5` |
| Real user data | **No — test data only** | Yes, real families |

Both env files are gitignored. Firebase web config is not secret (it ships in
the bundle regardless), but keeping the files out of git stops anyone
accidentally building one environment with the other's credentials.

## Why staging exists

Production has been deployed directly, more than once, with real users
depending on it for rides on Friday nights. One of those deploys shipped a
bundle with `apiKey: undefined` and the app rendered a blank page for everyone
until it was diagnosed. `vite.config.ts` now fails the build when Firebase env
vars are missing, but a build guard only catches one class of mistake.

Staging catches the rest. It matters most for the multi-location work, where a
mistake in the security rules would not be a blank page — it would be one
city's manager able to read another city's families.

## Regenerating an env file

Config values come from the project itself, so there is nothing to copy by
hand:

```bash
firebase apps:list WEB --project staging          # find the app ID
firebase apps:sdkconfig WEB <appId> --project staging
```

Map the values to `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`,
`_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`.

## Deploy flow

```bash
npm run deploy:staging     # build with staging config, deploy to staging
# ... verify in staging ...
npm run deploy:prod        # only after staging looks right
```

Deploy a single part when that is all that changed:

```bash
firebase deploy --only hosting            --project staging
firebase deploy --only firestore:rules    --project staging
firebase deploy --only functions          --project staging
```

**`firebase.json` has no `predeploy` hook for functions**, so Firebase ships
`functions/lib` exactly as it is on disk. Always run `npm run build` inside
`functions/` first, or you will deploy stale compiled output. Worth adding a
predeploy hook to remove the footgun.

## Staging setup — remaining steps

Done already:

- [x] Project created (`sabha-ride-app-staging`)
- [x] Web app registered, config pulled into `.env.staging`
- [x] `.firebaserc` aliases: `staging`, `prod`, `default`
- [x] `build:staging` / `deploy:staging` / `deploy:prod` scripts
- [x] Verified a staging build bakes in `projectId: sabha-ride-app-staging`
      and a production build bakes in `sabha-ride-app`

Needs the console or a billing decision — **cannot be done from the CLI**:

- [ ] **Create the Firestore database.** Console → Firestore Database →
      Create database → **Multi-region `nam5`** → Production mode. This also
      enables the Firestore API, which is currently off and blocks the CLI.
      The region is permanent, so it must be `nam5` to match production.
- [ ] **Enable the Blaze plan.** Cloud Functions cannot deploy on Spark. This
      is a billing commitment and is the owner's to make. Staging traffic is
      tiny, but set a budget alert regardless.
- [ ] **Enable Auth providers**: Email/Password and Google. Console →
      Authentication → Sign-in method.
- [ ] **Add authorized domains** for Google sign-in: the staging hosting domain
      and `localhost`.
- [ ] **A separate Google Maps API key** for staging, restricted to the staging
      domain. Do not reuse the production key — it is referrer-restricted and
      would either fail or widen production's restrictions.

Then, from the CLI:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project staging
npm run deploy:staging
```

## Seed data

Staging must never hold real member data — that would create a second copy of
families' and children's records, with a second retention and deletion
obligation, in an environment with weaker access discipline.

Use synthetic data only. A seed script belongs with the Phase 1 work, alongside
the `cityId` backfill, so both are exercised against the same fixtures.

## Two recommendations for production

Noticed while reading the production database configuration:

- **Delete protection is DISABLED.** Enabling it is free and prevents anyone
  accidentally deleting the database that holds every ride and member record:
  ```bash
  firebase firestore:databases:update "(default)" --delete-protection ENABLED --project prod
  ```
- **Point-in-time recovery is DISABLED.** PITR gives a 7-day recovery window
  for a bad write or a faulty migration. It has a cost, but the multi-location
  migration is exactly the kind of work it exists for. Worth enabling before
  Phase 1 and reviewing after.
