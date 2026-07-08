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

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { ORG_DMS_ADDON_PRICE_CENTS, ORG_SEAT_TIERS } from '../../constants/org-tiers';
import { stripe } from '../stripe';

export const RENEWAL_REMINDER_DAYS_BEFORE = 3;

const resolveStripePlanNameAndPrice = async (priceId: string) => {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const { product } = price;

  const planName = typeof product === 'string' || product.deleted ? 'Plan' : product.name;
  const unitAmount = price.unit_amount ?? 0;
  const priceFormatted = `$${(unitAmount / 100).toFixed(2)}/month`;

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

    const totalCents = seatPlans.reduce((sum, plan) => {
      const tierConfig = ORG_SEAT_TIERS[plan.tier];

      return (
        sum +
        tierConfig.priceCents * plan.quantity +
        (plan.dmsEnabled ? ORG_DMS_ADDON_PRICE_CENTS * plan.quantity : 0)
      );
    }, 0);

    const planName =
      seatPlans.length === 1
        ? `${ORG_SEAT_TIERS[seatPlans[0].tier].name} (${seatPlans[0].quantity} seat${seatPlans[0].quantity > 1 ? 's' : ''})`
        : `Organization seats (${seatPlans.reduce((sum, plan) => sum + plan.quantity, 0)} total)`;

    await jobs.triggerJob({
      name: 'send.subscription.renewal-reminder.email',
      payload: {
        email: orgAdmin.email,
        name: orgAdmin.name || undefined,
        planName,
        priceFormatted: `$${(totalCents / 100).toFixed(2)}/month`,
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
