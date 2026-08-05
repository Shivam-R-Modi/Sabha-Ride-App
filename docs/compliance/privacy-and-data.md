# Privacy & data handling — draft

> **DRAFT. NOT LEGAL ADVICE.** See [README](README.md). Every legal
> characterisation below needs confirming by qualified US privacy counsel.

## 1. Which laws plausibly apply

| Regime | Why it may apply | Design response |
|---|---|---|
| **COPPA** (federal) | Service is used by families with children under 13 | Under-13s have no account and never interact with the service directly (D1). Their information is supplied by a guardian. |
| **State comprehensive privacy laws** — CA (CCPA/CPRA), VA, CO, CT, UT, TX, OR, MT and others as they commence | Residents of these states will use the service as it expands nationally | Build to the highest common denominator: notice, access, correction, deletion, minimisation, consent for sensitive data. |
| **TCPA** | Any SMS or automated calling | Push notifications only unless SMS consent is separately captured. |
| **ADA / Section 508 expectations** | Public-facing service | UI held to WCAG 2.1 AA. |
| **State record-retention and limitation periods** | Claims arising from transport incidents | Retention schedule in §5, with tolling for minors (D7). |

**On the nonprofit exemption.** CCPA applies to for-profit "businesses" meeting
revenue or volume thresholds; a volunteer religious or community organisation
will often fall outside it, and several state laws carry similar carve-outs.
**Do not design to the exemption.** It is fragile, varies by state, changes as
laws are amended, and does nothing for reputational or safeguarding risk.
Design to the standard; let counsel decide what can be relaxed.

## 2. Data inventory

| Data | Subject | Why it is needed | Sensitivity |
|---|---|---|---|
| Name | member, dependent, guest | Identifying a passenger to a driver | Normal |
| Email | member | Authentication | Normal |
| Phone | member (optional: guest) | Driver ↔ passenger contact during a ride | Normal |
| Home address + coordinates | member | Pickup point; route optimisation | **Sensitive in practice** — a child's home address |
| Age band | member, dependent | Consent rules; safeguarding rules | **Sensitive** (relates to minors) |
| Guardian link | dependent | Accountability; accompaniment rule | Sensitive |
| Real-time location | driver | Live ride tracking, ETA | **Sensitive** (precise geolocation) |
| Ride history + manifest | all passengers | Operations; incident reconstruction | Sensitive |
| Attendance response | member | Ride demand planning | Normal |
| Vehicle details | driver | Passenger identification, capacity | Normal |
| Driver vetting status | driver | Safeguarding gate | **Sensitive** (background check outcome) |

**Guests** are the thinnest record deliberately: a name, optionally a phone,
and never an address — a guest is collected at the vouching member's pickup
point. A guest's information is supplied by the member, so the member must be
told, at the point of entry, that they are responsible for having the guest's
agreement.

## 3. Minors

### Age floor (D1)

- **Self-service accounts: 13 and over.**
- **Under 13: dependent records only**, created by a guardian, no login
  credentials, no direct interaction with the service.

The reasoning is that COPPA is concerned with collecting personal information
*from* children under 13 through an online service. Removing the child-facing
account removes that collection path: the guardian supplies the information
about their own child. This is a deliberate architectural choice, not a
labelling exercise — there must be no code path that issues credentials to an
under-13 record.

Counsel should confirm this analysis holds for the finished product, in
particular whether any feature (notifications to a child's device, a child
viewing ride status) would re-open direct collection.

### 13–17 with their own account

Permitted, with:

- Guardian contact captured at signup and a guardian link on the account.
- Guardian notified when the minor requests or is assigned a ride.
- The safeguarding constraints in
  [`safeguarding-and-drivers.md`](safeguarding-and-drivers.md) applied.

### Age bands, not birth dates (D2)

Store `under13` / `13-17` / `adult`. Every rule in the system keys off the
band. An exact date of birth for a child is data we would have to protect but
would never use.

## 4. Consent and notice

| Moment | What is shown | What is recorded |
|---|---|---|
| Account signup | Privacy notice, age attestation, terms | Version of notice accepted, timestamp |
| Adding a dependent | Guardian confirms responsibility for the child's data | Timestamp, guardian uid |
| Adding a guest | Member confirms the guest agreed to share their name/phone | Timestamp, vouching uid |
| Enabling notifications | Push permission | FCM token grant |
| Driver going on shift | Location will be tracked while a ride is active | Consent timestamp, version |

Consent records must be **versioned** — store which version of the notice was
accepted, so a later change to the notice does not silently rewrite history.

## 5. Retention schedule (D7, D8)

| Record | Retention | Reasoning |
|---|---|---|
| Account profile | Life of account + 90 days after deletion request | Grace period for accidental deletion |
| Ride record + manifest, **no minor aboard** | 3 years | Common limitation-period window for personal injury claims |
| Ride record + manifest, **minor aboard** | Until the youngest passenger turns 18, **plus** the applicable limitation period | Limitation periods for claims by minors are commonly tolled until majority. A flat purge could destroy records still legally live. Confirm the term with counsel. |
| Driver real-time location trace | 30 days | Needed for dispute or incident review, not beyond |
| Driver vetting record | Duration of service + 7 years | Demonstrating the duty of care was discharged |
| Attendance responses | Current cycle + 1 year | Planning only |
| CSV exports | Not retained server-side; generated on demand | Reduces the number of copies of the dataset |
| Audit log (role grants, config changes) | 7 years | Governance |

Retention must be **enforced by a scheduled job**, not by intention. Records
should carry an explicit `retainUntil` timestamp computed at write time, so the
purge job never has to re-derive policy.

## 6. Individual rights

Regardless of which regime ultimately applies, the service should be able to:

- **Access** — export everything held about a person, including rides they
  were a passenger on.
- **Correct** — amend profile and address data.
- **Delete** — remove the account and personal data, subject to the retention
  overrides above. Deletion must not silently destroy a ride manifest still
  within its retention window; anonymise the passenger entry instead.
- **Guardian rights** — a guardian may exercise all of the above for a
  dependent, and for a 13–17 year old where state law provides it.

There must be a named person accountable for servicing these requests and a
documented turnaround. That person does not exist yet — see open items.

## 7. Location data (D8)

- Driver location is collected **only while a ride is active**, never in the
  background, never for passengers.
- Traces purge on a 30-day cycle.
- The driver is told at shift start, and can end tracking by ending the shift.

## 8. Third parties

| Processor | What it receives | Notes |
|---|---|---|
| Google Firebase (Auth, Firestore, Functions, Hosting, FCM) | All application data | Primary processor. Data residency should be confirmed and recorded. |
| Google Maps Platform | Addresses and coordinates for geocoding and routing | Addresses of members, including minors, leave the system here. Confirm terms and whether any retention occurs. |

Any future processor — SMS gateway, analytics, error reporting — must be added
to this table before it is integrated, not after. Analytics in particular
should be assessed carefully given the population.

## 9. Security posture relevant to privacy

- Tenancy isolation so a location's staff cannot read another location's
  members (D9).
- Profile documents must not be world-readable to authenticated users — the
  current rule allows exactly that and is the first thing to fix.
- Multi-factor authentication mandatory for super-managers, who can otherwise
  reach a national dataset of families.
- All privileged actions written to an append-only audit log.
