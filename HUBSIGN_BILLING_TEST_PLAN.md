# Billing Roadmap — Manual UI Test Plan (Phases 0–9)

Covers everything built so far: org webhook activation + embedded checkout (0), tier/limit
consolidation + recipient enforcement (1), billing emails (2), approaching-limit warnings (3),
individual plan restructure (4), org seat tier consolidation (5), DMS add-on feature list (6),
consolidated billing home (7), self-service seat change guardrails (8), and non-optimistic
purchases with real top-up support (9) — three follow-up rounds fixing bugs found while testing
the earlier phases (Phase 5 has been rewritten twice — the org seat dropdown/checkbox UI it
originally described no longer exists).

All Stripe changes were made in **test mode** — `.env`'s `NEXT_PRIVATE_STRIPE_API_KEY` is
currently `sk_test_...`. Don't switch it to a live key while running this plan.

---

## One-time setup

1. **Start the dev server** (from repo root):
   ```
   npm run dev
   ```
   Runs on `http://localhost:3000`.

2. **Start the Stripe webhook forwarder** in a second terminal (needed for Phases 0, 2, 4, 5, 9 —
   anything that goes through a real checkout, including the admin auto-assign purchase flow in
   Phase 5c and first-time org purchases in Phase 9d):
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

1. [x] Go to `/org/billing` (create an org first if you don't have one).
2. [x] Click **Purchase Seats**. Pick **Business** tier, quantity 5 (the enforced minimum —
       try a lower number first and confirm the **Purchase** button stays disabled / shows the
       minimum-seat error).
3. [x] Click **Purchase**. Confirm the checkout form renders **inline on the same page**
       (embedded Stripe Elements — card number/expiry/CVC fields), not a redirect to
       `checkout.stripe.com`.
4. [x] Complete payment with the test card.
5. [ ] Confirm you're returned to `/org/billing` with a **"Payment successful! Your seats have
       been activated."** toast, and the new Business seat plan appears in the **Seat Plans**
       table (5 seats, $30/seat/mo shown as $150/mo).
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

1. [ ] Re-check the **Purchase Seats** tier field on `/org/billing` — should read "Business —
       $30/seat/mo (100 docs, min 5 seats)" and "Enterprise — $55/seat/mo (unlimited + DMS, min
       20 seats)". This confirms the client, server (Stripe checkout), and limit-check code are
       all reading from the same table (previously these could silently drift). Note: this is
       only a dropdown on an org with zero seat plans — see Phase 5a if you've already purchased.
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

Easiest to test on a **fresh account with no active subscription** (free plan: 5 documents, 3
direct templates per month) — the numbers are small enough to hit by hand.

**Documents** (5/month on free plan — 4/5 = 80%, lands exactly on the threshold):
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

**Direct templates**: the free plan's quota is 3, which — with only whole-number usage — never
actually lands on an 80% ratio (2/3 ≈ 67%, 3/3 = 100%), so you won't see the warning state on
the free plan no matter how many you create. To verify this alert specifically:
1. [ ] Subscribe to **Basic** ($35/mo, 5 direct templates/month — see Phase 4 below).
2. [ ] Create 4 direct template links. Open the "Enable direct link signing" dialog on a 5th
       template — confirm the blue "Approaching your direct template limit (4/5)" alert appears.
3. [ ] Create a 5th direct template link — confirm the existing hard-block alert replaces it.

---

## Phase 4 — Individual plan restructure

1. [ ] Go to `/settings/billing` on an account with no active subscription.
2. [ ] Confirm exactly **three** plan cards show: **Basic** ($35/mo), **Pro** ($45/mo),
       **Dedicated Instance** ($100/mo) — not the old Pro/Business/Enterprise names or prices.
3. [ ] Confirm each card's feature list matches:
       - Basic: 50 documents/month, up to 50 recipients/document, 5 direct signing links, email
         support.
       - Pro: 100 documents/month, up to 500 recipients/document, 20 direct signing links,
         priority email support.
       - Dedicated Instance: unlimited documents/recipients/direct links, DMS included,
         dedicated-tier priority support.
4. [ ] Toggle the interval tabs (Monthly/Yearly) — yearly should show $336/$432/$960
       respectively (20% off monthly).
5. [ ] Subscribe to **Basic** with the test card — confirm the embedded checkout flow works and
       you land back on the billing page showing you're subscribed to "Basic".
6. [ ] From an already-subscribed state, open the plan switcher and confirm you can switch
       between Basic/Pro/Dedicated Instance.

---

## Phase 5 — Org seat tier consolidation, one tier per org, admin auto-assign

This section was rewritten after testing surfaced real bugs in the original Business/Enterprise
consolidation: a DMS checkbox that granted free DMS access regardless of what the org paid for,
and no coordination between org seats and a member's existing personal plan. Fixing those led to
a bigger change: **an org can now only ever be on one seat tier at a time**, and **the purchasing
admin automatically consumes the first seat** instead of always requiring a separate manual step.

**5a. Tier picker only shows before any seats exist**
1. [ ] On a **fresh org with zero seat plans**, click **Purchase Seats** — confirm the **Plan
       Tier** field is a dropdown with exactly two options: **Business** ($30/seat/mo, 100
       docs, min 5 seats) and **Enterprise** ($55/seat/mo, unlimited + DMS, min 20 seats).
2. [ ] Purchase Business seats (qty 5+). After it completes, click **Purchase Seats** again —
       confirm the **Plan Tier** field is now a **fixed, read-only display** showing "Business —
       $30/seat/mo", not a dropdown. This is intentional: once an org has a tier, it can't switch
       by buying a different one.

**5b. One tier per org is enforced server-side**
1. [ ] While still on Business, try to purchase Enterprise seats via a direct API call or by
       editing the request in dev tools (the UI won't offer Enterprise anymore, per 5a, so this
       specifically tests the server guard, not the UI). Confirm it's rejected with a message
       like "Your organization is already on the BUSINESS plan."

**5c. Admin auto-assigned seat #1 on purchase**
1. [ ] As the purchasing **ORG_ADMIN**, before purchasing seats, subscribe yourself to an
       individual plan (e.g. Basic) via `/settings/billing` first — you want an active personal
       plan going into this step. *(Skip this step and the dialog in 5c.2 won't appear — you'll
       just get assigned seat #1 directly, which is also correct behavior, just less to check.)*
2. [ ] Purchase Business seats (qty 5+). Confirm an **AlertDialog** appears: "Cancel personal
       plan?" mentioning your active plan name/price and that purchasing will assign you seat #1
       and cancel it, crediting (not refunding) unused time. Confirm.
3. [ ] After the purchase completes, confirm the **Your Plan** card near the top of `/org/billing`
       shows you now hold a Business seat — you should NOT need to separately assign yourself a
       seat via Member Seat Assignment. Note: as of Phase 9, this assignment now happens from the
       Stripe webhook rather than instantly on click — give it a few seconds after the embedded
       checkout redirects you back before checking.
4. [ ] In Stripe test mode, confirm your personal subscription is now `canceled`, and that a
       credit (not a refund) was applied — check the customer's balance in the Stripe Dashboard.
5. [ ] Confirm the **Seat Plans** table shows 1 of 5 (or however many you bought) already
       assigned — that's you, consumed automatically.

**5d. Manual seat assignment — toggle, not dropdown**
1. [ ] In **Member Seat Assignment**, confirm each member row shows a **"Give seat"** button
       (not a tier dropdown) — there's nothing to choose since the org only has one tier.
2. [ ] Click **Give seat** for a member with **no** active personal plan — confirm it assigns
       immediately, no dialog, and the button changes to **"Remove seat"**.
3. [ ] Click **Give seat** for a member who **does** have an active personal plan (subscribe a
       test account to Basic first) — confirm the same cancel-with-credit `AlertDialog` from 5c
       appears, this time naming that member's plan. Confirm, and verify their personal
       subscription is cancelled with a credit the same way.
4. [ ] Click **Remove seat** for an assigned member — confirm it frees the seat immediately
       (available count on Seat Plans goes back up) with no dialog (removing never needs the
       cross-sell check).

**5e. DMS is derived from the seat plan, not a per-member toggle**
1. [ ] Purchase Business seats **without** the "+ DMS Add-On" checkbox. Give a seat to a member —
       confirm their badge never shows "+ DMS", and there's no control anywhere to turn it on for
       just that member (the old per-member DMS checkbox is gone entirely).
2. [ ] Purchase Enterprise seats instead (DMS is always bundled) — confirm every member given a
       seat automatically shows "+ DMS" with no separate toggle.

**5f. Migrated data still shows correctly**
1. [ ] If you have an org seat plan from much earlier testing (back when tiers were
       Starter/Pro/Enterprise), confirm it now displays as **Business** — migrated data, not a
       fresh purchase.

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
       behavior change).
3. [ ] Confirm per-seat pricing is unchanged: on `/org/billing`, purchasing Business/Enterprise
       seats with **+ DMS Add-On** checked charges **$15 × seat count**, not a flat $15 for the
       whole org (this was explicitly confirmed as the intended behavior, not changed in Phase 6).

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

**9a. Quantity defaults correctly**
1. [ ] On a fresh org (no seat plan yet), open **Purchase Seats** — confirm the quantity field
       already shows **5** for Business (or **20** for Enterprise) without needing to touch it —
       previously it defaulted to 1 and visibly jumped to the minimum on first increment.

**9b. Top-ups don't re-demand the tier minimum**
1. [ ] With an org already on 5 Business seats, open **Purchase Seats** again — confirm the
       quantity field is now labeled **"Additional seats"** (not "Quantity (min 5)") and defaults
       to **1**, with no enforced minimum.
2. [ ] Purchase 2 more seats — confirm it's accepted (previously this incorrectly demanded
       another 5).

**9c. Top-ups charge directly, no checkout screen**
1. [ ] Complete that 2-seat top-up purchase — confirm it **does not** show the embedded Stripe
       checkout at all; it should complete immediately with a "Seats purchased" toast.
2. [ ] Confirm the **Seat Plans** table now shows 7 total seats (not 5, not a second row) —
       check the Stripe Dashboard test mode to confirm this updated the *existing* subscription's
       quantity to 7 rather than creating a second $-per-month subscription.
3. [ ] If DMS wasn't enabled yet, repeat a top-up with **+ DMS Add-On** checked — confirm it adds
       a DMS line item to the existing subscription rather than failing or creating a new one.

**9d. Local state only updates after Stripe confirms (first purchase)**
1. [ ] On a brand-new org, open **Purchase Seats**, fill in a valid purchase, and click
       **Purchase** — confirm the **Seat Plans** table and **Your Plan** card do **not** update
       yet (check before submitting the embedded card form) — this is the core fix: previously
       the seat count and price increased on click, regardless of whether you ever paid.
2. [ ] Complete the embedded checkout — confirm the Seat Plans table and Your Plan card **now**
       update (may take a few seconds for the webhook to land, per the Phase 5c note above).
3. [ ] Optional: open Purchase Seats, click Purchase, and instead of paying, close/abandon the
       embedded checkout — confirm the Seat Plans table still shows nothing purchased (no
       phantom seats from the abandoned attempt).

---

## Cleanup after testing

- Stop the dev server and `stripe listen` (both `Ctrl+C`, or ask me to kill port 3000 again).
- If you set `NEXT_PRIVATE_CRON_SECRET` just for the renewal-reminder test, feel free to leave
  it — it only enables an authenticated endpoint, it doesn't change any other behavior.
- Any test subscriptions/orgs you create are in **test mode** — nothing here touches real money
  or your live Stripe account.
