# Safeguarding & driver vetting — draft

> **DRAFT. NOT LEGAL ADVICE.** See [README](README.md). The vetting standard
> needs sign-off from the organisation and from whoever insures the service.

The service puts volunteer adults alone in private vehicles with community
members, including children. That is the same risk profile as any youth
transport programme, and the controls below are the ones such programmes
normally adopt.

## 1. Driver eligibility (D6)

Proposed minimum standard for a volunteer driver to be approved:

| Requirement | Proposed | Why |
|---|---|---|
| Minimum age | 21 | Common floor for volunteer youth transport; also where personal auto insurance and rental-equivalent risk pricing settle |
| Licence held | 3+ years, valid, unrestricted for the vehicle | Inexperience is a measurable crash-risk factor |
| Motor vehicle record (MVR) check | At approval, then annually | Catches suspensions, DUI, serious moving violations |
| Criminal background check | At approval, then every 2 years | Baseline duty of care |
| Sex offender registry check (NSOPW / state) | At approval, then annually | Non-negotiable for any youth-serving role |
| Personal auto insurance | Evidenced at approval, re-evidenced annually | The driver's policy is normally primary |
| Vehicle condition | Self-attested; seats and belts for every passenger | Capacity in the app must reflect actual belted seats |
| Code of conduct | Signed acknowledgement | Establishes expectations and creates a record |

**Disqualifying findings** should be written down in advance rather than judged
case by case: any sex-offence conviction or registry match; any offence against
a child; DUI within 5 years; reckless driving within 3 years; licence
suspension within 3 years; violent-offence convictions within 7 years.
Anything outside the list goes to a named reviewer, and the reasoning gets
recorded.

**A driver may not be assigned rides until vetting is `approved`.** This must
be a hard gate in the assignment function, not a manager habit.

### On who runs the checks

Background and MVR checks require a vendor. This is a cost and a procurement
decision for the organisation, not an engineering one. What the system must do
is store the *outcome and dates* — never the underlying report, which is
sensitive and often contractually restricted. Fields: status, check type,
completed date, expiry date, reviewer. No documents, no case detail.

## 2. The one-to-one rule (D4) — decided: not enforced

**Decision (owner): permitted.** The rationale given is that the community is
small enough that members know one another, so a driver alone with a single
13–17 year old is not treated as a risk configuration at the founding location.

**Engineering recommendation, on record:** enforce it. Two reasons, neither of
which is about the founding location:

1. The premise is location-specific. "Everyone knows everyone" holds for one
   congregation; the platform being designed reaches dozens of locations across
   states, where it will not hold. The setting should be revisited before the
   first location where it stops being true.
2. The control protects the **driver** as much as the passenger. A volunteer
   alone with an unrelated minor and no witness has no way to rebut an
   allegation. Insurers offering abuse/molestation cover commonly ask whether
   one-to-one contact is designed out.

**What is being built.** The constraint is implemented but ships **disabled**:

```
locations/{id}.safeguarding.preventOneToOneWithMinor = false   // default
```

When enabled, a ride whose manifest is exactly one `13-17` passenger cannot be
assigned to a vehicle carrying no other passenger; the optimiser groups them
with another pickup or leaves the request for manual dispatch. Enabling it is a
per-location toggle, not a code change.

Under-13s are unaffected either way — D3 requires a guardian in the vehicle.

## 3. Accompaniment rules

| Passenger | Rule |
|---|---|
| `under13` dependent | Must travel with their guardian in the same vehicle (D3). Enforced at request time and at assignment. |
| `13-17` member | May travel alone, subject to the one-to-one rule above. |
| Guest | Travels with the member who vouched for them. A guest may not be the only passenger. |

## 4. Manifests

Every assigned ride carries a manifest naming every passenger, including
dependents and guests. This is a safeguarding artifact, not a convenience:

- The **driver** sees who they are collecting, so an unexpected extra person is
  visible rather than silent.
- A **manager** can reconstruct who was in which vehicle, with which driver,
  on any date — the first question asked after any incident.
- The manifest is immutable once the ride starts; changes create a new
  revision rather than overwriting.

## 5. Incident reporting

An incident is any collision, injury, allegation of misconduct, a passenger
left behind, or a driver failing to complete a ride with passengers aboard.

Minimum viable process:

1. Driver or member reports through the app or to their location manager.
2. Location manager records it against the ride, within 24 hours.
3. Automatic escalation to a named safeguarding contact for anything involving
   a minor or an allegation of misconduct.
4. The ride record and manifest are placed on **legal hold** — exempted from
   the retention purge — until the matter is closed.

**Mandatory reporting.** Several states impose mandatory child-abuse reporting
duties on people in positions of trust. Who in this organisation is a mandatory
reporter, and in which states, is a question for counsel — but the system
should make it easy to comply, which means the escalation path and the legal
hold need to exist.

## 6. Code of conduct — points to include

Drafting note rather than final wording:

- No one-to-one contact with a minor outside the ride itself.
- No private messaging between a driver and an unaccompanied minor; all
  coordination through the app or a guardian.
- No detours, no additional passengers not on the manifest.
- No phone use while driving; no transporting under the influence.
- Immediate reporting of any incident or near miss.
- Consequences for breach, and who decides.

## 7. Insurance — questions for the broker

Not engineering decisions, but they affect what the system must record:

- Is non-owned auto liability cover in place for volunteer drivers using
  personal vehicles?
- Does the carrier require a specific vetting standard? If so, D6 should match
  it rather than my proposal.
- Are there per-state requirements for volunteer transport of minors?
- Does abuse/molestation cover exist, and what controls does it require?
