# HubSign Pricing & Packaging Plan

*Revised 10 August 2026 against the UAT build — competitor rates verified 4 August 2026*

---

## 1. Baseline: what is in UAT today

| Tier | Price | Users | Requests/mo | Requests/yr | DMS | Instance |
|---|---|---|---|---|---|---|
| Free | $0 | 1 | 3 | 36 | — | Shared |
| Individual | $15/mo | 1 | 12.5 | 150 | — | Shared |
| Business | $199/mo flat | Unlimited | 150 | 1,800 | Included | Shared |
| Enterprise Shared | $300/mo flat | Unlimited | *unset* | *unset* | Included | Shared |
| Enterprise Dedicated | $400/mo flat | Unlimited | Unlimited | Unlimited | Included | Dedicated + custom domain, SSO, SMTP |

**Two things this build already gets right**, both of which were open problems on the live site:

- **DMS is included in Business**, not sold at $15/seat. That removes per-seat logic from a tier advertising unlimited users, and it restores the executive brief's "Built in" claim on slide 3.
- **Individual is capped at 150/yr.** The live site gives Individual *unlimited* documents at $15 while metering Business — the cheapest paid tier uncapped on the metric the expensive ones meter. The UAT cap makes the ladder monotonic.

The one field still to set is Enterprise Shared's signature request allowance. Everything in section 3 depends on it.

**A note on units.** Allowances are shown per month and per year. Individual's 150/yr is the one awkward figure — it works out to 12.5 a month, so the proposed ladder rounds it to 15/mo (180/yr). How the allowance is enforced has since been settled: annual plans get the full year as a pool, monthly plans get a monthly cap. See section 2.

---

### Terminology: signature requests, not documents

**The billable unit is a send, not a file.** A document sitting in drafts has cost nothing — no email delivered, no signing session, no audit record. Metering "documents" implies otherwise and invites the question at every support contact.

**Definition, for the pricing page and the terms:**

> *A signature request is counted when a document is sent for signature. Drafts, templates, uploaded files and documents stored in the DMS do not count. Once sent, a request counts even if it is later cancelled, declined or deleted. Reminders and resends to the same recipients do not count again.*

**One send event, regardless of recipient count.** A document sent to five signers is one request. That is friendlier than per-recipient metering and it is a genuine advantage over DocuSign worth pointing at. The alternative — counting per recipient — is more cost-reflective if email or SMS delivery is charged per message, so revisit it if delivery costs turn out to be material.

**The reminders clause is not optional.** Without it, a customer nudging a slow signer three times burns four units and will complain, fairly.

**Why not "envelopes".** It is the industry-standard term and buyers already understand it, but the executive brief attacks envelope metering directly on slides 3 and 4 — "100 envelopes per user/yr" and "$0 in envelope overages". Adopting the vocabulary means selling the thing the deck criticises, in the same words.

**This also keeps the two meters distinct:** signature requests meter *sending*; Smart OCR pages meter *processing*. Calling both "documents" would conflate them.

**Relabelling required in the UAT build and on the pricing page — not only in this document.**

---

## 2. Recommended additions

Six changes to the UAT ladder, agreed with the team.

| # | Change | Why |
|---|---|---|
| 1 | Set **Enterprise Shared at 500 requests/mo** (6,000/yr) | Shared infrastructure; unlimited is an uncapped storage and OCR liability |
| 2 | Add **request blocks** to Business and Enterprise Shared | Without them, exceeding an allowance has no defined outcome |
| 3 | Add a **Team tier at $59/mo, capped at 20 users** | $15 to $199 is a 13x jump with nothing in between |
| 4 | **Annual plans receive the full allotment as a pool**; monthly plans keep a monthly cap | Gives seasonal customers a functional reason to prepay, beyond the discount |
| 5 | Add **Smart OCR** as a metered add-on below Business | Machine-learning OCR has a real per-page compute cost that should be recovered |
| 6 | Restructure **support into four tiers** with ticket allowances | An unbounded response-time promise is the real risk, not the ticket volume |

### Proposed full ladder

| Tier | Price | Users / sessions | Requests/mo | Requests/yr | Request blocks | Ceiling | DMS | API + embedding | Instance |
|---|---|---|---|---|---|---|---|---|---|
| Free | $0 | 1 session | 3 | 36 | — | — | — | — | Shared |
| Individual | $15/mo | 1 session | 15 | 180 | — | — | — | API only | Shared |
| **Team** | **$59/mo** | Up to 20 | 50 | 600 | +$25/mo per +50/mo | 2 | — | — | Shared |
| Business | $199/mo | Unlimited (min 2) | 150 | 1,800 | +$45/mo per +100/mo | 3 | Included | Yes | Shared |
| Enterprise Shared | $300/mo | Unlimited (min 2) | **500** | **6,000** | +$35/mo per +250/mo | 4 | Included | Yes | Shared |
| Enterprise Dedicated | $400/mo + setup | Unlimited (min 2) | Unlimited | Unlimited | — | — | Included | Yes | Dedicated + domain, SSO, SMTP |

### Feature differentiation

| Tier | DMS | Smart OCR | API + embedding | Instance |
|---|---|---|---|---|
| Free | — | 50 pages/mo | — | Shared |
| Individual | — | 200 pages/mo | API only | Shared |
| Team | — | 500 pages/mo | — | Shared |
| Business | Included | Included | Yes | Shared |
| Enterprise Shared | Included | Included | Yes | Shared |
| Enterprise Dedicated | Included | Included | Yes | Dedicated + custom domain, SSO, SMTP |

Workflow Builder and Signature Inbox are not shown — Workflow Builder is currently unlimited on every tier, including Free. It is the only feature with no differentiation at all. Worth a deliberate decision rather than leaving it uniform by default: it is an obvious candidate for a Free → Individual or Team → Business fence if it is not free to run.

### Why Team, specifically

Free is 3 requests/month, Individual is one person, and then it is $199. A four-person firm signing twenty documents a month has nothing to buy — Individual does not work because it is single-user, so the only option is a 13x jump. Those prospects either stay on Free and share a login, or go to Dropbox Sign.

Team at $59 with up to 20 users and 50 requests/mo fills that hole without threatening Business: the block ceiling caps Team at 150 requests/mo, exactly Business's included allowance, so the fence between them becomes **DMS, API and embedding** rather than volume.

**On the 20-user cap.** With Team also capped at 50 requests/mo and two blocks, the user limit is unlikely to bind in practice — it is a guardrail, not a meter, and it does not reintroduce per-seat billing. Phrase it on the pricing page as *"up to 20 users"* rather than "20 seats": the first reads as a limit, the second implies seats are being counted for billing.

### Annual allotment is pooled; monthly is capped

An annual customer receives the full year's allowance as a pool to spend as they like — Business annual is 1,800 signature requests, not 150 each month. Monthly plans keep a monthly cap.

**This is a second reason to prepay,** independent of the discount. A customer with seasonal volume — year-end contracts, enrolment season, an audit cycle — now has a functional reason to go annual rather than only a financial one. Say so on the pricing page; it will not be inferred.

**Two rules to settle before build:**

- **Mid-term upgrade.** If a customer exhausts 1,800 in month five and upgrades to Enterprise Shared, the new allowance starts fresh rather than being prorated across the remaining seven months. Fresh is friendlier and simpler to explain; the theoretical abuse is a customer cycling tiers to farm allowances, which is worth watching for rather than engineering against up front.
- **Expiry.** An unused annual pool expires at renewal and does not roll over. That is standard, but it must be stated at the point of purchase or it becomes a complaint rather than a term.

### Why block ceilings

Once a tier hits its block limit, the customer must move up. Without ceilings, Team at $0.50/request marginal stays cheaper than Business at $0.45/request across the whole practical range, and nothing forces the upgrade except wanting the API.

---

### Smart OCR — metered by page, not by file

**OCR cost scales with pages, not files.** A one-page consent form and a 40-page scanned contract are one document each, but the second costs roughly forty times more in compute. Metering documents means the customer scanning long files is subsidised by the customer scanning short ones — and you cannot predict which you will attract.

**It also creates an obvious workaround:** if Individual gets five free documents, a user merges two hundred pages into one PDF and has the whole thing processed as a single unit. Not malicious, simply rational, and it breaks the cost model.

Pages is the honest unit because it is what you actually pay for, and it is how the underlying OCR services bill — so revenue and cost move together. The objection is that pages read as vaguer on a pricing card. The fix is to meter pages and display a document equivalent: "500 pages/mo — about 100 typical documents." This meter is separate from signature requests: Smart OCR counts pages processed, whether or not the file is ever sent for signature.

**The free allowance should be a trial, not a teaser.** A single free document teaches a user nothing about whether full-text search is worth paying for; they need to see search working across a small corpus. Monthly rather than one-time also means the value keeps re-presenting itself, which is what converts.

| Tier | Smart OCR | Rationale |
|---|---|---|
| Free | 50 pages/mo | Enough to scan a handful of real documents and experience search |
| Individual | 200 pages/mo | Meaningful for one person without substituting for a paid team plan |
| Team | 500 pages/mo | Covers a small team's regular filing |
| Business and above | Included | No meter — part of the platform |

**Two things to settle before these numbers are final.** First, your actual cost per page. If OCR runs on existing Hyper-V capacity the marginal cost is near zero and the allowances should be far more generous — the meter exists to fence tiers, not to recover cost. If it calls a paid API, you are paying roughly $1–1.50 per thousand pages and the allowances above cost cents either way. Set the numbers from that figure, not from intuition.

**Second, whether OCR runs automatically on upload or on demand.** Automatic is the better experience but burns allowance on documents nobody will ever search. On demand is more efficient and makes the meter feel fair. Automatic with a per-folder toggle is a reasonable middle.

**Naming:** "BMS ML" is internal vocabulary. **Smart OCR** tells a customer what they are buying and is used throughout this document.

---

## 3. Crossovers under the proposed ladder

| Requests/mo | Requests/yr | Business | Enterprise Shared |
|---|---|---|---|
| 150 | 1,800 | $199 | $300 |
| 250 | 3,000 | $244 | $300 |
| 350 | 4,200 | $289 | $300 |
| 450 | 5,400 | $334 | $300 |
| 500 | 6,000 | $379 | $300 |

**Enterprise Shared wins above roughly 380 requests/mo (4,600/yr).**

| Step | Trigger | Driver |
|---|---|---|
| Individual → Team | 2nd concurrent user | Concurrency |
| Team → Business | 150 requests/mo (block ceiling), or API / embedding | Feature, then ceiling |
| Business → Enterprise Shared | ~380 requests/mo | Price |
| Enterprise Shared → Dedicated | ~1,250 requests/mo, or isolation / custom domain / SSO | Capability, then price |

### Effective cost per signature request

| Tier | At included allowance | Marginal (block rate) |
|---|---|---|
| Individual | $1.00 | — |
| Team | $1.18 | $0.50 |
| Business | $1.33 | $0.45 |
| Enterprise Shared | $0.60 | $0.14 |
| Enterprise Dedicated | No allowance — falls with volume | — |

Marginal cost falls as customers climb. That is a fact, not a slogan, and it is the line to sell.

**Dedicated has no included allowance**, so it has no fixed rate — the flat $400 simply divides across whatever volume the customer runs. At 200 requests/mo that is $2.00 a request; at 500 it is $0.80; at 1,000 it is $0.40; at 2,000 it is $0.20. This is the strongest version of the flat-rate argument: the price never moves, so the unit cost only ever falls.

---

## 4. Annual billing

Framed as **two months free** — instantly checkable, and what buyers compare against.

| Tier | Monthly | Discount | Annual rate | Billed yearly | Customer saves |
|---|---|---|---|---|---|
| Individual | $15 | 20% | $12/mo | $144 | $36 |
| Team | $59 | 20% | $47/mo | $566 | $142 |
| Business | $199 | 17% | $165/mo | $1,983 | $405 |
| Enterprise Shared | $300 | 17% | $249/mo | $2,988 | $612 |
| Enterprise Dedicated | $400 | 17% | $332/mo | $3,984 | $816 |

Blocks discount at the same rate: $45 → $37, $35 → $29, $25 → $21.

**Why 17% and not 20% on the upper tiers.** Annual prepay is worth roughly 10–12% in pure cash-flow terms. The remainder buys churn reduction, which is real but not unlimited — at 20%, a three-year Dedicated customer costs $960 in forgone revenue to lock in someone who would likely have stayed anyway. Individual and Team stay at 20% because they are acquisition tiers and Individual is already published that way.

**The UAT annual toggle currently bills Business at $2,388**, which is $199 × 12 with no discount, sitting beside Individual's "Save 20%" badge. Whatever rate you choose, that inconsistency is the first thing a procurement reader notices.

### Multi-year — Dedicated only

| Term | Discount | Rate | Total |
|---|---|---|---|
| 1 year | 17% | $332/mo | $3,984 |
| 2 years | 20% | $320/mo | $7,680 |
| 3 years | 25% | $300/mo | $10,800 |

**$10,800 over three years against DocuSign Business Pro's $40,500** — and still $2,450 ahead if the prospect negotiates DocuSign down 30%. Include a price-lock clause.

---

## 5. Sell Enterprise Shared self-serve; gate only Dedicated

Enterprise Shared runs on the same infrastructure as Business. Provisioning is automatic, so a sales call in front of it is cost with no added value — at $3,600 ARR, six to eight hours of sales time is a significant share of first-year revenue.

Dedicated is different: standing up an instance, custom domain, SSO and SMTP is scoped onboarding work. That warrants a conversation, and it warrants being paid for.

**One-time setup fee: $2,000** (band $1,500–2,500 by complexity). Covers instance provisioning, custom domain, SSO and SMTP configuration, template migration and training.

**Support as a priced line item**, consistent with the executive brief's position that dedicated support is optional and separately priced. Four tiers, with ticket allowances rather than an unbounded promise:

| Support tier | Price | Response | Coverage | Included tickets |
|---|---|---|---|---|
| Standard | Included | Next business day | Business hours | 15 / year |
| Priority | $150/mo | 4 hours | Business hours | Unlimited |
| Business Critical | $400/mo | 2 hours | Extended, 7am–9pm | Unlimited |
| Dedicated | $750/mo | 1 hour | 24/7, named contact | Unlimited + quarterly review |

**The ticket allowance is what bounds the risk.** Standard includes 15 tickets a year at next-business-day response. Beyond fifteen, the customer either buys a ticket pack (five for $50) or upgrades — a pack is a cleaner answer than a hard stop. Critically, Standard's response time must stay slower than Priority's: if Standard already answered within four hours, Priority would have no market.

**Why Dedicated is $750, not $400.** A named contact at one-hour response is an on-call commitment. The 24/7 answering service costs roughly $80 a month across the whole customer base, so the answering layer is effectively free — but the escalation is not. Someone genuinely reachable overnight is a real imposition on whoever holds the phone, and it should be compensated whether or not the phone rings. The gap between $400 and $750 is the jump from "fast during working hours" to "someone's phone rings at 3am", and it should feel like a different purchase.

**Year-one Dedicated deal value:** $3,984 (annual) + $2,000 setup + $1,800 optional Priority support = **$7,784**, against $4,800 for platform alone. That is a deal worth running a sales process on. With Dedicated support instead of Priority, the same deal is **$14,984**.

### Severity definitions

Without these, every after-hours call is an emergency. The threshold for waking someone is "system down and the customer cannot work around it" — that belongs in the SLA as a definition, not as an understanding.

| Sev | Definition | Response | After-hours |
|---|---|---|---|
| **Sev 1** | Platform unreachable, signing broken for all users, or data loss / exposure. No workaround. | Per SLA tier | **Escalates** |
| **Sev 2** | Major function broken for many users but a workaround exists — OCR failing, one integration down, one organisation affected. | Per SLA tier, business hours | Next business morning |
| **Sev 3** | Single user or document affected; degraded but usable. A template will not save, one signer cannot access an envelope. | 1 business day | No |
| **Sev 4** | Question, configuration help, feature request, training. | 2 business days | No |

- **The customer reports severity; FePro classifies it.** State this in the SLA. Otherwise everything arrives as Sev 1.
- **A Sev 1 must be reproducible or visible in monitoring.** "It was slow earlier" is not Sev 1.
- **Be generous in one direction:** if monitoring catches a Sev 1 before the customer does, call them. That is what makes a dedicated tier feel worth paying for, and it costs nothing extra because someone is already awake.

### Answering service decision tree

A generic answering service without a script will either escalate everything or nothing, and both are worse than no service. The script must be short enough for a stranger to follow at 3am:

1. **Identify the caller** — account name, verified against the customer list. Non-customers: take a message, no escalation.
2. **Ask one screening question:** *"Is HubSign completely unavailable, or is signing failing for everyone at your organisation?"*
3. **If yes** — confirm entitlement tier. Dedicated or Business Critical: escalate now. Others: log and flag for first thing.
4. **If no** — log the ticket and read the holding line: "I have logged this as priority for the team first thing. You will hear from them by [time]."
5. **If the caller insists it is urgent but it does not meet the criteria** — still log, do not escalate, give them the ticket reference.

**The entitlement check at step 3 is the one that matters.** Without it, a Standard-tier customer calls at 2am, the service escalates anyway, and the top tier has been given away free.

**Two pieces to build alongside it.** The on-call roster needs to live somewhere the service can see — a shared document, updated weekly, with a fallback name if the primary does not answer within ten minutes. And escalations must land as a ticket automatically, not only as a phone call: without a record there is no provable response time, and the SLA becomes unenforceable in a dispute.

**Confirm with the answering service before committing:** whether the $80 base covers a minutes or call-count cap, what the overage rate is, and whether a custom script with entitlement lookups is priced differently from generic message-taking. A single outage night can generate twenty calls from one customer. One mitigation: publish a status page and put the URL in the holding line — most repeat calls during an outage are people checking whether you know yet.

---

## 6. Cancellation and refunds

### Recommendation: clawback refunds on every tier

A customer may cancel at any time. Unused months are refunded, calculated at the *undiscounted* monthly rate — so the only thing lost on early exit is the annual or multi-year discount itself.

**Refund = amount paid − (months used × undiscounted monthly rate)**

| Scenario | Paid | Months used | Used at list | Refunded |
|---|---|---|---|---|
| Business annual, cancels month 4 | $1,983 | 4 | $796 | $1,187 |
| Ent. Shared annual, cancels month 7 | $2,988 | 7 | $2,100 | $888 |
| Team annual, cancels month 3 | $566 | 3 | $177 | $389 |
| Dedicated 3-year, cancels month 14 | $10,800 | 14 | $5,600 | $5,200 |

The customer does not keep an annual discount for a partial year of service, but is not punished either — they revert to list for the period actually used. It cannot be gamed: cancelling early is always marginally worse than having chosen monthly, so prepaying never becomes a free option.

**Edge case — the refund floors at zero.** Individual annual is $144; at month eleven, 11 × $15 = $165, more than was paid. The refund must floor at $0 and never become a bill. State it in the terms: *"Refunds are calculated at standard monthly rates and will never be less than zero."* Blocks and add-ons follow the same formula.

### What the market actually does

Automatic pro-rata refunds on annual plans are rare. What exists is a middle ground, and it is worth knowing the benchmarks before committing.

| Vendor | Annual cancellation policy |
|---|---|
| 37signals (Basecamp, HEY) | No automatic proration of unused time, but the cancellation policy invites customers who have not used the account in months, or who just started a billing cycle, to contact them for a "fair refund". For HEY they will refund a prorated amount for the remaining whole months. Their refund page opens: *"Bad refund policies are infuriating."* |
| Slack | No refunds, but on downgrade the remaining balance is prorated and applied as credit toward future Slack services. |
| Microsoft Azure | Refund only if cancelled within 30 days of the effective or renewal date. Otherwise none. |
| Adobe | Full refund if cancelled within 14 days of purchase. Otherwise none. |
| DocuSign, Dropbox Sign, Zoom, Notion | No refund. Access continues to term end; the customer simply is not billed again. |

**The practitioner consensus is ahead of the practice.** SaaStr's guidance to founders notes that almost every vendor refuses refunds on annual contracts, but recommends granting them for whatever portion of the term the customer did not actually use in production. So the recommendation above is not fringe — it is what is advised but rarely automated. That is the differentiator and also the warning: no billing platform ships this logic out of the box.

### Fallback A — credit rather than cash

Same calculation, but the balance becomes account credit rather than a refund. Cancel at month four on Business annual and the $1,187 becomes credit valid for 24 months, usable on any tier.

- Gives the customer something real instead of nothing, which is the core objection to the industry norm.
- Does not touch cash position or revenue recognition — the main cost of true refunds.
- Far simpler to build than a refund pipeline, and Slack already sets the precedent.
- A meaningful share of credit is never redeemed, and some customers return to use it.

**Given pre-launch cash constraints, this may be the version that survives the conversation when full refunds do not. Worth putting both on the table.**

### Fallback B — if no refund at all, how to be transparent

The failure mode is not the policy. It is discovering the policy at cancellation. Six practices, in rough order of impact:

1. **State it at the point of purchase, not in the terms.** Inline beside the annual toggle: *"Annual plans are paid in full. You will have access through 12 August 2027. We do not refund unused months."* A named end date makes it concrete in a way "non-refundable" does not.
2. **Require an explicit acknowledgement on annual checkout only.** One checkbox. It is the difference between a customer who agreed and one who files a chargeback.
3. **Make cancellation fully self-serve.** No "email us to cancel". A no-refund policy plus a cancellation maze is what turns annoyance into a dispute.
4. **Send a renewal reminder 30 days out** with a one-click cancel link. This is close to legally required in several jurisdictions and removes the largest single source of "I did not know it renewed" complaints.
5. **Offer downgrade and pause, not only cancel.** Most people cancelling annual do not want nothing, they want less. Dropping to Team or freezing for three months retains revenue that would otherwise be lost.
6. **Keep the 30-day money-back window at signup.** This is what makes no-refund defensible. "No refunds after the first month" is a policy; "no refunds ever" reads as a trap.

### Why the refund policy is a sales asset

Every competitor in the executive brief — DocuSign, Adobe, Dropbox Sign — locks annual customers in for the full term. "Cancel any time, we refund the unused months at standard rates" is concrete, checkable, and removes the main risk of committing annually. That should push more customers onto annual plans, which is what the discount was for.

**Page copy, one line under the annual toggle:** *"Changed your mind? Cancel any time. We refund unused months at standard monthly rates — you only lose the annual discount."*

### Operational cost of the refund option

- **Revenue recognition gets more complex.** Annual prepayments become genuinely refundable liabilities rather than near-certain revenue. If cash flow depends on collecting a year up front and treating it as banked, that is a real constraint — raise it with whoever handles the books before launch, not at the first refund.
- **The calculation must be automated in-product**, with the refund amount shown before the customer confirms. If a support agent computes it by hand each time, the policy meant to build goodwill becomes a queue.

### Three clauses that matter more than the money

1. **Data export on exit** — full export in a usable format within 30 days of termination, at no charge. For a DMS holding years of signed agreements, "what happens to our files" is a bigger objection than the refund policy. This clause will close more deals than the refund terms will.
2. **SLA breach exit** — if 99.9% is materially missed, the customer exits at the *discounted* rate with full pro-rata refund and no clawback. Costs almost nothing and makes the uptime claim mean something.
3. **30-day money-back window at signup, all tiers.** Removes the risk of committing to a year from someone who has not used the product yet — the real objection, rather than what happens at month seven.

### Legal check required

Future Edge Technology Inc. is an Ontario company. Ontario's Consumer Protection Act regulates automatic renewals and cancellation rights, and Quebec's consumer legislation is notably stricter again — both may impose requirements that terms of service cannot override. Selling Individual to consumers in the UK or EU adds a statutory 14-day cancellation right on top. Jamaica's Consumer Protection Act applies to the in-region operation.

This varies by jurisdiction and by whether the buyer is a consumer or a business. It needs a short conversation with counsel before terms are published — particularly for Individual, where buyers are consumers rather than businesses. The 30-day window above would satisfy much of it.

**Deck placement:** none. Commercial terms belong in the MSA — though the cancellation policy is strong enough to be worth raising verbally in a sales conversation.

---

## 7. Executive brief implications

**The deck's modelled customer now buys Business, not Enterprise.** Slide 4 models 25 users and 2,400 documents per year — 200 requests a month. On the UAT ladder that is Business plus one block — **$244/month, or $2,928 a year** — against the $400 Enterprise Dedicated the deck is selling. A prospect who reads the brief and then opens the pricing page will notice.

Two ways to close that gap, and they are not mutually exclusive:

- **Raise the modelled volume.** At 500 requests/mo (6,000/yr) the scenario lands naturally on Enterprise Shared, and above that on Dedicated.
- **Sell Enterprise on isolation, not volume.** Dedicated instance, custom domain, SSO and SMTP are the reasons a 2,400-request customer would pay $400. That argument is already on slide 6 — it just is not on slide 3 or 4.

Other edits:

- **Slide 3** — column header should read "HubSign **Enterprise**", not "HubSign". "Unlimited" sending is an Enterprise Dedicated property.
- **Slide 4** — "$0 in envelope overages" is Enterprise-only; Business and Enterprise Shared both meter.
- **Slide 4 figures** — the deck models $400/mo. If Dedicated closes annually at $332, the three-year figure drops from $14,400 to $11,952 and the saving versus DocuSign rises from $26,100 to **$28,548**.

The $200 and $300 deck variants no longer map to purchasable tiers. The $300 version in particular claims a dedicated instance and custom domain that belong to the $400 tier.

---

## 8. Remaining conflict

**The in-product seat-plans screen.** Org settings sells Business at $30/seat and Enterprise at $75/seat with DMS at $15/seat. At 25 users that is $1,875/month against the $199–400 in this plan. The 5-seat minimum has been removed, but the model is still per-seat — on the surface where customers actually check out.

Everything else in this plan is coherent. That screen is the last place the old model survives, and it needs rebuilding around signature requests and concurrency. Product work, not copy.

---

## 9. Open questions

1. **Per-tenant hosting cost for a dedicated instance.** Sets the floor under $400 and decides whether the $100 step from Enterprise Shared covers its own cost. If it runs cheap on existing Hyper-V capacity, $400 is generous.
2. **Typical prospect send volume.** The live deployment ran 2,007 documents in seven months — about 287 requests/mo, which sits inside Business with two blocks. If that is representative, most of the pipeline never reaches Enterprise on volume alone, and the tiers above Business have to sell on capability.
3. **Cost to close a Dedicated deal.** The setup fee and support tiers are sized by benchmark. Actual hours would let you price them properly.
4. **Cost per page for Smart OCR.** Self-hosted on existing capacity or a paid API changes the allowances by an order of magnitude. Section 2 sets them from market intuition; they should be set from this number.
5. **Smart OCR add-on price above the free allowance.** Still to be confirmed. It should follow from the cost-per-page figure and be quoted per page block, consistent with how the allowance is metered.
