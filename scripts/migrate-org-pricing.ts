/**
 * One-off migration: repoints existing active org subscriptions' Stripe
 * line items to whatever Price is *currently* live in Stripe for their
 * {type, tier, interval[, deployment]} — org seat pricing moved to being
 * Stripe-authoritative (see packages/ee/server-only/stripe/get-org-seat-price.ts),
 * so this is what actually migrates already-subscribed orgs onto new pricing
 * instead of only affecting new purchases/top-ups.
 *
 * Also corrects local `dmsEnabled`/`dmsAddon` for any org whose DMS flag is
 * still on locally but has no real `org_dms` line item live on Stripe — there
 * is no grandfathering for DMS, so this is what actually applies that
 * decision to orgs that already existed before the change, by reusing
 * `onOrgSubscriptionUpdated` (the exact same sync the webhook performs).
 *
 * Must be run somewhere with production DATABASE_URL + a live Stripe key —
 * this repo's local dev environment has neither.
 *
 * Usage:
 *   npx tsx scripts/migrate-org-pricing.ts            # dry run (default) — logs only, no writes
 *   npx tsx scripts/migrate-org-pricing.ts --apply     # actually applies the changes
 *
 * `proration_behavior: 'none'` below means a repriced seat takes effect at
 * the org's *next* renewal rather than an immediate prorated charge/credit
 * today — change it to 'always_invoice' if you'd rather bill the difference
 * immediately.
 */
import { DEPLOYMENT_TYPE } from '../packages/lib/constants/app';
import type { OrgBillingInterval } from '../packages/lib/constants/org-tiers';
import { getOrgSeatPrice } from '../packages/ee/server-only/stripe/get-org-seat-price';
import { onOrgSubscriptionUpdated } from '../packages/ee/server-only/stripe/webhook/on-org-subscription-updated';
import { stripe } from '../packages/lib/server-only/stripe';
import { prisma } from '../packages/prisma';

const APPLY = process.argv.includes('--apply');

const hasLiveItem = (
  subscription: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>>,
  type: 'org_seat' | 'org_dms',
  tier: string,
) =>
  subscription.items.data.find((item) => {
    const { product } = item.price;
    return (
      typeof product !== 'string' &&
      !product.deleted &&
      product.metadata?.type === type &&
      product.metadata?.tier === tier
    );
  });

async function main() {
  console.log(
    APPLY
      ? 'Running in APPLY mode — changes WILL be made to Stripe and the database.'
      : 'Running in DRY-RUN mode — no changes will be made. Pass --apply to execute for real.',
  );

  const orgs = await prisma.organization.findMany({
    where: { stripeSubscriptionId: { not: null } },
    include: { seatPlans: true },
  });

  console.log(`Found ${orgs.length} organization(s) with an active Stripe subscription.\n`);

  for (const org of orgs) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const subscriptionId = org.stripeSubscriptionId as string;

    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    });

    const itemsToUpdate: Array<{ id: string; price: string }> = [];

    for (const seatPlan of org.seatPlans) {
      const seatItem = hasLiveItem(subscription, 'org_seat', seatPlan.tier);

      if (!seatItem) {
        console.log(`  [${org.name}] (org ${org.id}) ${seatPlan.tier}: no seat item found on the live subscription, skipping.`);
        continue;
      }

      const interval = (seatPlan.billingInterval === 'year' ? 'year' : 'month') as OrgBillingInterval;

      const newPrice = await getOrgSeatPrice({
        type: 'org_seat',
        tier: seatPlan.tier,
        interval,
        deployment: seatPlan.tier === 'ENTERPRISE' ? DEPLOYMENT_TYPE() : undefined,
      });

      if (!newPrice) {
        console.log(`  [${org.name}] (org ${org.id}) ${seatPlan.tier}: no live Stripe price configured for this plan, skipping.`);
        continue;
      }

      if (seatItem.price.id === newPrice.id) {
        console.log(
          `  [${org.name}] (org ${org.id}) ${seatPlan.tier}: already on the current price ($${((newPrice.unit_amount ?? 0) / 100).toFixed(2)}/${interval}), no change.`,
        );
        continue;
      }

      console.log(
        `  [${org.name}] (org ${org.id}) ${seatPlan.tier}: ${seatItem.price.id} ($${((seatItem.price.unit_amount ?? 0) / 100).toFixed(2)}) -> ${newPrice.id} ($${((newPrice.unit_amount ?? 0) / 100).toFixed(2)}) [${interval}]`,
      );

      itemsToUpdate.push({ id: seatItem.id, price: newPrice.id });

      if (seatPlan.dmsEnabled && !hasLiveItem(subscription, 'org_dms', seatPlan.tier)) {
        console.log(
          `  [${org.name}] (org ${org.id}) ${seatPlan.tier}: DMS is marked enabled locally but has no live org_dms item — will be corrected to disabled (no grandfathering).`,
        );
      }
    }

    if (itemsToUpdate.length === 0 && !APPLY) {
      console.log(`  [${org.name}] (org ${org.id}) no price changes needed.\n`);
      continue;
    }

    if (!APPLY) {
      console.log(`  [${org.name}] (org ${org.id}) would apply the above change(s) (dry run).\n`);
      continue;
    }

    if (itemsToUpdate.length > 0) {
      await stripe.subscriptions.update(subscriptionId, {
        items: itemsToUpdate,
        proration_behavior: 'none',
      });
    }

    // Re-sync from confirmed Stripe state regardless of whether the seat
    // price itself changed — this is also what corrects the DMS flag.
    const updatedSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    });

    await onOrgSubscriptionUpdated({ organizationId: org.id, subscription: updatedSubscription });

    console.log(`  [${org.name}] (org ${org.id}) applied.\n`);
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
