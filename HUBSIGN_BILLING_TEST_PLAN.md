# Billing Roadmap — Manual UI Test Plan (Phases 0–22)

Covers everything built so far: org webhook activation + embedded checkout (0), tier/limit
consolidation + recipient enforcement (1), billing emails (2), approaching-limit warnings (3),
individual plan restructure (4), org seat tier consolidation (5), DMS add-on feature list (6),
consolidated billing home (7), self-service seat change guardrails (8), non-optimistic
purchases with real top-up support (9), yearly billing + org DMS top-up fixes (10), and the
Basic/Pro-only pricing update + admin subscriptions page removal (11) — several follow-up rounds
fixing bugs found while testing the earlier phases (Phase 4 and Phase 5 have each been rewritten
since they were first written — Phase 4's original 3-tier pricing no longer applies, and the org
seat dropdown/checkbox UI Phase 5 originally described no longer exists).

**Phases 12–22 (added later)** cover everything Phases 0–11 predate: Smart OCR metering + queue
drain, signature-request blocks, the Team org tier, annual seat pooling, the Enterprise
Shared/Dedicated split, the full section/feature-access matrix against `HubSign-Pricing-Plan.md`,
and the dedicated-instance billing-not-set-up-in-Komodo lifecycle. Where Phases 0–11 verify the
billing *plumbing*, Phases 12–22 verify the actual *numbers and gates* against what the pricing
page claims — and log every place code and doc currently disagree as a finding rather than a bug
to fix mid-run (see each phase's own notes).

All Stripe changes were made in **test mode** — `.env`'s `NEXT_PRIVATE_STRIPE_API_KEY` is
currently `sk_test_...`. Don't switch it to a live key while running this plan.

---

## One-time setup

1. **Start the dev server** (from repo root):
   ```
   npm run dev
   ```
   Runs on `http://localhost:3000`.

2. **Start the Stripe webhook forwarder** in a second terminal (needed for Phases 0, 2, 4, 5, 9,
   10, 11 — anything that goes through a real checkout, including the admin auto-assign purchase
   flow in Phase 5c, first-time org purchases in Phase 9d, yearly org purchases in Phase 10a, and
   individual plan subscriptions in Phase 4/11):
   ```
   stripe listen --api-key sk_test_<your key> --forward-to http://localhost:3000/api/stripe/webhook
   ```
   Copy the `whsec_...` it prints on startup into `.env`'s `NEXT_PRIVATE_STRIPE_WEBHOOK_SECRET`
   if it doesn't already match (it should from earlier Phase 0 testing).

3. **Test card**: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. This card always
   succeeds — no need for other test cards for this plan.

4. **Email delivery is real, not a local sandbox.** `.env`'s `NEXT_PRIVATE_SMTP_TRANSPORT` is
   set to `workhub`, which sends through a live HTTP email API — not a local Mailhog/maildev
   catcher. Phase 2 tests will send an actual email to whatever address your test account uses.
   Use an inbox you can check, or expect to verify via server logs / DB instead of an inbox if
   you'd rather not receive test mail.

---

## Phase 0 — Org billing webhook loop + embedded checkout

**Updated 2026-08-19:** steps 2 and 5 below described a purchased-*quantity* Business tier
($30/seat/mo, 5-seat minimum). Every org tier (Team, Business, Enterprise) is flat-rate now —
one price per org regardless of headcount, no quantity field, no minimum to enforce. Rewritten to
match; reset to `[ ]` since they're testing different behavior than what was originally checked
off.

1. [x] Go to `/org/billing` (create an org first if you don't have one).
2. [ ] Click **Purchase Seats**. Pick **Business** tier — confirm there's no quantity field at
       all (Business is flat-rate: one org-wide price, unlimited members, no minimum to hit).
       Confirm the **Plan Tier** dropdown lists all three tiers — **Team**, **Business**,
       **Enterprise** — since this is a fresh org with no plan yet (see Phase 5 below: once a
       tier is purchased, this dropdown becomes fixed — one tier per org, switching goes through
       Change Plan).
3. [x] Click **Purchase**. Confirm the checkout form renders **inline on the same page**
       (embedded Stripe Elements — card number/expiry/CVC fields), not a redirect to
       `checkout.stripe.com`.
4. [x] Complete payment with the test card.
5. [ ] Confirm you're returned to `/org/billing` with a **"Payment successful! Your seats have
       been activated."** toast, and the new Business seat plan appears in the **Seat Plans**
       table at its real flat price (**$199/mo**, no "/seat" suffix, no seat count in the price).
6. [x] Assign the seat to a member via **Member Seat Assignment** → click **Give seat** for one
       member (this used to be a tier dropdown — it's now a toggle button, see Phase 5 below for
       why). Confirm it assigns without error and shows the correct seat count.
7. [ ] Have that member try a feature gated on org premium (e.g. **Stamps**, if enabled in your
       build) — should now be accessible, confirming `Organization.billingStatus` really did
       flip to `active` from the webhook (not just the local seat-plan record).
8. [ ] Optional deeper check: in the `stripe listen` terminal, confirm you see
       `checkout.session.completed` (200) logged. If you have DB access, confirm
       `Organization.stripeSubscriptionId`, `stripeSeatPriceId`, `seatCount`, `billingStatus`,
       and `periodEnd` are all populated (not null) for your org.

---

## Phase 1 — Tier/limit consolidation + server-side recipient enforcement

Mostly invisible by design (a refactor + a security fix, not a new feature) — the checks here
are regression checks, not new UI.

**Updated 2026-08-19:** step 1's tier field wording ($30/seat, $55/seat, min-5/min-20) was stale
and Team was missing entirely — fixed below. The **"only a dropdown on a zero-seat-plan org" part
was already correct** and still is: one tier per org, switching happens through Change Plan (see
Phase 5's 2026-08-19 note — an earlier pass through this doc briefly described a "mixed licensing"
model instead; that's been corrected back, in code and here, to one tier per org).

1. [ ] Re-check the **Purchase Seats** tier field on `/org/billing` — should read something like
       "Team — $59/mo (up to 20 members)", "Business — $199/mo (unlimited members)", "Enterprise
       — $500/mo (unlimited members)" — no "/seat" suffix and no purchase minimum on any of the
       three (all flat-rate; the signature-request/OCR numbers in parentheses will read as your
       `QA-TEST-VALUE` shrunk figures if you're on the `qa/plan-limits-testing` branch, not the
       real 50/150/1,000). This confirms the client, server (Stripe checkout), and limit-check
       code are all reading from the same table (previously these could silently drift). The
       dropdown lists all three tiers **only on an org with zero seat plans** — confirm it becomes
       a fixed, read-only display the moment any tier is purchased (Phase 5a).
2. [ ] On any document, go to the **Add Signers** step and add recipients up to your plan's
       recipient cap — confirm the "Add signer" button still correctly disables at the cap
       (unchanged client-side behavior).
3. [ ] **Server-side enforcement isn't reachable through the normal UI** (that's the point — the
       UI already stops you before the API call). To actually verify the new server-side block,
       you need to bypass the client, e.g. via your browser's dev tools Network tab: find the
       `recipient.setDocumentRecipients` or `document.createDocumentV2` tRPC request, replay it
       with more recipients than your plan allows, and confirm you get back a `LIMIT_EXCEEDED`
       error instead of it silently succeeding. Skip this step if you don't want to dig into dev
       tools — it's a defense-in-depth fix, not something that changes normal usage.
4. [ ] Try to exceed a template's document-from-template limit (use a template to create a
       document when you're at your document cap) — should show a proper toast error now
       instead of a raw/ugly error (this was the plain-`Error`-instead-of-`AppError` fix).

---

## Phase 2 — Billing emails

**Purchase confirmation:**
1. [ ] Complete any checkout — individual (`/settings/billing`), team, or org (`/org/billing`,
       from Phase 0 above) — with a real email address you can check.
2. [ ] Check that inbox for a **"Your [Plan] plan is active"** email within a minute or two.
       Confirm it shows the correct plan name and price, and (if applicable) a renewal date.

**Renewal reminder** (this is cron-triggered — there's no button for it in the UI, so this needs
a couple of manual steps to simulate "3 days before renewal"):
1. [ ] Set `NEXT_PRIVATE_CRON_SECRET` in `.env` to any string (e.g. `test-secret-123`) and
       restart the dev server — the cron endpoint returns 503 until this is set.
2. [ ] Pick a subscription/org you completed a checkout for above. You'll need to move its
       `periodEnd` to within the next 3 days so it falls in the reminder window — either via a
       DB client or a quick script:
       ```ts
       // packages/prisma against your local DB
       await prisma.subscription.update({
         where: { planId: '<stripe subscription id>' },
         data: { periodEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
       });
       // or for an org: prisma.organization.update({ where: { id }, data: { periodEnd: ... } })
       ```
3. [ ] Trigger the scan:
       ```
       curl -X POST http://localhost:3000/api/cron/subscription-renewals \
         -H "Authorization: Bearer test-secret-123"
       ```
4. [ ] Confirm the response shows `"triggered": 1` (or more) and check the inbox for a **"Your
       [Plan] plan renews on [date]"** email.
5. [ ] Run the same `curl` a second time immediately — confirm `"triggered": 0` this time (the
       `renewalReminderSentForPeriodEnd` stamp should prevent a duplicate send for the same
       period).

---

## Phase 3 — Approaching-limit warnings (80% threshold)

**Updated 2026-08-19:** the free plan's real document quota is **3/month**, not 5 (and hasn't
been 5 for a while) — 3 whole documents never lands cleanly on an 80% ratio either (2/3 ≈ 67%,
3/3 = 100%), so the "4/5 = 80%" walkthrough below no longer works against Free as written. Use
**Individual** instead for both the document and direct-template sub-tests — its
`documents`/`directTemplates` test-mode metadata are already set to 5 each (see the "G8" gap and
its fix in the "Known gaps"/"Additional one-time setup" sections further down, before Phase 12),
so both sub-tests below work as written against a Free-tier account. Basic/Pro (referenced below
and in the original Phase 4) no longer exist — replaced by the single Individual plan; subscribe
to that instead wherever this phase says "Basic."

**Documents** (Individual's `documents=5` — 4/5 = 80%, lands exactly on the threshold):
1. [ ] Upload 3 documents this month. Hover the upload button / open the drop-zone — should
       still show plain "2 of 5 documents remaining" (not yet amber).
2. [ ] Upload a 4th document. Now confirm:
       - The upload-button tooltip text turns **amber and bold**.
       - The drag-and-drop overlay text (drag a file over the page) turns amber too.
       - On the templates list page, a **blue "Approaching your document limit"** alert banner
         appears above the table.
3. [ ] Upload a 5th document — confirm the existing **hard block** (red "Document Limit
       Exceeded!" alert, disabled dropzone) still takes over correctly, and the amber warning
       from step 2 is gone (replaced by the red block).

**Direct templates**: same problem on Free (quota of 3 never lands on 80%) — use the same
Individual test account, with its `directTemplates` metadata sized to 5:
1. [ ] Subscribe to **Individual** with `directTemplates=5` set on the test-mode product metadata.
2. [ ] Create 4 direct template links. Open the "Enable direct link signing" dialog on a 5th
       template — confirm the blue "Approaching your direct template limit (4/5)" alert appears.
3. [ ] Create a 5th direct template link — confirm the existing hard-block alert replaces it.

---

## Phase 4 — Individual plan restructure

**Updated 2026-08-19 — superseded, not just re-priced:** Basic ($35/mo) and Pro ($50/mo) don't
exist anymore at all. They were replaced by a single **Individual** plan ($15/mo, per
`HubSign-Pricing-Plan.md`) — there's nothing to switch *between* on the individual side today, so
step 6 below no longer applies to anything. Rewritten for the current one-plan lineup; see Phase
13 (further down) for Individual's actual document/recipient/OCR quota testing — this phase now
only covers the plan-card/checkout mechanics, not the numbers.

1. [ ] Go to `/settings/billing` on an account with no active subscription.
2. [ ] Confirm exactly **one** plan card shows: **Individual** ($15/mo) — no Basic, Pro, or
       "Dedicated Instance" card.
3. [ ] Confirm the card's feature list matches whatever is currently set on the Individual
       Stripe product's metadata (`documents`/`recipients`/`directTemplates`/`ocrPages` —
       see the G8 note further down: this metadata was missing entirely as of 2026-08-19 and had
       to be added by hand for testing to mean anything).
4. [ ] Toggle the interval tabs (Monthly/Yearly) — confirm the yearly rate matches whatever
       discount is currently configured on the Stripe test Price (per `HubSign-Pricing-Plan.md`
       §4, Individual should be 20% off annually — $12/mo, $144/yr — but this is Stripe-price-
       authoritative, not hardcoded, so confirm against what's actually live in test mode rather
       than assuming the doc's number is what's configured).
5. [ ] Subscribe to **Individual** with the test card — confirm the embedded checkout flow works
       and you land back on the billing page showing you're subscribed to "Individual".

---

## Phase 5 — Org seat tier consolidation, one tier per org, admin auto-assign

**Rewritten 2026-08-19 (again).** A pass through this doc on 2026-08-17 briefly described a
"mixed licensing" model — an org holding two tiers at once — because that's genuinely what the
code did at the time. **That was a product-direction error, not a stale-doc issue, and it's been
corrected in both code and here: one tier per org, full stop.** Switching tiers is the
`changePlan` flow (5g) — pick a different tier/interval, Stripe prorates the difference
immediately — never by purchasing a second tier alongside the first. `purchaseSeats` now rejects
any purchase for a tier different from the one the org already holds
(`packages/trpc/server/org-router/router.ts`, the guard right after `membership`/`org` are
resolved — look for "Your organization is already on the ... plan").

What's otherwise different from when this phase was first written, pre-dating Team and the
flat-rate consolidation:

- **Every tier is flat-rate now** (Team included) — one org-wide price, no purchased quantity,
  no minimum-seat requirement to enforce. There is no quantity input anywhere in the current
  Purchase Seats form for any tier.
- **A Change Plan / Cancel Plan flow exists per tier now** (`changePlan`/`cancelSeatPlan`
  mutations) — this postdates the original version of this phase entirely; see 5g.
- DMS is bundled free into Business/Enterprise (`dmsEnabled: true`, no charge, no checkbox) —
  see 5e. Team never gets it. (Also see **G12** further down: this bundling is supposed to be
  org-only — Individual/personal plans should still sell DMS as a real paid add-on, which is a
  distinct, not-yet-re-verified code path from the org-level bundling described here.)

**5a. Tier picker only shows before any seats exist**
1. [ ] On a **fresh org with zero seat plans**, click **Purchase Seats** — confirm the **Plan
       Tier** field is a dropdown with three options: **Team** ($59/mo, up to 20 members),
       **Business** ($199/mo, unlimited members), **Enterprise** ($500/mo shared / unlimited on
       dedicated) — no quantity field for any of them, no seat minimum.
2. [ ] Purchase Business. After it completes, click **Purchase Seats** again — confirm the **Plan
       Tier** field is now a **fixed, read-only display** showing "Business — $199/mo", not a
       dropdown. This is intentional: once an org has a tier, it can't switch by buying a
       different one — only Change Plan (5g) moves it.

**5b. One tier per org is enforced server-side**
1. [ ] While still on Business, try to purchase Team or Enterprise seats via a direct API call or
       by editing the request in dev tools (the UI won't offer another tier anymore, per 5a, so
       this specifically tests the server guard, not the UI). Confirm it's rejected with a message
       like "Your organization is already on the BUSINESS plan. Use Change Plan to switch tiers."

**5c. Admin auto-assigned seat #1 on purchase**
1. [ ] As the purchasing **ORG_ADMIN**, before purchasing seats, subscribe yourself to the
       **Individual** plan via `/settings/billing` first — you want an active personal plan going
       into this step. *(Skip this step and the dialog in 5c.2 won't appear — you'll just get
       assigned seat #1 directly, which is also correct behavior, just less to check.)*
2. [ ] Purchase a Business plan. Confirm an **AlertDialog** appears: "Cancel personal plan?"
       mentioning your active plan name/price and that purchasing will assign you seat #1 and
       cancel it, crediting (not refunding) unused time. Confirm.
3. [ ] After the purchase completes, confirm the **Your Plan** card near the top of `/org/billing`
       shows you now hold a Business seat — you should NOT need to separately assign yourself a
       seat via Member Seat Assignment. Note: as of Phase 9, this assignment now happens from the
       Stripe webhook rather than instantly on click — give it a few seconds after the embedded
       checkout redirects you back before checking.
4. [ ] In Stripe test mode, confirm your personal subscription is now `canceled`, and that a
       credit (not a refund) was applied — check the customer's balance in the Stripe Dashboard.

**5d. Manual seat assignment — toggle, not dropdown**
1. [ ] In **Member Seat Assignment**, confirm each unseated member row shows a plain **"Give
       seat"** button — no tier picker, since an org only ever holds one tier now, so there's
       nothing to choose between.
2. [ ] Click **Give seat** for a member with **no** active personal plan — confirm it assigns
       immediately, no dialog, and the button changes to **"Remove seat"**.
3. [ ] Click **Give seat** for a member who **does** have an active personal plan (subscribe a
       test account to Individual first) — confirm the same cancel-with-credit `AlertDialog` from
       5c appears, this time naming that member's plan. Confirm, and verify their personal
       subscription is cancelled with a credit the same way.
4. [ ] Click **Remove seat** for an assigned member — confirm it frees the seat immediately
       (available count on Seat Plans goes back up) with no dialog (removing never needs the
       cross-sell check).

**5e. DMS is bundled into Business/Enterprise, not offered as a checkbox on any org tier**
1. [ ] Open Purchase Seats with **Team** selected — confirm it shows plain text ("Repositories
       available on Business and up") with no checkbox at all, and no way to enable DMS for Team.
2. [ ] Open Purchase Seats with **Business** or **Enterprise** selected — confirm it shows a
       static **"Repositories included"** label (with the features hover-card), also with no
       checkbox — DMS isn't something you opt into or price separately for these tiers, it's just
       on. Give a seat to a member on either tier and confirm their badge shows "+ Repositories"
       automatically, with no per-member control to turn it off.
3. [ ] Confirm there is currently no *org* tier where a "+ DMS Add-On" checkbox actually renders
       — `dmsAddonAvailable: false` on every entry in `ORG_SEAT_TIERS` means that branch of the
       UI is dead code today for org plans specifically, not something to chase down as broken.
       (This is separate from the *personal*-plan DMS add-on, which should still be a real paid
       toggle — see G12 and Phase 6.)

**5f. Migrated data still shows correctly**
1. [ ] If you have an org seat plan from much earlier testing (back when tiers were
       Starter/Pro/Enterprise), confirm it now displays as **Business** — migrated data, not a
       fresh purchase.

**5g. Change Plan / Cancel Plan — the only way to move between tiers (new since this phase was
first written — not covered anywhere in Phases 0–11 originally)**
1. [ ] On the org's seat-plan row in the Seat Plans table, click **Change plan** — confirm a
       dialog lets you pick a **different** tier and/or billing interval, shows the new price, and
       states that switching charges/credits the prorated difference immediately and moves
       currently-assigned members to the new tier automatically. Confirm the tier dropdown
       includes the plan's own current tier too (how a pure interval-only switch is expressed).
2. [ ] Complete a tier switch (e.g. Business → Enterprise). Confirm the org ends up on exactly
       **one** row in Seat Plans afterward — the tier is renamed/moved in place, not added
       alongside the old one — and that the Stripe subscription shows the old tier's item gone,
       the new tier's item present.
3. [ ] Click **Cancel plan** on the row with assigned members — confirm the dialog warns that
       those members (including you, if you're one of them) drop to Free's limits immediately,
       names whether Repositories access is lost, and states unused time is credited not
       refunded. Confirm, and verify the row disappears from Seat Plans and every
       previously-assigned member's `seatTier` is cleared. Confirm the org can now purchase any
       of the three tiers fresh (5a) — cancelling clears the way for a completely new tier, it
       just can't coexist with one.

---

## Phase 6 — DMS add-on

**Known limitation, not a bug**: neither the individual add-ons UI (`/settings/billing`) nor
the org billing page renders a Stripe product's `description`/`features` fields today — both
only show name and price. So the marketing feature list I added
(bulk upload, OCR queue, full-text search, filing structure, favorites, approvals, retrievals,
retention, activity log, compliance templates, AI Agent base access) won't visibly appear
anywhere in the app yet. To verify it was actually set:

1. [ ] Open the [Stripe Dashboard](https://dashboard.stripe.com/test/products) (test mode) →
       find **"Document Manager Add-On"** → confirm the description and the 11 features listed
       above are present.
2. [ ] Functional check instead: on `/settings/billing`, **using an account with no org
       membership** (see Phase 7 below for why that matters now), confirm the DMS add-on still
       appears in the **Add-ons** section with the correct price, and toggling **Add**/**Remove**
       still works (this part was already built — Phase 6 only added the descriptive metadata, no
       behavior change). **This is G12** (see "Known gaps" further down): DMS bundling is only
       supposed to be free on org plans — everywhere else, including this personal/no-org path,
       it must stay a real paid add-on. This step is the actual verification of that requirement,
       not just a regression check — if the add-on doesn't fully work here, that's a product bug
       to raise, not a stale-doc note.
3. [ ] **Updated 2026-08-19 — this is now the opposite of what it says:** Business/Enterprise no
       longer sell DMS as a paid add-on at all — it's bundled free (`dmsEnabled: true`,
       `dmsAddonAvailable: false` on both, per `org-tiers.ts`). There's no "+ DMS Add-On"
       checkbox to check on `/org/billing` for either tier (see Phase 5e above) and no separate
       DMS charge, per-seat or flat. Confirm instead: purchasing Business or Enterprise shows
       **"Repositories included"** with no price delta, and the billed total on the Seat Plans
       row matches the tier's base price exactly, with nothing added for DMS.

---

## Phase 7 — Consolidated billing home + legacy bug fix

Testing surfaced that billing lived in 3 disconnected places, which read as confusing —
especially since org seat limits completely override personal billing the moment you're in an
org at all (seat or not), making a separately-visible personal billing page actively misleading
for org members.

**7a. Personal billing hides itself for org members**
1. [ ] On an account with **no org membership**, confirm `/settings/billing` works exactly as in
       Phase 4/6 (plan cards or current-plan view, Add-ons section, etc.) — nothing changed for
       non-org users.
2. [ ] Open the sidebar → **Settings** submenu — confirm a **Billing** link now appears there
       (it didn't exist as a nav item before this fix; it was only reachable via the sidebar
       usage-indicator's "Upgrade plan" link or a direct URL).
3. [ ] Join or create an org with that same account. Reload — confirm:
       - The **Billing** link under Settings is now **gone**.
       - Navigating directly to `/settings/billing` shows **"Your billing is managed by your
         organization"** with a link to `/org/billing`, instead of plan cards or a subscription
         view — regardless of whether you personally have a seat assigned yet.

**7b. "Your Plan" on the org billing page**
1. [ ] As an org member **with** a seat assigned, confirm the **Your Plan** card near the top of
       `/org/billing` shows your tier, price, and DMS status correctly.
2. [ ] As an org member **without** a seat assigned, confirm it instead shows "You don't have a
       seat assigned — ask your org admin" rather than silently looking like you have no plan at
       all.

**7c. Legacy seat-count bug fix**
1. [ ] Invite a new member to an org that already has seats purchased. In the `stripe listen`
       terminal / Stripe Dashboard, confirm the subscription's seat-item **quantity does not
       change** as a side effect of the invite — only explicit `purchaseSeats` calls should ever
       change it. (Previously, inviting or removing a member silently resynced Stripe's quantity
       to the org's total member count, which could conflict with the actual purchased amount.)
2. [ ] Remove a member who **has** a seat assigned from the org (not just unassign — fully remove
       them). Confirm the **Seat Plans** table's assigned/available counts update correctly (the
       freed seat becomes available again) — this was a related gap fixed alongside the legacy
       bug: removing a seated member previously never freed their seat at all.

---

## Phase 8 — Admins can't change their own seat (unless they're the only one)

Testing Phase 5d (giving yourself a seat back after removing it) surfaced that an admin could
freely give/remove their *own* seat via the toggle — same pattern most admin consoles avoid, to
prevent accidental self-lockout. But blocking it unconditionally created a real deadlock: a sole
admin (or one whose only other admins lack the right role) would have nobody left to ask.

1. [ ] As the **only** `ORG_ADMIN` in an org, confirm your own row in **Member Seat Assignment**
       shows an **enabled** "Give seat"/"Remove seat" button — you can still self-serve when
       there's no one else eligible to do it for you.
2. [ ] Invite a second member and promote them to `ORG_ADMIN` (or `DMS_ADMIN`, for the "give"
       direction specifically — `DMS_ADMIN` isn't eligible to remove seats, only assign them).
       Reload `/org/billing` — confirm your own row's button is now **disabled**, with a tooltip
       ("You can't change your own seat assignment — ask another admin to do it.") on hover.
3. [ ] Confirm the *other* admin **can** give/remove your seat from their own session — the
       restriction only applies to acting on your own row, not being acted on.
4. [ ] Optional deeper check: confirm a direct API call to `assignSeat`/`unassignSeat` targeting
       your own membership id is rejected server-side with `FORBIDDEN` (not just hidden
       client-side) whenever another eligible admin exists.

---

## Phase 9 — Non-optimistic purchases + real top-up support

Testing Phase 5c/5d's purchase flow surfaced three related bugs, all traced back to the same
root cause: every "Purchase Seats" click always started a **brand-new** Stripe subscription and
wrote to the local seat count **before payment was ever confirmed**.

**Rewritten 2026-08-19:** 9a/9b as originally written tested a purchased-*seat-quantity* top-up
(e.g. "5 Business seats → +2 more = 7"). That model doesn't exist anymore for any tier — Team,
Business, and Enterprise are all flat-rate now, so there's no seat quantity to default, demand a
minimum on, or top up. The one place a genuine quantity purchase still exists today is
**signature-request blocks** — reframed below against that instead. 9c/9d's underlying fixes (no
checkout screen on a same-subscription add, non-optimistic local state) are still real behavior
worth checking, just against blocks rather than seat quantity. (An earlier pass through this doc
also reframed 9c against "adding a second tier" — that's no longer a real scenario at all: one
tier per org, see Phase 5. Removed.)

**9a. Block quantity defaults correctly**
1. [ ] On an org already on a tier that sells blocks (Team, Business, or Enterprise Shared —
       see Phase 21 for full block-purchase coverage), open **Purchase Seats** — confirm the
       "+ Request blocks" quantity field defaults to **0**, not some leftover value.

**9b. A repeat purchase of the org's own tier doesn't re-demand a (non-existent) minimum**
1. [ ] With an org already on Business, open **Purchase Seats** again — confirm the Plan Tier
       field is the fixed read-only display from Phase 5a, not editable, and that submitting a
       doc-block-only purchase (0 additional seats, since there's no seat quantity to add) is
       accepted immediately with no minimum-seat error of any kind — there's none to demand,
       Business is flat-rate.

**9c. Same-subscription additions charge directly, no checkout screen**
1. [ ] With an org already on a tier, purchase a doc block on it (see Phase 21) — confirm it
       **does not** show the embedded Stripe checkout at all; it completes immediately with a
       "Seats purchased" toast, since it's modifying the org's existing subscription rather than
       starting a new one.
2. [ ] Confirm the Stripe Dashboard test mode shows the block as a line-item quantity increase on
       the **existing** subscription, not a second subscription.

**9d. Local state only updates after Stripe confirms (first-ever purchase)**
1. [ ] On a brand-new org with **no** seat plans yet, open **Purchase Seats**, fill in a valid
       purchase, and click **Purchase** — confirm the **Seat Plans** table and **Your Plan** card
       do **not** update yet (check before submitting the embedded card form) — this is the core
       fix: previously the seat count and price increased on click, regardless of whether you
       ever paid.
2. [ ] Complete the embedded checkout — confirm the Seat Plans table and Your Plan card **now**
       update (may take a few seconds for the webhook to land, per the Phase 5c note above).
3. [ ] Optional: open Purchase Seats, click Purchase, and instead of paying, close/abandon the
       embedded checkout — confirm the Seat Plans table still shows nothing purchased (no
       phantom seat plan from the abandoned attempt).

---

## Phase 10 — Yearly billing + org DMS top-up fixes

Testing the DMS top-up flow surfaced a chain of bugs (a Stripe param error, a stale metadata
flag causing DMS to silently not sync, a duplicate Stripe item, and top-ups never actually
invoicing immediately) — fixing those became the natural point to also add **yearly billing**
for org seats, since it touched the same code paths.

**Updated 2026-08-19:** 10c/10d as originally written test a "top up seats with + DMS Add-On
checked" flow. That checkbox doesn't exist for any current tier — Business/Enterprise bundle DMS
free from the moment they're purchased (no "enable it later" step), and Team never gets it at
all (see Phase 5e). Reframed below against what can actually change a member's DMS status today:
a **Change Plan** (5g) moving a tier between Team and Business/Enterprise.

**10a. Yearly billing — first purchase**
1. [ ] On a fresh org, open **Purchase Seats** — confirm a **Billing** toggle appears next to
       **Plan Tier** with **Monthly**/**Yearly** options (Monthly selected by default).
2. [ ] Switch to **Yearly** — confirm the price preview updates to the yearly rate. Pricing is
       **Stripe-price-authoritative now, not a config discount percent** (`org+/billing.tsx`'s own
       comment: "pricing is Stripe-authoritative now, so 'yearly saves X%' is whatever those two
       [live Stripe] numbers actually imply") — so confirm against the actual Stripe test Prices
       (`trpc.org.getSeatPricing`), not a formula in `org-tiers.ts` (that file holds limits, not
       prices, deliberately — see its own top-of-file comment).
3. [ ] Complete a yearly purchase — confirm the embedded checkout shows the yearly amount, and
       after completing, the **Seat Plans** table shows the tier priced `/yr` with a "Yearly"
       badge.

**10b. Interval is locked after first purchase, org-wide**
1. [ ] With a tier already purchased (either interval), open **Purchase Seats** again — confirm
       **Billing** is now a fixed, read-only display (Monthly or Yearly, whichever you bought),
       not a toggle — a subscription can't mix monthly and yearly items.
2. [ ] Purchase a doc block on the org's existing tier — confirm it charges at the same interval
       as the org's first purchase, no option to switch (a **Change Plan**, 5g, does let you
       switch interval deliberately — that's the one exception, covered in 10c below).

**10c. Change Plan doesn't leave duplicate Stripe items behind**
1. [ ] Use **Change plan** (5g) to move a tier from **Team** (no DMS) to **Business** (DMS
       bundled) — confirm it completes without error, and the Stripe Dashboard test mode shows
       the subscription now has exactly the Business seat item, with the old Team item removed
       (not both, not a stray duplicate).
2. [ ] Confirm the displayed price is **consistent everywhere** afterward: the **Your Plan** card,
       the **Seat Plans** row, and (if you reopen Purchase Seats) the tier's summary line in the
       dropdown should all agree on the new Business price — not a stale Team number in one place.
3. [ ] Confirm the change is charged/credited **immediately** (no waiting for next billing cycle)
       — check Stripe Dashboard test mode for a prorated invoice right after confirming, not just
       a pending/draft line item.

**10d. `dmsAddon` stays in sync for every already-seated member, not just whoever triggered it**
1. [ ] Set up an org with **two or more members already assigned** to a tier, then use **Change
       Plan** to move that tier from Team to Business (or vice versa). Confirm **every** affected
       member's badge in **Member Seat Assignment** updates to reflect the new DMS status — not
       only the admin who clicked Change Plan — matching `onOrgSubscriptionUpdated`'s own doc
       comment ("keep every member currently on this tier in sync... not just whoever triggered
       this particular sync").

**10e. Purchase confirmation email fires on every billed change, not just the first purchase**
1. [ ] Complete a follow-up purchase on an org that already has billing set up — a doc block
       (Phase 21) works — with real email delivery per the one-time setup note above. Confirm you
       receive the "Your [Plan] plan is active" email showing the **updated** price — previously
       this email only fired on an org's very first purchase.
2. [ ] Confirm giving/removing a seat via **Member Seat Assignment** does **not** send this email
       — only an actual purchase (which changes what's billed) should trigger it.

---

## Phase 11 — Admin subscriptions page removed

Individual plan pricing is now covered by the updated **Phase 4** above (Basic/Pro no longer
exist — see Phase 4's 2026-08-19 note) — this phase is just the admin page removal.

1. [ ] As an admin, open the sidebar — confirm there is **no** "Subscriptions" link under the
       Admin section (Stats/Users/Documents/Leaderboard/Site Settings should still all be there).
2. [ ] Navigate directly to `/admin/subscriptions` — confirm it 404s rather than showing the old
       read-only subscriptions table.

---

## Known gaps to expect in Phases 12–22 (read first)

Three research passes over the actual enforcement code (not just `HubSign-Pricing-Plan.md`)
turned up real behavioral gaps that change what "pass" means for several cases below. Listed
here so nobody reports them as new bugs mid-run — they're the reason certain phases exist.

| # | Gap | Where | What it means for testing |
|---|---|---|---|
| G1 | Most pricing-doc "differentiators" are actually universal — Workflow Builder, Business Rules, SSO (OIDC), custom domain field, webhooks, public API, Zapier, Teams integration, SLA tracking, custom branding, Signature Inbox are reachable on **every tier including Free**, gated only by org role, never by plan. | `nav-config.tsx`, `workflow-router`, `business-rule-router`, `inbox-router`, `org-router`'s `updateOrgSettings` | Phase 17 tests these as "confirm still ungated" — a pass here means "matches current code", not "matches the pricing page". |
| G2 | API key creation and embedding document/template creation have **zero** plan gating — any Free user can do both today. | `api-token-router/router.ts`, `embedding-router/create-embedding-*.ts` | The doc's "API only (Individual) / Yes (Business+)" column cannot pass as written — Phase 17 documents this as-is. |
| G3 | The embedding *presign token* and *signing iframe* ARE gated, but by a legacy Documenso Community/Platform/Enterprise Stripe-price check, unrelated to the new org tiers. `EmbedPaywall` is a bare `<h1>Paywall</h1>` stub. | `create-embedding-presign-token.ts`, `sign.$url.tsx`, `embed-paywall.tsx` | Don't test this against org tier — test it against whatever legacy Stripe plan is configured, and flag the stub UI. |
| G4 | Custom domain and custom SMTP have **no functional implementation** at all — `domain` is a stored-but-unused field, SMTP is one global sender for the whole deployment. | `HubSign-Feature-Catalog.md` §2 | Nothing to test in-app for these — Dedicated's "custom domain, SSO, SMTP" claim is infra-level ops work, not app behavior. Note in Phase 18 and move on. |
| G5 | The org-level billing status has **no UI banner at all** (unlike the legacy Team model, which has `TeamLayoutBillingBanner`). `Organization.billingStatus` is checked in exactly two places: the stamps feature gate and license-key redemption. | `team-layout-billing-banner.tsx` (exists), no org equivalent | Phase 20's past-due/cancelled tests will show *no visible warning* — that's the current behavior to confirm, and the direct answer to "does the user get a banner": **no, not for orgs.** |
| G6 | Cancelling an org's Stripe subscription (`onOrgSubscriptionDeleted`) clears `billingStatus`/`stripeSubscriptionId`/`seatCount` but does **not** clear members' `seatTier` or delete the `OrgSeatPlan` row. `getOrgSeatLimits` never reads `billingStatus` — only `seatTier`. | `on-org-subscription-deleted.ts`, `limits/server.ts` | A cancelled-via-Stripe org may keep full paid-tier quota indefinitely. Phase 20 tests this explicitly — expect it to fail the "access is revoked" assumption. |
| G7 | `getServerLimits` short-circuits to fully unlimited (`SELFHOSTED_PLAN_LIMITS`) for **everyone** whenever `NEXT_PUBLIC_FEATURE_BILLING_ENABLED` is off — no restriction, no warning, at all. The moment it flips on, anyone with no assigned seat drops straight to Free limits (3 docs/mo) with **no grace period and no banner**. | `limits/server.ts:181-190`, `dms+/_layout.tsx` | This is the direct answer to the dedicated-instance-billing question — see Phase 22. |
| G8 | The Individual ($15/mo) Stripe test/live product is created by `scripts/stripe-*-pricing-setup.sh` with only `metadata[plan]=regular` — no `documents`/`recipients`/`directTemplates`/`ocrPages` keys. `ZLimitsSchema` defaults missing fields to `0`. | `stripe-test-pricing-setup.sh:218-222`, `limits/schema.ts` | If nobody has set this metadata by hand in the Stripe dashboard, purchasing Individual grants **zero** quota — Phase 13 checks this first, before assuming the 15/mo number works. |
| G9 | `sendDocument` (the actual "Send" action, sets `sentAt`) never re-checks quota — only document/template *creation* does. Usage is counted by `sentAt`, so a document created under quota can be sent later even if the org's quota was consumed elsewhere in between. | `document-router/router.ts` (`createDocument` checks; `sendDocument` doesn't) | Phase 12 includes one test for this specific ordering. |
| G10 | The OCR queue-drain cron (`/api/cron/ocr-queue-drain`) is not wired into any scheduler in `render.yaml` — it only runs if something calls it. | `apps/remix/app/routes/api+/cron.ocr-queue-drain.ts` | Phase 16's drain test triggers it manually via `curl` with `NEXT_PRIVATE_CRON_SECRET` — don't wait for it to fire on its own. |
| G11 | "Team" is an overloaded name in code: `ORG_SEAT_TIERS.TEAM` (the new $59/mo org tier under test here) vs. `TEAM_PLAN_LIMITS` (a legacy, unrelated, all-`Infinity` per-team subscription limit). | `limits/constants.ts` vs `org-tiers.ts` | Make sure every "Team" test case below is against an **org** on the `TEAM` seat tier, not a legacy Documenso Team. |
| G12 | **Product requirement, flagged 2026-08-19, not yet verified either way:** DMS ("Repositories") bundling should apply **only to org plans** (Business/Enterprise — free, no separate charge). For every *other* plan (Individual, and any personal/no-org context) DMS must remain a **paid add-on**, not bundled and not simply unavailable. The personal add-on's infrastructure still exists in code (`subscription-addons.tsx`, `toggleSubscriptionAddon`, `STRIPE_PLAN_TYPE.DMS` in `settings+/billing.tsx`), but it hasn't been re-verified since the org side moved to bundled-free — confirm it still actually works end to end (price shows, Add/Remove toggles, `dmsEnabled` flips) rather than assuming Phase 6's original pass still holds. | `apps/remix/app/components/general/subscription-addons.tsx`, `packages/lib/server-only/user/toggle-subscription-addon.ts`, `apps/remix/app/routes/_authenticated+/settings+/billing.tsx` | Phase 6 already exercises this — treat its steps 1–2 as the primary verification of this gap, not just a regression check. If it's broken, this is a real fix, not just a stale-doc issue like G1–G11. |

## Additional one-time setup for Phases 12–22

1. **Test environment is already prepared** on the `qa/plan-limits-testing` branch: the hardcoded
   quotas in `packages/lib/constants/org-tiers.ts` have been shrunk (search for `QA-TEST-VALUE`
   to see every change and its real value) so caps are reachable by hand in one sitting, and
   `.env.local`'s `NEXT_PRIVATE_CRON_SECRET` has been set for Phase 16's manual drain trigger.
   `NEXT_PUBLIC_FEATURE_BILLING_ENABLED=true` and `NEXT_PUBLIC_DEPLOYMENT_TYPE=shared` were
   already set. **Never merge this branch** — it exists only to run Phases 12–22 against.
2. **G8 already fixed.** Confirmed real, not a false alarm — the Individual product
   (`prod_V4s3XbkqCdtAQn`) had only `metadata.plan=regular`, no quota keys, meaning a real
   Individual purchase granted `documents: 0` (`ZLimitsSchema`'s missing-field default) instead
   of any usable quota. Fixed via the Stripe CLI: added `documents=5`, `recipients=10`,
   `directTemplates=5`, `ocrPages=15`, `period=month` (test-sized; the real ones are 15/mo per
   the pricing doc) to that product's existing metadata, `plan=regular` untouched.
   `documents`/`directTemplates` were both deliberately set to **5** rather than two different
   small numbers — Phase 3's approaching-limit-warning walkthrough needs a round 5 to land exactly
   on the 4/5 = 80% threshold, and Phase 13 doesn't care about the specific value, just that it's
   small and non-zero, so there was no reason to fight that. Nothing further needed before Phase
   3 or 13 — this was a genuine production-test-mode gap, not just a testing convenience, so flag
   it to the team for a real-numbers fix outside this branch too.
   **Also noticed while in there**: a stale **Basic** product (`prod_UoaYzbvK97rPFW`, `documents:
   50` etc.) is still active from the pre-Individual pricing model that Phase 11 above was
   supposed to retire — `handleUserLimits` picks "the subscription with the highest quota" across
   *all* active subscriptions, so if a test account ever ends up with both Basic and Individual
   active, Basic's stale 50-doc quota silently wins over Individual's real one. Not touched here
   (archiving Prices is a bigger, separate action) — worth a deliberate cleanup pass.
3. Phases 18 and 22 require flipping `NEXT_PUBLIC_DEPLOYMENT_TYPE` / `NEXT_PUBLIC_FEATURE_BILLING_ENABLED`
   in `.env.local` and restarting the dev server — `env()` reads `process.env` at request time but
   the value is captured at process start, so a restart is required for either to take effect.

---

## Phase 12 — Free tier limits

Free is not org-based — it's what an account with no org membership and no active subscription
gets from `FREE_PLAN_LIMITS`.

1. [ ] On a fresh account with no org and no subscription, confirm the sidebar usage indicator
       shows **3 documents/mo**, **30 Smart OCR pages/mo** (Free's real values — not shrunk, see
       setup step 1).
2. [ ] Create and send 3 documents this month. Confirm the 4th attempt is blocked with the
       existing "Document Limit Exceeded" UI (same hard-block already verified in Phase 3 above —
       just confirm the number is still 3, not something else).
3. [ ] Confirm recipient cap is 10/document (add signers up to 10, confirm the 11th is blocked
       client-side; per Phase 1 above, also replay the tRPC call with 11+ via dev tools to confirm
       the server-side block too).
4. [ ] Confirm direct template cap is 3.
5. [ ] Upload/process documents to exhaust the 30-page OCR allowance (any DMS/inbox/attachment
       OCR trigger). Confirm OCR soft-stops — signing and existing search keep working, new OCR
       queues (see Phase 16 for the full soft-stop/queue/warning behavior, tested once in depth
       there rather than repeated per tier).
6. [ ] **G9 check**: create a document while exactly 1 signature request remains, but don't send
       it yet. Have a second Free account (or use up the quota another way) confirm the quota is
       exhausted. Now send the first document — confirm it succeeds (matching G9: send is never
       re-checked) rather than failing at send time.

---

## Phase 13 — Individual ($15/mo) tier limits

1. [ ] Complete the Stripe metadata prerequisite in setup step 2 above first — this phase is
       meaningless without it (confirms/refutes G8).
2. [ ] Subscribe a test account to Individual with the test card.
3. [ ] Confirm the sidebar usage indicator now shows the metadata-configured quota (5 in the test
       setup above), not still 3 (Free) and not 0 (the G8 failure mode).
4. [ ] Repeat the document/recipient/template cap checks from Phase 12 against Individual's
       numbers.
5. [ ] Confirm Individual's OCR allowance reflects the `ocrPages` metadata value, not Free's 30.

---

## Phase 14 — Team org tier ($59/mo) limits + 20-seat guardrail

Use the real "Purchase Seats" UI + Stripe test card (per Phase 0/5's pattern above), not direct
DB seeding — there's no existing seed helper for `OrgSeatPlan` and the UI flow is already proven
to exercise the real webhook path.

1. [ ] Purchase Team org seats. Confirm quota shows the shrunk `documents`/`ocrPages` values
       (5/10 — see the `QA-TEST-VALUE` comments in `org-tiers.ts`), and DMS is **not** available
       (`dmsEnabled: false` — confirm `/dms` shows the upgrade-prompt card, not the module).
2. [ ] Hit the document cap; confirm the hard block.
3. [ ] Hit the OCR cap; confirm soft-stop/queue (full depth in Phase 16).
4. [ ] **20-user guardrail**: invite/assign seats up to 20 members. Confirm the 21st
       `assignSeatToMember` call is rejected ("All seats are assigned. Purchase more seats.") —
       per the pricing doc this is a guardrail, not a billing meter, so confirm no additional
       Stripe charge happens when you hit it (unlike Business/Enterprise's flat billing, Team's
       quantity is fixed at 20 regardless of how many are actually assigned).
5. [ ] Confirm Team is genuinely flat-rate: assigning fewer or more (up to 20) members doesn't
       change the Stripe subscription amount.

---

## Phase 15 — Business ($199/mo) tier limits

1. [ ] Purchase Business org seats. Confirm quota shows the shrunk values (8 documents, 15 OCR
       pages — see `QA-TEST-VALUE` in `org-tiers.ts`).
2. [ ] Confirm DMS ("Repositories") **is** enabled and bundled free — no separate charge, no
       `org_dms` line item on the Stripe subscription (per the current code, DMS add-on selling is
       disabled tier-wide: `dmsAddonAvailable: false` everywhere).
3. [ ] Confirm min-2-seats behavior: since Business is `flatRate`, confirm the UI doesn't demand
       a purchase-quantity minimum the way a purchased-quantity model would (this should already
       match Phase 9a/9b's coverage above — just confirm it still holds with the current tier).
4. [ ] Hit the document/OCR caps; confirm hard block / soft-stop respectively.

---

## Phase 16 — Smart OCR metering, soft-stop, queue drain, 80%/100% warnings (tested once, in depth)

Run this on whichever org you have from Phase 14 or 15 — the mechanism is identical across tiers,
so this is the one place to verify it thoroughly rather than repeating per tier.

1. [ ] Process OCR pages up to 80% of the org's allowance (via DMS upload, inbox email, or a
       signing-flow attachment — all three share one org-wide pool, confirm this by triggering
       OCR from two different sources and seeing them draw from the same counter).
2. [ ] Confirm the amber "approaching limit" warning appears (sidebar usage indicator turns
       amber) at 80%, not before.
3. [ ] Exhaust the allowance. Confirm:
       - New OCR requests **queue** (an `OrgOcrUsage` row with `status: QUEUED`) rather than
         erroring.
       - Signing, document upload, and search on already-processed content all keep working —
         nothing else breaks.
       - The affected document shows the "Smart OCR paused — no pages left this period" inline
         notice with an upgrade link (`org+/inbox.$id.tsx`).
4. [ ] Manually trigger the drain job (G10 — it's not on any scheduler):
       ```
       curl -X POST http://localhost:3000/api/cron/ocr-queue-drain \
         -H "Authorization: Bearer qa-plan-limits-testing-secret"
       ```
       Before running: free up quota (new month, or a block purchase — see Phase 21) or the drain
       will correctly no-op. Confirm the queued item processes and its `OrgOcrUsage` row updates
       to `PROCESSED` in place (not duplicated).
5. [ ] Confirm draining is oldest-first and stops as soon as one item doesn't fit the freed-up
       quota (rather than draining everything regardless of size).

---

## Phase 17 — Section/feature access matrix (the doc-vs-code reconciliation)

For each row, test on a Free account (no org) unless noted — the point is confirming G1/G2/G3
hold as described, not re-deriving them.

| Feature | Expected per pricing doc | Actual (per G1–G3) | Test |
|---|---|---|---|
| Workflow Builder | Business+/gated | Universal | [ ] Confirm a Free-tier account can create and run a workflow. |
| Business Rules Engine | Not mentioned in pricing doc | Universal | [ ] Confirm accessible on Free. |
| Signature Inbox | Not mentioned in pricing doc | Universal (org-membership only) | [ ] Confirm any org member can access `/org/inbox` regardless of org's seat tier. |
| SSO (OIDC) | Enterprise Dedicated only | Self-service on any tier, `ORG_ADMIN` only | [ ] As `ORG_ADMIN` on a **Free/no-tier** org, confirm you can enable OIDC SSO in Org Settings with zero tier check. |
| Custom domain field | Enterprise Dedicated only | Settable on any tier, no functional effect (G4) | [ ] Confirm the field is settable on any tier; confirm nothing actually routes to it. |
| Custom SMTP | Enterprise Dedicated only | Doesn't exist as a feature (G4) | [ ] Confirm there is no per-org SMTP config UI anywhere. |
| API key creation | Individual: API only; Free/Team: no; Business+: yes | Universal, zero gating | [ ] Confirm a Free account can create an API token. |
| Embedding (create doc/template via API) | Same column as API | Universal, zero gating | [ ] Confirm a Free account's API token can create an embedding document. |
| Embedding (presign token / signing iframe) | Same column as API | Gated by legacy Community/Enterprise Stripe plan, unrelated to org tier | [ ] Confirm this is gated by the *legacy* plan check, not by org seat tier — attempt with an org on Enterprise seat tier but no legacy Stripe Enterprise price attached, confirm it's still blocked (`EmbedPaywall` stub). |
| DMS (Repositories) | Business+/Enterprise only | **Correctly gated** — the one feature that matches the doc | [ ] Confirm Free/Individual/Team all show the upgrade-prompt card at `/dms`, and confirm the `dmsEntitledMiddleware` tRPC guard (not just the UI) rejects a direct API call — replay a `dms.*` tRPC request via dev tools from a non-entitled account, confirm `FORBIDDEN`. |
| Webhooks, Public API v1, Zapier, Teams integration, custom branding, SLA tracking, custom reporting | Not explicitly fenced in pricing doc | Universal | [ ] Spot-check 2–3 of these on Free to confirm still accessible (lower priority than the rows above — these were never claimed as fenced). |

---

## Phase 18 — Enterprise Shared vs. Enterprise Dedicated

1. [ ] With `NEXT_PUBLIC_DEPLOYMENT_TYPE=shared` (restart required), purchase Enterprise org
       seats. Confirm quota resolves to the shrunk shared values (10 documents, 20 OCR pages —
       not `null`/unlimited).
2. [ ] Confirm the Enterprise seat *price* purchased matches the Stripe Price tagged
       `metadata.deployment=shared` (per `get-org-seat-price.ts`), not a dedicated one.
3. [ ] Purchase blocks up to `maxDocBlocks` (4); confirm the 5th is rejected with the ceiling
       error message.
4. [ ] Flip `NEXT_PUBLIC_DEPLOYMENT_TYPE` to unset (or `dedicated`) and restart. On the same or a
       new Enterprise org, confirm `documents`/`ocrPages` now resolve to unlimited (`null` →
       `Infinity`), and confirm the block-purchase UI **disappears entirely**
       (`resolveDocBlocksAvailable` returns false once `documents` is unlimited — nothing to
       overage past).
5. [ ] Confirm G4: no custom-domain routing or per-org SMTP exists to test — note this rather
       than search for UI that isn't there.

---

## Phase 19 — Annual pooling

1. [ ] Purchase any org tier (Team/Business/Enterprise Shared) with **Yearly** billing. Confirm
       the sidebar shows the full year's pool (shrunk monthly value × 12), not the monthly figure.
2. [ ] Confirm the usage window anchors to `periodStart`/`createdAt`, not the calendar month —
       consume some quota, wait past a calendar month boundary (or adjust `periodStart` via
       Prisma directly, same technique as Phase 2's renewal-reminder test above), and confirm
       remaining quota does **not** reset until the actual annual anniversary.
3. [ ] Purchase a doc block on an annual plan; confirm the block's contribution is also pooled
       ×12 (block size × 12), not just the base tier quota.
4. [ ] **Mid-term upgrade check** (pricing doc §2 "two rules to settle"): exhaust most of an
       annual pool, then upgrade tier via `changePlan`. Confirm the new tier's allowance starts
       fresh (via `forcePeriodStartReset`) rather than prorating the remainder — matches the
       pricing doc's stated intent, worth confirming it's actually implemented that way.

---

## Phase 20 — Org billing status lifecycle (past-due, cancelled) — org vs. team banner gap

1. [ ] Get an org to `PAST_DUE` (Stripe test mode: use a card that requires authentication and
       don't complete it, or manually fail a renewal in the Stripe dashboard). Confirm **no
       banner appears anywhere in the org UI** (G5) — this is the expected/current behavior, not
       a test failure to chase down.
2. [ ] Compare against a legacy **Team** (not org) in the same state — confirm the yellow "Payment
       overdue" banner **does** appear there, demonstrating the org/team inconsistency directly.
3. [ ] Cancel an org's Stripe subscription entirely (`customer.subscription.deleted`, e.g. via
       the Stripe test dashboard, not the in-app cancel flow). Confirm `Organization.billingStatus`
       flips to `inactive` (check via `/org/billing` or DB).
4. [ ] **G6 check**: immediately after cancellation, confirm whether members still assigned a
       `seatTier` can still create documents up to the old tier's quota. Expect this to succeed
       (the gap) — document it as a finding rather than assuming it's already fixed.
5. [ ] Confirm stamps (the one feature that *does* check `billingStatus`) correctly become
       `FORBIDDEN` immediately on cancellation, even though document/OCR quota doesn't (the two
       enforcement paths are inconsistent with each other by design today).

---

## Phase 21 — Buying add-ons (signature request blocks)

1. [ ] On Team, Business, and Enterprise Shared orgs (three separate checks — Enterprise
       Dedicated sells no blocks per G4/Phase 18), purchase one block each. Confirm the price
       shown matches `resolveDocBlockSize`'s $/block for that tier, and that the effective
       document quota increases by exactly `docBlockSize` (shrunk test value).
2. [ ] Purchase up to each tier's `maxDocBlocks` ceiling (Team 2, Business 6, Enterprise Shared
       4 — ceilings unchanged even though sizes were shrunk). Confirm the next purchase attempt
       is rejected both client-side (button disabled) and server-side (replay via dev tools,
       confirm `BAD_REQUEST`).
3. [ ] Confirm blocks stack correctly with an already-purchased quantity (buy 1, then top up 1
       more — confirm the Stripe subscription's `org_doc_block` line item quantity updates to 2
       rather than creating a duplicate line item, matching Phase 10c's DMS-top-up precedent
       above).
4. [ ] Confirm annual-plan blocks pool ×12 (covered in Phase 19.3 — cross-reference rather than
       repeat if already done).
5. [ ] Note for the record: there is no OCR-page block add-on yet (pricing doc's own open
       question #5 — "still to be confirmed") and DMS is no longer sold as a separate add-on
       (`dmsAddonAvailable: false` everywhere) — nothing to test for either, by design.

---

## Phase 22 — Dedicated instance + billing-not-set-up-in-Komodo scenario

This is the direct test of "what happens to a dedicated account with billing not set up in
Komodo, then turned on afterward." Simulated locally — no real second Komodo stack needed, since
the behavior is entirely driven by `NEXT_PUBLIC_FEATURE_BILLING_ENABLED` (G7), which is identical
code whether it's running on `localhost` or a real dedicated Komodo stack (Komodo itself has no
billing logic — it's purely an external deploy tool).

**22a. Billing never set up (the "before" state)**
1. [ ] Set `NEXT_PUBLIC_FEATURE_BILLING_ENABLED` to blank/unset, `NEXT_PUBLIC_DEPLOYMENT_TYPE`
       unset (defaults to `dedicated`, matching a real dedicated deployment). Restart.
2. [ ] As any user (new signup, no org, no subscription), confirm you have **fully unlimited**
       access: unlimited documents/recipients/templates, unlimited OCR, DMS enabled — with **no
       banner, no warning, no indication anything is unusual**. This directly answers "do users
       lose immediate access" — the opposite is true: they have *more* access than any paid tier,
       silently.
3. [ ] Confirm the Stripe webhook endpoint actively refuses requests (returns HTTP 500 "Billing
       is disabled") if you point `stripe listen` at it anyway — confirms billing infrastructure
       is fully inert, not just quota-unenforced.
4. [ ] Confirm `/org/billing`'s "Manage billing" / "Setup billing" actions no-op
       (`{ url: null, message: 'Billing is not enabled' }`) rather than erroring or crashing.

**22b. Billing turned on afterward (the "after" state)**
1. [ ] Flip `NEXT_PUBLIC_FEATURE_BILLING_ENABLED=true`. Restart (this is the equivalent of ops
       updating the env var on a real Komodo stack and redeploying/restarting the container).
2. [ ] **Without** granting any org/user a seat tier or subscription, confirm the same
       previously-unlimited user now immediately shows **Free tier limits** (3 docs/mo) — no
       grace period, no transition window.
3. [ ] Confirm there is **no proactive notification of any kind** — no banner, no email, no toast
       — telling the user their access just changed. The only way to discover it is hitting the
       new, much lower cap on the next document/template creation attempt, or checking the sidebar
       usage indicator (which now shows real numbers instead of being absent/infinite).
4. [ ] Confirm existing documents remain fully visible and manageable, and login is never blocked
       — the drop only affects *new* document/recipient/template creation (per G7's mechanism —
       it's a quota check at creation, not an access-control check at the account level).
5. [ ] Confirm the **license-key path** as the intended non-Stripe remedy for this exact scenario:
       mint a license key (superadmin-only, per `redeem-license-key.ts`), redeem it as the org
       admin, confirm the org immediately jumps to the granted tier's quota. Let it pass
       `LICENSE_GRACE_DAYS` (7) past its `expiresAt` (backdate via Prisma to speed this up rather
       than waiting a week) and confirm it fails closed back to Free — again with no expiry
       warning banner, matching G7's "no proactive notice" pattern throughout this whole area.

**22c. Write up the answer**
1. [ ] Summarize for the team: *"Billing not set up" on a dedicated instance means fully open,
       unlimited access with zero indication anything is unconfigured. The moment billing is
       switched on, anyone without a manually-assigned seat or license key drops straight to Free
       limits with no grace period and no banner — silent in both directions.* Flag whether this
       silence (in either direction) is acceptable product behavior for a real customer
       transition, or whether it's worth a follow-up ticket (e.g., a startup banner when
       `IS_BILLING_ENABLED()` is false, or a grace period + warning when it flips on with orgs
       that have no seat).

---

## Cleanup after testing

- Stop the dev server and `stripe listen` (both `Ctrl+C`, or ask me to kill port 3000 again).
- If you set `NEXT_PRIVATE_CRON_SECRET` just for the renewal-reminder test, feel free to leave
  it — it only enables an authenticated endpoint, it doesn't change any other behavior.
- Any test subscriptions/orgs you create are in **test mode** — nothing here touches real money
  or your live Stripe account.
- **After Phases 12–22 specifically**: discard the `qa/plan-limits-testing` branch entirely —
  never merge the `QA-TEST-VALUE`-tagged edits in `org-tiers.ts`. Revert `.env.local`'s
  `NEXT_PUBLIC_DEPLOYMENT_TYPE`/`NEXT_PUBLIC_FEATURE_BILLING_ENABLED` to their pre-Phase-18/22
  values if you changed them mid-run. If you added test metadata to the Stripe Individual
  product for G8 and it wasn't there originally, decide with the team whether to leave it (it's
  currently a real gap in production test mode, not just a testing convenience) or revert it.
