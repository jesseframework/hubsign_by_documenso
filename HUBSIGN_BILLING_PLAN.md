# HubSign — Billing Plan (v2, revised)

_Updated version of Lenox's "Hubsign plan updates.md", re-scoped against the current codebase. Companion code-level analysis lives in `HUBSIGN_BILLING_ROADMAP_REVIEW.md`. Last updated 2026-07-05. Phase status added 2026-07-08 after the org-seat billing build-out, updated again same day after the Basic/Pro pricing pass and admin page removal._

---

## Status legend
- **Effort:** S (≈1 day) · M (≈2–4 days) · L (≈1 week+)
- **Risk:** Low / Med / High (production/billing sensitivity)
- ⚠️ = needs a product/pricing decision before build (see "Decisions to lock" at the bottom)
- ✅ Done · 🟡 Partially done · ⬜ Not started

## Reality check (why the order changed)
HubSign has **two separate billing systems** that don't talk to each other:
- **Individual/Team** — legacy Documenso, driven by the Stripe webhook + `Subscription` model. Individual plan limits come from **Stripe product metadata** (not code).
- **Organization (seats)** — newer HubSign system, driven by tRPC + billing columns on `Organization`. Tier limits are **hardcoded and duplicated ~4×**.

The org system has an **open loop**: a successful org checkout is never written back (the webhook ignores org subscriptions), so a paying org stays `billingStatus = inactive`. This is inserted below as **Phase 0** because Lenox's Phases 2, 4, and 5 quietly depend on it.

---

## Revised sequence

| # | Phase | Depends on | Effort | Risk | Status |
|---|-------|-----------|--------|------|--------|
| **0** | **Close the org billing loop** (NEW) | — | M | Med | ✅ Done |
| 1 | Unify tier/limit tables + enforce recipient limit | — | M | Low–Med | ✅ Done |
| 2 | Billing emails (purchase + renewal) | 0 (for org triggers) | S–M | Low | ✅ Done |
| 3 | Limit alerts (approaching quota) | 1 | S | Low | ✅ Done |
| 4 | Individual plan restructure ⚠️ | 1 | M | Med | ✅ Done (Basic/Pro only, see below) |
| 5 | Business/Enterprise per-seat ⚠️ | 0 | M–L | Med–High | ✅ Done (+ extended, see below) |
| 6 | DMS add-on $15 ⚠️ | 1 | S | Low | ✅ Done |
| 7 | AI credits ⚠️ | — | L | High | ⬜ Not started — deferred, not critical right now |
| 8 | Rename Signature Inbox → "Mailroom" | — | S–M | Low | ⬜ Not started — deferred, not critical right now |
| 9 | Replace `/admin/subscriptions` | 0 | S | Low | ✅ Done (removed rather than replaced, see below) |

Suggested grouping into releases:
- **Release A (foundation):** Phase 0 + Phase 1 — makes billing correct and the data model sane. Nothing user-visible breaks.
- **Release B (comms):** Phase 2 + Phase 3 — emails + in-app alerts.
- **Release C (pricing):** Phase 4 + Phase 5 + Phase 6 — the actual plan/price changes (needs decisions locked first).
- **Release D:** Phase 7 (AI credits) — standalone, largest build.
- **Anytime, independent:** Phase 8 (Mailroom rename), Phase 9 (admin page).

## Outstanding — not critical right now

Parked, not blocking anything currently in flight:
- **Phase 7 (AI credits).** Still fully greenfield. Needs the ownership (org vs. user) and
  metering (one-time packs vs. true usage) decisions before any code starts.
- **Phase 8 (Mailroom rename).** Needs the URL-vs-label-only decision.
- **Org plan switching** (not an original roadmap phase — surfaced this session). There's
  currently no way for an org to switch Business↔Enterprise or monthly↔yearly after first
  purchase; `purchaseSeats` explicitly blocks a tier change once one exists, and interval is
  locked by design (Part of the Phase 5/10 work). Proposed fix: a `changePlan`-style mutation
  that swaps the subscription's item price in place (same pattern as
  `packages/lib/server-only/user/update-subscription-plan.ts` already uses for personal plans),
  now cheap to build since `getOrCreateOrgPrice` already gives real, reusable Prices per
  tier×interval. Not started — proposed only, not yet confirmed as wanted.

---

## Phases

### Phase 0 — Close the org billing loop  _(NEW — prerequisite)_ — ✅ Done
**Goal:** a successful org purchase actually activates the org.
**Today:** org checkout sets `subscription metadata.type='organization'`, but no webhook branch reads it back; `billingStatus`/`stripeSubscriptionId` are never written on first purchase.
**Deliverables:**
- Webhook handles org subscriptions (`checkout.session.completed`, `subscription.updated/deleted`) → writes `stripeSubscriptionId`, `seatCount`, `billingStatus` onto `Organization`.
- Seat-quantity sync + the `stamp-router` active-billing gate start working.
- ⚠️ **Decision:** reunify org billing into the `Subscription` model (add `organizationId`) vs. keep the `Organization.*` columns. Reunifying makes Phase 9 free.
**Risk:** touches the live webhook — needs idempotency + tests.
**Shipped:** `on-org-subscription-updated.ts` / `on-org-subscription-deleted.ts`, wired into `handler.ts`. **Decision resolved as "keep `Organization.*` columns"** (not reunified into `Subscription`) — so Phase 9's "free upgrade" no longer applies; an org-aware admin view would need its own query against `Organization`/`OrgSeatPlan`, not a `Subscription` join.

### Phase 1 — Unify tier/limit tables + enforce recipient limit — ✅ Done
**Goal:** one source of truth for org tiers; close a real enforcement hole.
**Today:** STARTER/PRO/ENTERPRISE limits copied across server, tRPC, frontend, Prisma defaults, and inline UI strings — with drift (`Infinity` vs `999999`; cents vs dollars). **Recipient limits are not enforced server-side** (client-only, bypassable).
**Deliverables:**
- Single `ORG_TIERS` module (prices in cents; `null` = unlimited, drop `Infinity`/`999999`).
- Add the missing **server-side recipient check** next to the existing document-count checks.
- Keep individual limits reading Stripe metadata; document the boundary so the two aren't wrongly merged.
- Fix the inconsistent `Error` vs `AppError(LIMIT_EXCEEDED)` in the template router.
**Shipped:** `packages/lib/constants/org-tiers.ts` is now the single source (consolidated STARTER/PRO/ENTERPRISE down to BUSINESS/ENTERPRISE, sentinel unified on `ORG_UNLIMITED_SENTINEL`). Server-side recipient limit added in `recipient-router.ts` (`assertRecipientLimitNotExceeded`, throws `AppError(LIMIT_EXCEEDED)`) on both single- and bulk-recipient creation.

### Phase 2 — Billing emails — ✅ Done
**Goal:** purchase confirmation + renewal reminder.
**Today:** no billing templates exist; solid infra does (React Email + Nodemailer + i18n; `org-member-welcome.tsx` is the pattern).
**Deliverables:**
- Purchase-confirmation email from `checkout.session.completed` (individual) and the Phase 0 org branch.
- Renewal-reminder from a **scheduled job** over `periodEnd` (not a webhook).
**Shipped:** `subscription-purchase-confirmation.tsx` / `subscription-renewal-reminder.tsx` templates, job definitions + handlers under `packages/lib/jobs/definitions/emails/`, `run-due-renewal-reminders.ts`, and a cron endpoint (`api+/cron.subscription-renewals.ts`) — matches the "scheduled job, not webhook" design exactly. A migration (`add_billing_renewal_reminder_tracking`) tracks which reminders have already fired.

### Phase 3 — Limit alerts — ✅ Done
**Goal:** warn users approaching their quota (e.g. 80% / 100%).
**Today:** limits resolve via `getServerLimits` → `/api/limits` → `useLimits`; no alerting.
**Deliverables:** server-computed `used/quota` ratio → in-app banner + optional email (reuses Phase 2).
**Shipped:** `packages/ee/server-only/limits/thresholds.ts` (`LIMIT_WARNING_THRESHOLD = 0.8`, `isApproachingLimit`) + `sidebar-usage-indicator.tsx` rendering a warning state per-resource in the sidebar. No email alert was added — only the in-app banner; flag if the email half is still wanted.

### Phase 4 — Individual plan restructure ⚠️ — ✅ Done (Basic/Pro only)
**Proposed (Lenox):** Basic **$35** · Pro **$45** · Dedicated **$100**.
**Today:** individual plans are **Stripe-metadata driven** (REGULAR/PLATFORM/ENTERPRISE/COMMUNITY); prices live in Stripe, rendered live — no hardcoded prices.
**Mostly Stripe-dashboard work**, not code: create products/prices with metadata, map new price IDs in `get*PlanPriceIds`, update copy.
**Shipped:** Basic ($35/mo, $420/yr) and Pro ($50/mo — revised up from the originally proposed $45, $600/yr) as pure Stripe Product/Price config — no code changes were needed since `BillingPlans`/`settings+/billing.tsx` already render whatever's active. **Dedicated ($100) was scratched entirely** rather than resolving its naming/scope ambiguity. **Yearly is monthly × 12 with no discount** (the originally proposed 20% off was dropped). The "Pro" naming collision with the org tier's old "Pro" name is now moot — the org side was renamed to Business/Enterprise in Phase 5.

### Phase 5 — Business/Enterprise per-seat ⚠️ — ✅ Done (+ extended well beyond original scope)
**Goal:** finish the org-seat model as the Business/Enterprise offering.
**Today:** two per-seat implementations — legacy team seats (works, webhook-wired) and org seats (partial, **not** wired — Phase 0).
**Deliverables:** build on Phase 0; reuse the proven team quantity-sync pattern. Don't run both seat systems for one customer.
**Shipped, well beyond the original scope:** one seat tier per org (no mixing Business/Enterprise), admin auto-assigned seat #1 on purchase, personal-vs-org plan conflict guard (cancel-with-credit), consolidated billing UI under Organization for org members, self-service seat-change guardrails (can't touch your own seat unless you're the only eligible admin), non-optimistic purchases (local state only updates from confirmed Stripe webhooks, never on click), real top-up support (adds to the existing subscription instead of spawning a new one each time, immediate `always_invoice` charging, no duplicate Stripe items), and — just added — **yearly billing** with per-tier configurable discounts (not in the original plan at all).

### Phase 6 — DMS add-on $15 ⚠️ — ✅ Done
**Today:** largely built — `DMS_ADDON_LIMITS`, `OrganizationMember.dmsAddon`, add-on line item, `dmsEnabled` gating.
**Decision:** **$15/seat or $15/org?** Current code computes `qty × (price + dms)` → effectively **$15 per seat**. Confirm intent.
**Status:** decision resolved as **$15/seat** (code still computes `quantity × (seat + dms)`). DMS access now derives strictly from `OrgSeatPlan.dmsEnabled` (closed a free-access loophole found mid-session), and the add-on now supports both monthly and yearly pricing with its own discount.

### Phase 7 — AI credits ⚠️  _(largest net-new)_ — ⬜ Not started
**Today:** AI limits are a **per-user env allowlist** (`NEXT_PRIVATE_DMS_AI_UNLIMITED_USERS`); no balance, ledger, or metering — greenfield.
**Recommended design:** a credit **ledger** (org- or user-owned) → **decrement** at the AI entry points (DMS AI agent, `workflow.generate`, optionally OCR) → **top-up** via a Stripe **one-time credit-pack** price. Low-balance alert reuses Phase 3.
**Decision:** credits owned by **org or user**? One-time packs vs. true metered usage (much larger).
**Status:** no ledger, balance, or credit-pack code exists anywhere in the repo — untouched. Still greenfield, still the largest remaining phase.

### Phase 8 — Rename Signature Inbox → "Mailroom" — ⬜ Not started
**Orthogonal to billing — its own PR.** Touches nav, routes under `org+/inbox*`, i18n `.po` (×7 locales), maybe email copy.
**Decision:** does the **URL** change (`/org/inbox` → `/org/mailroom`, needs redirects) or only the label?
**Status:** no "Mailroom" references anywhere in the codebase — untouched.

### Phase 9 — Replace `/admin/subscriptions` — ✅ Done (removed, not replaced)
**Today:** read-only table over the `Subscription` model — **already blind to org subscriptions**.
**Do last, and replace not delete:** if Phase 0 reunifies org billing into `Subscription`, upgrade this into an org-aware admin view instead of dropping it.
**Shipped:** deliberately overrode the "replace, don't delete" guidance — since personal billing already lives at `/settings/billing` and org billing at `/org/billing`, an org-aware admin view was judged redundant rather than worth building. Route, its only-used-there helper (`get-all-subscriptions.ts`), and the sidebar nav entry were all removed.

---

## Decisions to lock (product/pricing — your call)
1. ✅ **Resolved:** org billing model kept on `Organization.*` columns (not reunified into `Subscription`).
2. ✅ **Resolved:** DMS add-on is **$15/seat**.
3. ✅ **Resolved:** "Dedicated $100" — scratched entirely, not built. Just Basic + Pro now.
4. ✅ **Resolved:** individual plan naming collision — moot, since Dedicated (the only remaining collision risk) was dropped and org tiers are already Business/Enterprise.
5. ⬜ **Still open, deferred (not critical right now):** **AI credits** — owned by **org or user**? One-time **credit packs** or **metered** usage? (Blocks Phase 7.)
6. ⬜ **Still open, deferred (not critical right now):** **"Mailroom"** — rename the **URL** or only the **label**? (Blocks Phase 8.)

## Recommended first step
**Release A = Phase 0 + Phase 1.** ✅ Done. All of Phases 0, 1, 2, 3, 4, 5, 6, and 9 are now shipped — the foundation, comms, org-seat pricing, individual pricing, and admin cleanup are all done. What's left (Phase 7 AI credits, Phase 8 Mailroom rename, and the newly-proposed org plan-switching feature — see "Outstanding" above) is explicitly parked as not critical right now, each blocked on a product decision rather than any technical work.
