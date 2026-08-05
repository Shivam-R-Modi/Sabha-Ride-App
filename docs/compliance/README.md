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
| D3 | **Any passenger under 13 must travel with an accompanying adult** in the same vehicle — a dependent with their guardian, an under-13 guest with the member who vouched for them. | Owner instruction. Removes the unaccompanied-under-13 scenario for both dependents and guests. | Confirmed by owner |
| D4 | **One-to-one rides between a driver and a single unaccompanied 13–17 year old are PERMITTED.** The constraint is built but ships disabled, as a per-location setting defaulting to off. | Owner decision: the community is small enough that members know each other, so the configuration is not considered a risk at the founding location. Engineering recommended enforcing it (see safeguarding doc §2) on the grounds that the premise weakens as the platform expands to locations where members do not know each other, and that the control also protects drivers from unwitnessed allegations. Owner decision taken with that recommendation on record. Capability retained so any location, or an insurer, can enable it without a rebuild. | **Decided by owner — revisit before multi-location launch** |
| D5 | **Maximum 3 guests per request.** A group larger than the available belted seats **may be split across vehicles**, except that a guardian and their under-13 passenger must stay in one vehicle. | Owner decision on both the cap and splitting. The guardian exception is engineering's addition: without it, splitting would silently break D3 at dispatch with nobody noticing. | Confirmed by owner |
| D6 | **Driver vetting is handled outside the app. The application neither records nor enforces it.** | Owner decision: drivers are already vetted by the organisation's own process, so duplicating it in software adds no safety and creates a second record to keep accurate. Engineering had proposed an in-app vetting gate; that proposal is withdrawn. **Consequence to note:** the application cannot evidence that vetting was applied to any given ride, so the organisation's external records are the sole evidence if it is ever asked. Worth confirming those records are retained and retrievable per driver. | Decided by owner |
| D7 | **Ride records involving a minor are retained until that person turns 18 plus the applicable limitation period**, rather than a flat term. | Limitation periods for claims by minors are commonly tolled until majority in US states. A flat 3-year purge could destroy records still needed. | Draft — confirm the term with counsel |
| D8 | **Precise location is collected only during an active ride** and purged on a short cycle. | Several state regimes treat precise geolocation as sensitive. Continuous tracking is not needed for the service to work. | Draft |
| D9 | **Tenancy isolation is a compliance control**, not a feature. Managers can read only their own locations' members. | Prevents a location-level account from reaching a national dataset of families and children. | Draft |

| D10 | **Guest records carry a name, a required phone, and an age band**, entered by the vouching member and not retained past the event. | Phone is required (owner) so a driver can make contact. Age band is needed to apply D3. Both are collected from the member rather than the guest, so the member must be told they are responsible for having the guest's agreement. Not retained, which limits the exposure. | Draft |
| D11 | **Location permission is requested on demand to set or confirm a pickup address**, not continuously. Live tracking stays limited to drivers on an active ride (D8). | The owner asked about requesting location from all users. Narrowing it to a one-off address confirmation gets accurate pickup coordinates without a standing location surface over minors. | **Draft — owner to confirm** |
| D12 | **superManager is granted manually via the backend**, not through an in-app flow. | Owner decision: superManagers already hold Firestore access, so the trust is rooted there (A7). **Consequence:** `platformRole` must be deny-all for client writes, with claims synced by a trusted trigger only — otherwise any account able to write its own user document could self-elevate. | Decided by owner |

## Open items

- [ ] Confirm whether the operating entity is a registered nonprofit, and
      whether it meets any CCPA "business" threshold. Affects D9 scope.
- [ ] Confirm insurance position on volunteer drivers using personal vehicles.
- [ ] Identify the mandatory reporters in the organisation and their duties in
      the states of operation.
- [x] ~~Decide D4 (the one-to-one rule)~~ — decided: not enforced, setting ships disabled.
- [ ] Re-put D4 to the trustees and the insurer before the first location where members do not all know each other.
- [ ] Appoint the person accountable for privacy requests once live.
