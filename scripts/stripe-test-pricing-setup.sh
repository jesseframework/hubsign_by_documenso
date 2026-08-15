#!/usr/bin/env bash
#
# Creates the Stripe TEST MODE Products/Prices the new pricing ladder code
# expects to find by metadata:
#   - Team org seats  ({type: 'org_seat', tier: 'TEAM'}) — per-seat, purchased quantity
#   - Business/Enterprise org seats ({type: 'org_seat', tier: 'BUSINESS'|'ENTERPRISE'}) —
#     flat rate: one Price, always bought at quantity 1 regardless of headcount (see
#     `OrgTierLimits.flatRate` in packages/lib/constants/org-tiers.ts). Repositories/DMS
#     is bundled into these two for free now, not sold separately — no `org_dms` Price
#     needed for either.
#   - Individual personal plan (metadata.plan = 'regular'), replacing Basic/Pro
#
# Review-before-run only — nothing here executes automatically, and nothing
# here touches production. Run it yourself against a TEST secret key:
#
#   STRIPE_API_KEY=sk_test_... ./scripts/stripe-test-pricing-setup.sh
#
# Requires the Stripe CLI (`brew install stripe/stripe-cli/stripe`, or see
# https://stripe.com/docs/stripe-cli). Every dollar figure below matches the
# pricing doc (HubSign-Pricing-Plan.md) and the app's `org-tiers.ts` /
# `matchOrgPrice` lookups in `packages/lib/server-only/stripe/get-org-seat-price.ts`.
#
# This script only CREATES. It never archives/deletes existing Prices —
# retiring Basic/Pro (if present in this Stripe account) is a separate,
# deliberate step, listed at the bottom as a reminder, not automated here.

set -euo pipefail

if [ -z "${STRIPE_API_KEY:-}" ]; then
  echo "Set STRIPE_API_KEY to a Stripe TEST secret key (sk_test_...) before running this script." >&2
  exit 1
fi

if [[ "$STRIPE_API_KEY" != sk_test_* ]]; then
  echo "STRIPE_API_KEY doesn't look like a test-mode key (expected sk_test_...). Refusing to run against what looks like a live key." >&2
  exit 1
fi

stripe_() { stripe --api-key "$STRIPE_API_KEY" "$@"; }

echo "== Team org seats — \$59/mo, \$566/yr (20% off, matches Individual/Team's acquisition-tier discount) =="

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
echo "   (This is the Enterprise SHARED price — the only one a shared/multi-tenant deployment"
echo "   like this local checkout will ever look up. See DEPLOYMENT_TYPE()/GetOrgSeatPriceOptions"
echo "   in get-org-seat-price.ts — a dedicated deployment resolves a different Price entirely,"
echo "   not created by this script.)"

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
echo "== Individual (personal) — \$15/mo, \$144/yr (20% off), replaces Basic/Pro =="

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

Done. Before running the plan's verification steps against these:

1. If this test-mode account still has Basic/Pro test Prices active under
   `metadata.plan = 'regular'`, the app's personal billing page shows ALL of
   them side by side — archive the old ones first:
     stripe --api-key "$STRIPE_API_KEY" prices update <price_id> -d active=false
   (list candidates with: stripe --api-key "$STRIPE_API_KEY" prices list --limit 20)

2. This script creates the Enterprise seat Price tagged `deployment=shared` —
   the only one a shared/multi-tenant instance (like app.hubsign.io, and any
   local dev checkout with `NEXT_PUBLIC_DEPLOYMENT_TYPE=shared`) ever looks
   up. If that env var is unset locally, `DEPLOYMENT_TYPE()` defaults to
   `dedicated` and Enterprise pricing/purchase calls will fail to find a
   match against this Price — set it to `shared` in `.env.local` first.

3. Repositories/DMS is bundled free into Business/Enterprise now, not sold
   separately — no `org_dms` Price is created for either, by design.

4. None of this touches production. Re-run this same script's logic against
   a LIVE key only as a separate, deliberate step once the code above has
   been verified end to end — see the plan's Verification section.
EOF
