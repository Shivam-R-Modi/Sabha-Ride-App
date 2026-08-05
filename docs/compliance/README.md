# Compliance & Safeguarding — working drafts

> **STATUS: DRAFT. NOT LEGAL ADVICE. NOT YET REVIEWED.**
>
> These documents were drafted by an engineer to make sure the system
> architecture does not foreclose any compliance obligation, and to give a
> qualified reviewer something concrete to correct rather than a blank page.
> Every legal characterisation here needs confirming by someone qualified in
> US privacy law and by whoever insures the ride service. Do not publish any
> of this to users, and do not rely on it in an incident, until it has been
> reviewed and signed off.

## Why this exists

The service transports community members — including minors — in private
vehicles driven by volunteers, and is planned to operate across multiple
locations and states. That combination raises three duties that are cheap to
design for now and expensive to retrofit:

1. **Privacy** — home addresses, phone numbers and real-time location, some of
   it relating to children.
2. **Safeguarding** — adults transporting minors, largely unsupervised.
3. **Tenancy isolation** — one location's staff must not be able to read
   another location's families.

## Documents

| File | Covers |
|---|---|
| [`privacy-and-data.md`](privacy-and-data.md) | What is collected, lawful basis, minors and consent, retention, individual rights |
| [`safeguarding-and-drivers.md`](safeguarding-and-drivers.md) | Driver eligibility and vetting, the no-one-to-one rule, manifests, incident reporting |
| [`technical-enforcement.md`](technical-enforcement.md) | Policy clause → data field → security rule → code gate. The part that binds engineering |
| [`ownership-and-handover.md`](ownership-and-handover.md) | Root of trust, super-manager governance, Firebase project ownership migration |

## Who needs to review what

| Reviewer | Documents | Key questions to put to them |
|---|---|---|
| US privacy counsel | privacy-and-data | Does COPPA attach given the dependent model? Which state regimes apply given the org's structure and size? Is the nonprofit exemption to CCPA available and should we rely on it? |
| Insurance broker / carrier | safeguarding-and-drivers | Is non-owned auto liability cover in place? Does the vetting standard meet the carrier's requirements? Are there per-state driver requirements? |
| Safeguarding lead / trustee | safeguarding-and-drivers | Is the vetting standard proportionate? Who receives incident reports? Who are the mandatory reporters? |
| Organisation trustees | ownership-and-handover | Who holds the root of trust after handover? Who may appoint super-managers? |

## Decision register

Decisions taken during design, with the reasoning, so a reviewer can challenge
the reasoning rather than guess at it.

| # | Decision | Rationale | Status |
|---|---|---|---|
| D1 | **Self-service accounts require age 13+.** Under-13s exist only as dependents on a guardian's account and never log in. | COPPA attaches to collecting personal information *from* a child under 13. If the guardian supplies the information, the collection is from the adult. Removing the child-facing account removes the highest-risk surface. | Draft — confirm with counsel |
| D2 | **Age is stored as a band** (`under13` / `13-17` / `adult`), never a date of birth. | Bands are sufficient to drive every consent and safeguarding rule in the system. An exact DOB for a minor is liability with no operational benefit. | Draft |
| D3 | **A dependent must travel with their guardian** in the same vehicle. | Client instruction, and it removes the unaccompanied-under-13 scenario entirely. | Confirmed by owner |
| D4 | **One-to-one rides between a driver and a single unaccompanied 13–17 year old are PERMITTED.** The constraint is built but ships disabled, as a per-location setting defaulting to off. | Owner decision: the community is small enough that members know each other, so the configuration is not considered a risk at the founding location. Engineering recommended enforcing it (see safeguarding doc §2) on the grounds that the premise weakens as the platform expands to locations where members do not know each other, and that the control also protects drivers from unwitnessed allegations. Owner decision taken with that recommendation on record. Capability retained so any location, or an insurer, can enable it without a rebuild. | **Decided by owner — revisit before multi-location launch** |
| D5 | **Maximum 3 guests per request**, additionally bounded by available belted seats in the assigned vehicle. | Owner decision. A fixed cap keeps a single request from consuming an entire vehicle and keeps seat-aware routing tractable. Configurable per location. | Confirmed by owner |
| D6 | **Driver vetting: annual MVR + criminal record check + sex-offender registry check, minimum age 21, licensed 3+ years, personal auto insurance evidenced.** | Common baseline for volunteer youth transport in the US. See safeguarding doc for the reasoning on each element. | **Draft — needs owner + insurer sign-off** |
| D7 | **Ride records involving a minor are retained until that person turns 18 plus the applicable limitation period**, rather than a flat term. | Limitation periods for claims by minors are commonly tolled until majority in US states. A flat 3-year purge could destroy records still needed. | Draft — confirm the term with counsel |
| D8 | **Precise location is collected only during an active ride** and purged on a short cycle. | Several state regimes treat precise geolocation as sensitive. Continuous tracking is not needed for the service to work. | Draft |
| D9 | **Tenancy isolation is a compliance control**, not a feature. Managers can read only their own locations' members. | Prevents a location-level account from reaching a national dataset of families and children. | Draft |

## Open items

- [ ] Confirm whether the operating entity is a registered nonprofit, and
      whether it meets any CCPA "business" threshold. Affects D9 scope.
- [ ] Confirm insurance position on volunteer drivers using personal vehicles.
- [ ] Identify the mandatory reporters in the organisation and their duties in
      the states of operation.
- [x] ~~Decide D4 (the one-to-one rule)~~ — decided: not enforced, setting ships disabled.
- [ ] Re-put D4 to the trustees and the insurer before the first location where members do not all know each other.
- [ ] Appoint the person accountable for privacy requests once live.
