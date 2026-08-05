# Ownership, root of trust & handover — draft

> **DRAFT.** See [README](README.md). The governance choices here need
> confirming by whoever will own the service after handover.

## 1. The problem

Super-managers can create locations, appoint managers, and reach every family's
data nationwide. Someone has to be the first one, and super-managers cannot
appoint the first super-manager. That circularity has to be broken outside the
application.

## 2. Root of trust

**The trust is rooted in control of the Firebase project, not in the app.**

Whoever holds the project's Owner IAM role can already read and rewrite the
entire database with the Admin SDK. There is no security boundary above that,
so pretending the application can create one is theatre. The honest design is
to acknowledge it, keep the set of project owners small and deliberate, and
make every use of that power leave a trace.

**Today:** the project owner is the developer building the service. That is
appropriate during construction and must not survive handover.

## 3. Genesis

The first super-manager is created by a one-off Admin SDK script, runnable only
by a project owner:

1. Run against the target project with an explicit uid and a reason.
2. Sets the `sm` custom claim and writes a `superManager.granted` audit entry
   marked `genesis: true`.
3. Refuses to run if a super-manager already exists — genesis happens once.
4. The script lives in `scripts/`, is never callable from the app, and is not
   part of any deploy.

## 4. Appointment thereafter

| Rule | Why |
|---|---|
| **Appointment is by invitation, and must be accepted** | Produces a two-sided record and consent, rather than a silent grant |
| **Two-person rule above a threshold** — one super-manager proposes, a different one approves | A single compromised account cannot mint admins. Below 3 super-managers, fall back to single approval or you deadlock |
| **No self-elevation, no self-approval** | Enforced server-side, not in the UI |
| **Floor of two super-managers** — the last one cannot be removed | Lockout is the most common self-inflicted outage in this design |
| **MFA mandatory** for super-managers | An account that can read every family's address nationwide should not rest on a password. Firebase Auth supports TOTP |
| **Re-authentication for privileged actions** | Limits damage from an unattended session |
| **Every grant, revocation and impersonation audited** | Written by Cloud Functions only; clients cannot write audit entries |

Managers are appointed by super-managers, scoped to named locations, using
**per-location, single-use, expiring invites**.

> **Replace the shared manager code.** `settings/managerCode` is currently one
> static code for the entire platform: anyone who learns it can become a
> manager anywhere. This is acceptable for a single congregation and
> indefensible nationally. It should be removed as part of Phase 1.

## 5. Break-glass

If every super-manager is locked out, recovery is via the Admin SDK by a
project owner. Write the runbook **before** it is needed:

- Who may invoke it, and who must be told afterwards.
- The exact script and how it is audited.
- How the resulting grant is reviewed after the fact.

An unaudited emergency path becomes the normal path. It should be
uncomfortable to use and impossible to hide.

## 6. Handover runbook — developer to client

This is the highest-risk operational moment in the project's life. Sequence
matters; do not improvise it.

**Before handover**

- [ ] Client organisation has its own Google account or Workspace, not a personal one
- [ ] Billing account established in the client's name; confirm Blaze plan
- [ ] Named individuals identified for: project owner, super-managers, privacy contact, safeguarding contact
- [ ] Those individuals have MFA enabled
- [ ] All compliance documents reviewed and signed off

**Handover**

- [ ] Add the client's owner account to the Firebase project as Owner
- [ ] Transfer the billing account, verify billing continues without interruption
- [ ] Client appoints their super-managers via the two-person flow — do not migrate the developer's own super-manager grant
- [ ] Rotate every credential: API keys, service accounts, any third-party keys
- [ ] Reissue the Maps API key under the client's account with referrer restrictions
- [ ] Transfer domain and hosting ownership
- [ ] Transfer the GitHub repository, or fork to the client's organisation
- [ ] Client confirms they can deploy end to end, unaided

**After handover**

- [ ] Remove the developer's Owner IAM role
- [ ] Revoke the developer's super-manager claim
- [ ] Remove the developer's access to billing, domain, Maps, repository
- [ ] Audit log entry recording the transfer and who authorised it
- [ ] Confirm the retention and purge jobs still run under the new billing account

**Do not skip the credential rotation.** Keys issued during development have
been on a developer machine, possibly in shell history and CI logs. Handover is
the only clean moment to rotate them all.

## 7. Documentation the client must receive

- These compliance documents, reviewed and signed off
- The break-glass runbook
- An architecture overview and deployment guide
- The data inventory and retention schedule
- Named contacts for privacy requests, safeguarding and incidents
- Any vendor contracts — background checks, insurance, Maps billing

## 8. Open questions

1. Which legal entity will own the project — is it incorporated?
2. Who are the initial super-managers, and are they geographically distributed
   enough that the two-person rule is workable?
3. Will the developer retain any support access after handover? If yes, it
   should be time-boxed, audited, and separately named — not Owner.
4. Who pays for Firebase and background checks, and what happens if billing
   lapses? A suspended project takes the ride service down.
