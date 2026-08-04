# HubSign Billing Roadmap — Review & Refinement

_Review of the pasted "Hubsign plan updates.md" (8-phase billing roadmap), grounded against the current codebase. Prepared 2026-07-05._

---

## TL;DR — the three things that change the plan

1. **There are two parallel, disconnected billing systems.** Legacy Documenso (user/team, driven by the Stripe webhook + `Subscription` model) and the new HubSign org-seat system (org/seat, driven by `org-router` tRPC + billing fields on `Organization`). They share **no** limit tables, **no** webhook path, and **no** source of truth. Every roadmap phase must say *which* system it touches, or it will silently only fix one.

2. **The org-seat billing loop is open — this is a latent Phase 0 blocker.** The Stripe webhook handler (`packages/ee/server-only/stripe/webhook/handler.ts`) has zero handling for `type: 'organization'` subscriptions — they fall through to `.otherwise()`. After a successful org checkout, **nothing writes back `Organization.stripeSubscriptionId` or flips `billingStatus` to `active`**. The only writes to `seatCount`/`billingStatus` live inside `if (org.stripeSubscriptionId) {…}` (`org-router.ts:61-83`), which can never be true on first purchase. Consequences that block the roadmap:
   - Org per-seat sync (Phase 4) is dead code today.
   - The `stamp-router` "active billing" gate (`stamp-router/router.ts:53,59`) can never pass for a legitimately-paying org.
   - Purchase-confirmation emails (Phase 2) have **no reliable trigger** for org checkouts.
   **→ Close this loop first. It's a prerequisite, not a phase 4 detail.**

3. **The "consolidate the tables" job has two sources of truth, not one.** Individual paid-plan limits are **Stripe-product-metadata driven** (`ZLimitsSchema` parses product metadata at `limits/server.ts:142-143`) — the hardcoded tables don't govern them at all. The org tiers are hardcoded (and duplicated ~4×). A consolidation that ignores the Stripe-metadata side will break individual plans.

---

## Refined phase sequencing

The roadmap's order is roughly right for *risk* (start with alerts/emails) but wrong for *dependencies*. Recommended order:

| Order | Phase | Why here | Risk | Rel. effort |
|-------|-------|----------|------|-------------|
| **0 (NEW)** | Close the org-seat Stripe loop | Unblocks Phases 2, 3, 4, 5; fixes a real "paid but not active" bug | Med | M |
| 1 | Consolidate tier/limit tables | Foundation for every pricing change; low user-facing risk | Low–Med | M |
| 2 | Billing emails (purchase + renewal) | Depends on Phase 0 for org triggers; infra already exists | Low | S–M |
| 3 | Limit alerts (approaching-limit) | Builds on consolidated limits (Phase 1) | Low | S |
| 4 | Individual plan restructure (Basic/Pro/Dedicated) | Pricing decision; Stripe-metadata driven | Med | M |
| 5 | Business/Enterprise per-seat | Depends on Phase 0; plumbing partly exists | Med–High | M–L |
| 6 | DMS add-on $15 | Mostly exists; needs per-seat-vs-flat decision | Low | S |
| 7 | AI credits | Greenfield subsystem; largest net-new build | High | L |
| 8 | Rename Signature Inbox → "Mailroom" | Orthogonal to billing; do as its own PR anytime | Low | S–M |
| 9 | Deprecate `/admin/subscriptions` | Do **last** and **replace**, don't just delete | Low | S |

(Roadmap had alerts=1, emails=2. I swapped them because billing emails for org purchases can't fire reliably until Phase 0 lands, whereas alerts only need the consolidated limits from Phase 1. Adjust if individual-only emails ship first.)

---

## Phase-by-phase review

### Phase 0 (NEW) — Close the org-seat Stripe loop  ★ prerequisite
**Current state:** `setupBilling` (`org-router.ts:464`) creates a checkout session with `subscription_data.metadata = { organizationId, type: 'organization' }`, but no webhook branch reads it back.
**Do:**
- Add an `organization` branch to `checkout.session.completed` and `customer.subscription.{updated,deleted}` in `handler.ts`, keyed on `subscription.metadata.type === 'organization'` → write `stripeSubscriptionId`, `stripeSeatPriceId`, `seatCount`, `billingStatus` onto the `Organization`.
- Mirror the legacy status mapping in `on-subscription-updated.ts` (`active→active`, `past_due→past_due`, else `inactive`).
- **Decision needed:** does org billing reuse the `Subscription` model (add `organizationId Int?`) or stay on the `Organization.*` columns? Reusing `Subscription` reunifies the two systems and makes `/admin/subscriptions` (Phase 9) org-aware for free. **Recommended.**
**Risk:** touching the webhook is production-sensitive — gate behind tests and verify signature/idempotency.

### Phase 1 — Consolidate tier/limit tables
**Current state (duplication is real and understated):** the STARTER/PRO/ENTERPRISE limit set is copied in `limits/server.ts:38-42`, `org-router.ts:590-594`, and `org/billing.tsx:26-30`, mirrored again in Prisma defaults (`schema.prisma:1620-1623`) and inline `<option>` strings (`org/billing.tsx:169-171`). Genuine drift exists: **`Infinity` vs the magic number `999999`** (serialize differently), and **cents (1500/2500/4500) vs dollars (15/25/45)** maintained by hand.
**Do:**
- One canonical `ORG_TIERS` table (single module) with prices in **cents only**; derive dollar display. Kill the `999999`/`Infinity` split — pick one sentinel (recommend a real `null = unlimited`, not `Infinity`, since `Infinity` doesn't JSON-serialize).
- Keep the **individual** side reading Stripe product metadata (don't hardcode it) — document the boundary explicitly so the two don't get re-merged wrongly.
- **Close the recipient-enforcement gap while you're here:** recipient limits are currently **client-only** (`add-signers.tsx:747`) — no server check. Add a server-side guard in the document/recipient mutation path alongside the existing document-count checks (`document-router/router.ts:270-277`). Otherwise the recipient tier is decorative.
- Fix the inconsistent error type in `template-router/router.ts:234-238` (throws a plain `Error`, not `AppError(LIMIT_EXCEEDED)`).

### Phase 2 — Billing emails (purchase confirmation + renewal reminder)
**Current state:** **no** billing/receipt/renewal templates exist; the webhook sends no email on any event. But the infra is solid: React Email + Nodemailer + Lingui i18n, `mailer.sendMail`, `renderEmailWithI18N`. Closest existing pattern: `packages/email/templates/org-member-welcome.tsx`.
**Do:**
- Purchase-confirmation → trigger from `checkout.session.completed` (individual) and the new org branch (Phase 0).
- Renewal reminder → scheduled job (the `jobs.triggerJob` system exists) querying `Subscription.periodEnd` (and org equivalent) N days out. **Not** from a webhook.
- Reuse the footer/branding template-components. Low risk.

### Phase 3 — Limit alerts (approaching-limit)
**Current state:** limits resolve through `getServerLimits` → `/api/limits` → `useLimits` context. Usage is `document.count`/`template.count` for the month. No alerting.
**Do:** compute `used/quota` ratio server-side; surface an in-app banner at e.g. 80%/100% and optionally an email (reuse Phase 2 infra). Cheap once Phase 1 gives a single limit source.

### Phase 4 — Individual plan restructure: Basic $35 / Pro $45 / Dedicated $100
**Current state:** individual plans are **Stripe-metadata driven** (`REGULAR/PLATFORM/ENTERPRISE/COMMUNITY`), prices live in Stripe, rendered live in `settings+/billing.tsx` + `billing-plans.tsx` (no hardcoded prices — good).
**Pricing sanity-check / questions:**
- **Name collision:** "Pro" would exist as both an individual plan ($45 flat) *and* an org tier ($25/seat). Rename one — this will confuse support and analytics.
- **"Dedicated $100"** — clarify what it delivers. Dedicated *infrastructure* (isolated instance) at $100/mo is likely under cost; if it just means "highest limits," call it something else. This word choice implies an ops commitment.
- Since individual prices are Stripe-driven, most of this is **Stripe dashboard config + product metadata**, not code — the code change is mainly mapping new price IDs in the `get*PlanPriceIds` helpers and updating marketing copy.

### Phase 5 — Business/Enterprise per-seat
**Current state:** **two** per-seat implementations exist — legacy team seats (functional, wired: `update-subscription-item-quantity.ts` + 4 call sites recount `teamMember.count`) and org seats (`createOrUpdateOrgSubscription`, partial, **not** wired — see Phase 0).
**Do:** decide whether "Business/Enterprise" = the org-seat system (recommended, it's the newer model) and finish it on top of Phase 0. Reuse the proven quantity-sync pattern from the legacy team path. **Don't** run both seat systems for the same customer.

### Phase 6 — DMS add-on $15
**Current state:** already largely built — `DMS_ADDON_LIMITS` (`constants.ts`), `OrganizationMember.dmsAddon`, add-on line item at hardcoded `unit_amount: 1500` (`org-router.ts:645`), `dmsEnabled` gating (`dms+/_layout.tsx:19`).
**Decision needed:** **per-seat or per-org?** `org/billing.tsx` computes `buyQty * (price + dms)` — i.e. currently **$15 × every seat**, which gets expensive fast and may not be intended. Confirm and make it explicit. Otherwise this is a small phase.

### Phase 7 — AI credits  ★ largest net-new build
**Current state:** AI limits are **per-user, env-allowlist based** (`getDmsAiQueryLimit` / `NEXT_PRIVATE_DMS_AI_UNLIMITED_USERS` in `dms-ai/agent.ts`). There is **no** credit balance, ledger, metering, or top-up anywhere. This is greenfield.
**Recommended design (simpler than metered usage billing):**
- A credit **ledger** (per org, or per user — decide who owns credits) with a running balance.
- **Decrement** on each AI call at the existing centralized entry points: the DMS AI agent and `workflow.generate` (and OCR, if that should cost credits).
- **Top-up** via a Stripe **one-time "credit pack" price** (much simpler than Stripe metered/usage-based billing and avoids monthly-usage reconciliation).
- Low-balance alert reuses Phase 3.
- **Scope risk:** if you instead want true metered/usage billing, that's a significantly larger integration — flag it explicitly before committing.

### Phase 8 — Rename Signature Inbox → "Mailroom"
**Orthogonal to billing — split into its own PR.** It's user-facing string/route changes touching nav, routes under `org+/inbox*`, i18n `.po` files (`web.po` × 7 locales), and possibly email copy. Low technical risk but wide blast radius; keep it out of the billing PRs so a billing rollback doesn't drag the rename with it. Decide whether the **route path** changes (`/org/inbox` → `/org/mailroom`) or only the label — a path change needs redirects.

### Phase 9 — Deprecate `/admin/subscriptions`
**Current state:** `admin+/subscriptions.tsx` → `findSubscriptions()` (`get-all-subscriptions.ts`), a read-only `prisma.subscription.findMany` table (ID/Status/Created/Ends/UserID). Trivial to remove (route + helper).
**Refinement — replace, don't just delete.** This is the only admin visibility into subscriptions, and it's **already blind to org subscriptions** (they're not in the `Subscription` model today). If Phase 0 reunifies org billing into `Subscription` (recommended), this page becomes useful again and should be **upgraded**, not dropped. Do this **last**, after the org data lands somewhere queryable.

---

## Cross-cutting risks & gaps

- **Recipient limit is unenforced server-side** (client-only). Any plan that sells "X recipients" is currently unenforceable — fix in Phase 1.
- **`Infinity` vs `999999`** for unlimited — a latent serialization bug; standardize on `null`.
- **Webhook idempotency** — before adding org branches, confirm the handler is idempotent (Stripe retries). The org write-backs must be safe to replay.
- **Name collisions** — "Pro" (individual vs org), and "Enterprise" already means two different things (legacy Stripe `ENTERPRISE` plan vs org `ENTERPRISE` tier). Settle the taxonomy before printing prices.
- **Billing feature flag** — everything is gated on `IS_BILLING_ENABLED()`; ensure staging/dev parity so these phases are testable.

## Open decisions for you (pricing/product — your call, not mine)
1. Does org billing reunify into the `Subscription` model, or stay on `Organization.*` columns? (Recommend: reunify.)
2. Is the DMS add-on **$15/seat** or **$15/org**? (Code currently implies per-seat.)
3. What does "Dedicated $100" actually provision — dedicated infra, or just top limits?
4. Do AI credits belong to the **org** or the **individual user**? One-time credit packs, or true metered usage?
5. Does "Mailroom" change the **URL**, or just the label?
