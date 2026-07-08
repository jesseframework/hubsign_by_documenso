# HubSign — Billing Plan (v2, revised)

_Updated version of Lenox's "Hubsign plan updates.md", re-scoped against the current codebase. Companion code-level analysis lives in `HUBSIGN_BILLING_ROADMAP_REVIEW.md`. Last updated 2026-07-05._

---

## Status legend
- **Effort:** S (≈1 day) · M (≈2–4 days) · L (≈1 week+)
- **Risk:** Low / Med / High (production/billing sensitivity)
- ⚠️ = needs a product/pricing decision before build (see "Decisions to lock" at the bottom)

## Reality check (why the order changed)
HubSign has **two separate billing systems** that don't talk to each other:
- **Individual/Team** — legacy Documenso, driven by the Stripe webhook + `Subscription` model. Individual plan limits come from **Stripe product metadata** (not code).
- **Organization (seats)** — newer HubSign system, driven by tRPC + billing columns on `Organization`. Tier limits are **hardcoded and duplicated ~4×**.

The org system has an **open loop**: a successful org checkout is never written back (the webhook ignores org subscriptions), so a paying org stays `billingStatus = inactive`. This is inserted below as **Phase 0** because Lenox's Phases 2, 4, and 5 quietly depend on it.

---

## Revised sequence

| # | Phase | Depends on | Effort | Risk |
|---|-------|-----------|--------|------|
| **0** | **Close the org billing loop** (NEW) | — | M | Med |
| 1 | Unify tier/limit tables + enforce recipient limit | — | M | Low–Med |
| 2 | Billing emails (purchase + renewal) | 0 (for org triggers) | S–M | Low |
| 3 | Limit alerts (approaching quota) | 1 | S | Low |
| 4 | Individual plan restructure ⚠️ | 1 | M | Med |
| 5 | Business/Enterprise per-seat ⚠️ | 0 | M–L | Med–High |
| 6 | DMS add-on $15 ⚠️ | 1 | S | Low |
| 7 | AI credits ⚠️ | — | L | High |
| 8 | Rename Signature Inbox → "Mailroom" | — | S–M | Low |
| 9 | Replace `/admin/subscriptions` | 0 | S | Low |

Suggested grouping into releases:
- **Release A (foundation):** Phase 0 + Phase 1 — makes billing correct and the data model sane. Nothing user-visible breaks.
- **Release B (comms):** Phase 2 + Phase 3 — emails + in-app alerts.
- **Release C (pricing):** Phase 4 + Phase 5 + Phase 6 — the actual plan/price changes (needs decisions locked first).
- **Release D:** Phase 7 (AI credits) — standalone, largest build.
- **Anytime, independent:** Phase 8 (Mailroom rename), Phase 9 (admin page).

---

## Phases

### Phase 0 — Close the org billing loop  _(NEW — prerequisite)_
**Goal:** a successful org purchase actually activates the org.
**Today:** org checkout sets `subscription metadata.type='organization'`, but no webhook branch reads it back; `billingStatus`/`stripeSubscriptionId` are never written on first purchase.
**Deliverables:**
- Webhook handles org subscriptions (`checkout.session.completed`, `subscription.updated/deleted`) → writes `stripeSubscriptionId`, `seatCount`, `billingStatus` onto `Organization`.
- Seat-quantity sync + the `stamp-router` active-billing gate start working.
- ⚠️ **Decision:** reunify org billing into the `Subscription` model (add `organizationId`) vs. keep the `Organization.*` columns. Reunifying makes Phase 9 free.
**Risk:** touches the live webhook — needs idempotency + tests.

### Phase 1 — Unify tier/limit tables + enforce recipient limit
**Goal:** one source of truth for org tiers; close a real enforcement hole.
**Today:** STARTER/PRO/ENTERPRISE limits copied across server, tRPC, frontend, Prisma defaults, and inline UI strings — with drift (`Infinity` vs `999999`; cents vs dollars). **Recipient limits are not enforced server-side** (client-only, bypassable).
**Deliverables:**
- Single `ORG_TIERS` module (prices in cents; `null` = unlimited, drop `Infinity`/`999999`).
- Add the missing **server-side recipient check** next to the existing document-count checks.
- Keep individual limits reading Stripe metadata; document the boundary so the two aren't wrongly merged.
- Fix the inconsistent `Error` vs `AppError(LIMIT_EXCEEDED)` in the template router.

### Phase 2 — Billing emails
**Goal:** purchase confirmation + renewal reminder.
**Today:** no billing templates exist; solid infra does (React Email + Nodemailer + i18n; `org-member-welcome.tsx` is the pattern).
**Deliverables:**
- Purchase-confirmation email from `checkout.session.completed` (individual) and the Phase 0 org branch.
- Renewal-reminder from a **scheduled job** over `periodEnd` (not a webhook).

### Phase 3 — Limit alerts
**Goal:** warn users approaching their quota (e.g. 80% / 100%).
**Today:** limits resolve via `getServerLimits` → `/api/limits` → `useLimits`; no alerting.
**Deliverables:** server-computed `used/quota` ratio → in-app banner + optional email (reuses Phase 2).

### Phase 4 — Individual plan restructure ⚠️
**Proposed (Lenox):** Basic **$35** · Pro **$45** · Dedicated **$100**.
**Today:** individual plans are **Stripe-metadata driven** (REGULAR/PLATFORM/ENTERPRISE/COMMUNITY); prices live in Stripe, rendered live — no hardcoded prices.
**Mostly Stripe-dashboard work**, not code: create products/prices with metadata, map new price IDs in `get*PlanPriceIds`, update copy.
**Flags:** "Pro" collides with the org "Pro" tier; clarify what **"Dedicated $100"** provisions (dedicated infra vs. just top limits).

### Phase 5 — Business/Enterprise per-seat ⚠️
**Goal:** finish the org-seat model as the Business/Enterprise offering.
**Today:** two per-seat implementations — legacy team seats (works, webhook-wired) and org seats (partial, **not** wired — Phase 0).
**Deliverables:** build on Phase 0; reuse the proven team quantity-sync pattern. Don't run both seat systems for one customer.

### Phase 6 — DMS add-on $15 ⚠️
**Today:** largely built — `DMS_ADDON_LIMITS`, `OrganizationMember.dmsAddon`, add-on line item, `dmsEnabled` gating.
**Decision:** **$15/seat or $15/org?** Current code computes `qty × (price + dms)` → effectively **$15 per seat**. Confirm intent.

### Phase 7 — AI credits ⚠️  _(largest net-new)_
**Today:** AI limits are a **per-user env allowlist** (`NEXT_PRIVATE_DMS_AI_UNLIMITED_USERS`); no balance, ledger, or metering — greenfield.
**Recommended design:** a credit **ledger** (org- or user-owned) → **decrement** at the AI entry points (DMS AI agent, `workflow.generate`, optionally OCR) → **top-up** via a Stripe **one-time credit-pack** price. Low-balance alert reuses Phase 3.
**Decision:** credits owned by **org or user**? One-time packs vs. true metered usage (much larger).

### Phase 8 — Rename Signature Inbox → "Mailroom"
**Orthogonal to billing — its own PR.** Touches nav, routes under `org+/inbox*`, i18n `.po` (×7 locales), maybe email copy.
**Decision:** does the **URL** change (`/org/inbox` → `/org/mailroom`, needs redirects) or only the label?

### Phase 9 — Replace `/admin/subscriptions`
**Today:** read-only table over the `Subscription` model — **already blind to org subscriptions**.
**Do last, and replace not delete:** if Phase 0 reunifies org billing into `Subscription`, upgrade this into an org-aware admin view instead of dropping it.

---

## Decisions to lock (product/pricing — your call)
1. **Org billing model:** reunify into `Subscription` (recommended) or keep `Organization.*` columns?
2. **DMS add-on:** $15 **per seat** or **per org**?
3. **"Dedicated $100":** dedicated infrastructure, or just the highest limit tier?
4. **AI credits:** owned by **org or user**? One-time **credit packs** or **metered** usage?
5. **Naming:** resolve "Pro" and "Enterprise" each meaning two different things (individual vs. org). Settle the taxonomy before printing prices.
6. **"Mailroom":** rename the **URL** or only the **label**?

## Recommended first step
**Release A = Phase 0 + Phase 1.** It's invisible to customers, fixes a real "paid-but-inactive" bug, and gives every later pricing change one clean foundation to build on — no pricing decisions required to start.
