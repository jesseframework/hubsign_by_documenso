/**
 * Renewal-reminder scanner.
 *
 * Finds active individual/team subscriptions and org seat plans whose
 * `periodEnd` falls within `RENEWAL_REMINDER_DAYS_BEFORE` days, sends a
 * reminder email, and stamps `renewalReminderSentForPeriodEnd` so it isn't
 * resent on the next scan. Since `periodEnd` only advances when the
 * subscription actually renews, this naturally allows exactly one reminder
 * per billing period regardless of how often the scan runs.
 *
 * Driven by the `/api/cron/subscription-renewals` endpoint — wire that to a
 * cron service on a daily cadence, same convention as
 * `/api/cron/workflows` + `run-due-scheduled.ts`.
 */

import { SubscriptionStatus } from '@prisma/client';

import { jobs } from '@documenso/lib/jobs/client';
import { prisma } from '@documenso/prisma';

import { DEPLOYMENT_TYPE, NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { ORG_SEAT_TIERS } from '../../constants/org-tiers';
import type { OrgBillingInterval } from '../../constants/org-tiers';
import { matchOrgPrice, searchActiveOrgPrices } from '../stripe/get-org-seat-price';
import { stripe } from '../stripe';

export const RENEWAL_REMINDER_DAYS_BEFORE = 3;

const resolveStripePlanNameAndPrice = async (priceId: string) => {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const { product } = price;

  const planName = typeof product === 'string' || product.deleted ? 'Plan' : product.name;
  const unitAmount = price.unit_amount ?? 0;
  const interval = price.recurring?.interval === 'year' ? 'year' : 'month';
  const priceFormatted = `$${(unitAmount / 100).toFixed(2)}/${interval}`;

  return { planName, priceFormatted };
};

const isWithinReminderWindow = (periodEnd: Date, now: Date): boolean => {
  const windowEnd = new Date(now.getTime() + RENEWAL_REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);

  return periodEnd >= now && periodEnd <= windowEnd;
};

const alreadyReminded = (
  renewalReminderSentForPeriodEnd: Date | null,
  periodEnd: Date,
): boolean => {
  return (
    renewalReminderSentForPeriodEnd !== null &&
    renewalReminderSentForPeriodEnd.getTime() === periodEnd.getTime()
  );
};

export const runDueSubscriptionRenewalReminders = async (): Promise<{
  scanned: number;
  triggered: number;
}> => {
  const now = new Date();
  const baseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';

  let scanned = 0;
  let triggered = 0;

  // Individual + team subscriptions.
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      periodEnd: { not: null },
    },
    include: {
      user: true,
      team: { include: { owner: true } },
    },
  });

  for (const subscription of subscriptions) {
    scanned += 1;

    const { periodEnd } = subscription;

    if (
      !periodEnd ||
      !isWithinReminderWindow(periodEnd, now) ||
      alreadyReminded(subscription.renewalReminderSentForPeriodEnd, periodEnd)
    ) {
      continue;
    }

    const recipient = subscription.team?.owner ?? subscription.user;

    if (!recipient) {
      continue;
    }

    const { planName, priceFormatted } = await resolveStripePlanNameAndPrice(
      subscription.priceId,
    );

    const billingUrl = subscription.team
      ? `${baseUrl}/t/${subscription.team.url}/settings/billing`
      : `${baseUrl}/settings/billing`;

    await jobs.triggerJob({
      name: 'send.subscription.renewal-reminder.email',
      payload: {
        email: recipient.email,
        name: recipient.name || undefined,
        planName,
        priceFormatted,
        periodEnd: periodEnd.toISOString(),
        billingUrl,
      },
    });

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { renewalReminderSentForPeriodEnd: periodEnd },
    });

    triggered += 1;
  }

  // Org seat plans.
  const organizations = await prisma.organization.findMany({
    where: {
      billingStatus: 'active',
      periodEnd: { not: null },
    },
    include: {
      seatPlans: true,
      members: {
        where: { role: 'ORG_ADMIN' },
        include: { user: true },
        take: 1,
      },
    },
  });

  // Org seat pricing is Stripe-authoritative (see `get-org-seat-price.ts`) —
  // one search shared across every org below rather than a lookup per org.
  const orgPrices = organizations.length > 0 ? await searchActiveOrgPrices() : [];
  const deployment = DEPLOYMENT_TYPE();

  for (const organization of organizations) {
    scanned += 1;

    const { periodEnd } = organization;

    if (
      !periodEnd ||
      !isWithinReminderWindow(periodEnd, now) ||
      alreadyReminded(organization.renewalReminderSentForPeriodEnd, periodEnd)
    ) {
      continue;
    }

    const orgAdmin = organization.members[0]?.user;

    if (!orgAdmin) {
      continue;
    }

    const seatPlans = organization.seatPlans;

    // A Stripe subscription can't mix monthly/yearly items (purchaseSeats/
    // changePlan's own invariant — see org-router.ts), so every plan this
    // org holds shares one interval; read it once rather than per plan.
    const orgInterval: OrgBillingInterval = seatPlans[0]?.billingInterval === 'year' ? 'year' : 'month';

    const totalCents = seatPlans.reduce((sum, plan) => {
      const seatPrice = matchOrgPrice(orgPrices, {
        type: 'org_seat',
        tier: plan.tier,
        interval: orgInterval,
        deployment: plan.tier === 'ENTERPRISE' ? deployment : undefined,
      });

      // No `org_dms` term: DMS is bundled free into Business/Enterprise
      // (`dmsEnabled`), never a separate charge today — see F-13, the same
      // fix applied to the org billing page's own total.
      const docBlockPrice = plan.docBlockQuantity
        ? matchOrgPrice(orgPrices, { type: 'org_doc_block', tier: plan.tier, interval: orgInterval })
        : null;

      // Every current org tier is flat-rate (`ORG_SEAT_TIERS[tier].flatRate`)
      // — billed to Stripe as quantity 1 regardless of `plan.quantity`, which
      // for a flat tier holds the seat *cap* (e.g. Team's 20, or the
      // unlimited sentinel), not a billed quantity. Mirrors `purchaseSeats`'
      // own `tierLimits.flatRate ? 1 : input.quantity`.
      const seatQuantity = ORG_SEAT_TIERS[plan.tier].flatRate ? 1 : plan.quantity;

      return (
        sum + (seatPrice?.unit_amount ?? 0) * seatQuantity + (docBlockPrice?.unit_amount ?? 0) * plan.docBlockQuantity
      );
    }, 0);

    const planName =
      seatPlans.length === 1
        ? ORG_SEAT_TIERS[seatPlans[0].tier].name
        : `Organization (${seatPlans.length} tiers)`;

    await jobs.triggerJob({
      name: 'send.subscription.renewal-reminder.email',
      payload: {
        email: orgAdmin.email,
        name: orgAdmin.name || undefined,
        planName,
        priceFormatted: `$${(totalCents / 100).toFixed(2)}/${orgInterval}`,
        periodEnd: periodEnd.toISOString(),
        billingUrl: `${baseUrl}/org/billing`,
      },
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { renewalReminderSentForPeriodEnd: periodEnd },
    });

    triggered += 1;
  }

  return { scanned, triggered };
};
