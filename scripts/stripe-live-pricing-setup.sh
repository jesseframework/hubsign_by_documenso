#!/usr/bin/env bash
#
# LIVE-MODE counterpart of stripe-test-pricing-setup.sh — creates the exact
# same 7 Products / 14 Prices against a real Stripe account, for real
# customer checkout. Keep both scripts in sync if the pricing ladder ever
# changes; this one intentionally duplicates rather than parameterizes
# test-vs-live, so a diff between them is always visible in review rather
# than hidden behind a flag.
#
#   - Team org seats  ({type: 'org_seat', tier: 'TEAM'}) — flat rate
#   - Business/Enterprise org seats ({type: 'org_seat', tier: 'BUSINESS'|'ENTERPRISE'}) —
#     flat rate: one Price, always bought at quantity 1 regardless of headcount (see
#     `OrgTierLimits.flatRate` in packages/lib/constants/org-tiers.ts). Repositories/DMS
#     is bundled into these two for free now, not sold separately — no `org_dms` Price
#     needed for either.
#   - Signature request overage blocks for Team/Business/Enterprise
#     ({type: 'org_doc_block', tier: ...}) — see `resolveDocBlocksAvailable`/
#     `resolveDocBlockSize` in org-tiers.ts.
#   - Individual personal plan (metadata.plan = 'regular')
#
# Only the Enterprise SHARED seat variant is created here (matches the app's
# actual deployment) — Enterprise Dedicated has no priced figure anywhere in
# the pricing doc or codebase and is out of scope for this run.
#
# Review-before-run only — nothing here executes automatically. Run it
# yourself against a LIVE key:
#
#   STRIPE_API_KEY=rk_live_... ./scripts/stripe-live-pricing-setup.sh
#   STRIPE_API_KEY=sk_live_... ./scripts/stripe-live-pricing-setup.sh
#
# This script only CREATES — it never archives/deletes/deactivates existing
# Prices, live or otherwise.

set -euo pipefail

if [ -z "${STRIPE_API_KEY:-}" ]; then
  echo "Set STRIPE_API_KEY to a Stripe LIVE key (sk_live_... or rk_live_...) before running this script." >&2
  exit 1
fi

if [[ "$STRIPE_API_KEY" != sk_live_* && "$STRIPE_API_KEY" != rk_live_* ]]; then
  echo "STRIPE_API_KEY doesn't look like a live-mode key (expected sk_live_... or rk_live_...). Refusing to run against what looks like a test key — use stripe-test-pricing-setup.sh for that." >&2
  exit 1
fi

stripe_() { stripe --api-key "$STRIPE_API_KEY" "$@"; }

echo "== Team org seats — \$59/mo, \$566/yr (20% off) =="

TEAM_SEAT_PRODUCT_ID=$(stripe_ products create \
  --name "Team Org Seat" \
  -d "description=Team tier — up to 20 users, 50 signature requests/mo, no Repositories add-on." \
  -d "metadata[type]=org_seat" \
  -d "metadata[tier]=TEAM" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $TEAM_SEAT_PRODUCT_ID"

stripe_ prices create \
  -d "product=$TEAM_SEAT_PRODUCT_ID" \
  -d "unit_amount=5900" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$59.00/mo"

stripe_ prices create \
  -d "product=$TEAM_SEAT_PRODUCT_ID" \
  -d "unit_amount=56600" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$566.00/yr"

echo
echo "== Business org seats — \$199/mo flat, \$1,983/yr (17% off), unlimited members, Repositories included =="

BUSINESS_SEAT_PRODUCT_ID=$(stripe_ products create \
  --name "Business Org Seat" \
  -d "description=Business tier — unlimited members (min 2), 150 signature requests/mo, Repositories included free." \
  -d "metadata[type]=org_seat" \
  -d "metadata[tier]=BUSINESS" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $BUSINESS_SEAT_PRODUCT_ID"

stripe_ prices create \
  -d "product=$BUSINESS_SEAT_PRODUCT_ID" \
  -d "unit_amount=19900" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$199.00/mo (flat — always bought at quantity 1)"

stripe_ prices create \
  -d "product=$BUSINESS_SEAT_PRODUCT_ID" \
  -d "unit_amount=198300" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$1,983.00/yr (flat)"

echo
echo "== Enterprise org seats — \$300/mo flat, \$2,988/yr (17% off), unlimited members, Repositories included =="
echo "   (SHARED variant only — the only one the app's deployment ever looks up."
echo "   Enterprise Dedicated has no priced figure and is not created here.)"

ENTERPRISE_SEAT_PRODUCT_ID=$(stripe_ products create \
  --name "Enterprise Org Seat (Shared)" \
  -d "description=Enterprise tier, shared deployment — unlimited members (min 2), 500 signature requests/mo, Repositories included free." \
  -d "metadata[type]=org_seat" \
  -d "metadata[tier]=ENTERPRISE" \
  -d "metadata[deployment]=shared" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $ENTERPRISE_SEAT_PRODUCT_ID"

stripe_ prices create \
  -d "product=$ENTERPRISE_SEAT_PRODUCT_ID" \
  -d "unit_amount=30000" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$300.00/mo (flat — always bought at quantity 1)"

stripe_ prices create \
  -d "product=$ENTERPRISE_SEAT_PRODUCT_ID" \
  -d "unit_amount=298800" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$2,988.00/yr (flat)"

echo
echo "== Signature request blocks — Team/Business/Enterprise overage, 17% off annually =="

TEAM_DOC_BLOCK_PRODUCT_ID=$(stripe_ products create \
  --name "Team Signature Request Block" \
  -d "description=Team tier signature request block — +50 signature requests/mo, capped at 2 (150/mo total)." \
  -d "metadata[type]=org_doc_block" \
  -d "metadata[tier]=TEAM" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $TEAM_DOC_BLOCK_PRODUCT_ID"

stripe_ prices create \
  -d "product=$TEAM_DOC_BLOCK_PRODUCT_ID" \
  -d "unit_amount=2500" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$25.00/mo"

stripe_ prices create \
  -d "product=$TEAM_DOC_BLOCK_PRODUCT_ID" \
  -d "unit_amount=24900" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$249.00/yr (17% off \$25/mo)"

BUSINESS_DOC_BLOCK_PRODUCT_ID=$(stripe_ products create \
  --name "Business Signature Request Block" \
  -d "description=Business tier signature request block — +100 signature requests/mo, capped at 3 (450/mo total)." \
  -d "metadata[type]=org_doc_block" \
  -d "metadata[tier]=BUSINESS" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $BUSINESS_DOC_BLOCK_PRODUCT_ID"

stripe_ prices create \
  -d "product=$BUSINESS_DOC_BLOCK_PRODUCT_ID" \
  -d "unit_amount=4500" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$45.00/mo"

stripe_ prices create \
  -d "product=$BUSINESS_DOC_BLOCK_PRODUCT_ID" \
  -d "unit_amount=44800" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$448.00/yr (17% off \$45/mo)"

ENTERPRISE_DOC_BLOCK_PRODUCT_ID=$(stripe_ products create \
  --name "Enterprise Signature Request Block" \
  -d "description=Enterprise (shared) tier signature request block — +250 signature requests/mo, capped at 4 (1,500/mo total). Never purchasable on a dedicated deployment (already unlimited)." \
  -d "metadata[type]=org_doc_block" \
  -d "metadata[tier]=ENTERPRISE" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $ENTERPRISE_DOC_BLOCK_PRODUCT_ID"

stripe_ prices create \
  -d "product=$ENTERPRISE_DOC_BLOCK_PRODUCT_ID" \
  -d "unit_amount=3500" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$35.00/mo"

stripe_ prices create \
  -d "product=$ENTERPRISE_DOC_BLOCK_PRODUCT_ID" \
  -d "unit_amount=34900" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$349.00/yr (17% off \$35/mo)"

echo
echo "== Individual (personal) — \$15/mo, \$144/yr (20% off) =="

INDIVIDUAL_PRODUCT_ID=$(stripe_ products create \
  --name "Individual" \
  -d "description=Individual plan — 1 seat, 15 signature requests/mo." \
  -d "metadata[plan]=regular" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Product: $INDIVIDUAL_PRODUCT_ID"

stripe_ prices create \
  -d "product=$INDIVIDUAL_PRODUCT_ID" \
  -d "unit_amount=1500" \
  -d "currency=usd" \
  -d "recurring[interval]=month" \
  > /dev/null
echo "  monthly price created: \$15.00/mo"

stripe_ prices create \
  -d "product=$INDIVIDUAL_PRODUCT_ID" \
  -d "unit_amount=14400" \
  -d "currency=usd" \
  -d "recurring[interval]=year" \
  > /dev/null
echo "  yearly price created: \$144.00/yr"

cat <<'EOF'

Done. Before pointing production traffic at these:

1. If this live account already has old Basic/Pro (or any other stale)
   Prices active under `metadata.plan = 'regular'` or the old per-seat org
   metadata shapes, the app will show/consider ALL of them — archive the
   old ones first:
     stripe --api-key "$STRIPE_API_KEY" prices update <price_id> -d active=false
   (list candidates with: stripe --api-key "$STRIPE_API_KEY" prices list --limit 20)

2. This script created the Enterprise seat Price tagged `deployment=shared`
   only. Confirm the production deployment's `NEXT_PUBLIC_DEPLOYMENT_TYPE`
   is set to `shared` — otherwise `DEPLOYMENT_TYPE()` defaults to
   `dedicated` and Enterprise pricing/purchase calls will fail to find a
   match against this Price.

3. Repositories/DMS is bundled free into Business/Enterprise — no `org_dms`
   Price is created for either, by design.

4. The production `NEXT_PRIVATE_STRIPE_API_KEY`/publishable key/webhook
   secret must all be the LIVE equivalents for any of this to be reachable
   — this script only creates the Products/Prices, it doesn't wire up the
   running app's own credentials.
EOF
