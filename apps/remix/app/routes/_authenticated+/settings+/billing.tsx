import { useEffect } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { SubscriptionStatus } from '@prisma/client';
import { redirect, Link, useSearchParams } from 'react-router';
import { match } from 'ts-pattern';

import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { getStripeCustomerByUser } from '@documenso/ee/server-only/stripe/get-customer';
import type { PriceWithProduct } from '@documenso/ee/server-only/stripe/get-prices-by-interval';
import { getPricesByInterval } from '@documenso/ee/server-only/stripe/get-prices-by-interval';
import { getPrimaryAccountPlanPrices } from '@documenso/ee/server-only/stripe/get-primary-account-plan-prices';
import { getProductByPriceId } from '@documenso/ee/server-only/stripe/get-product-by-price-id';
import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { STRIPE_PLAN_TYPE } from '@documenso/lib/constants/billing';
import { stripe, type Stripe } from '@documenso/lib/server-only/stripe';
import { getSubscriptionsByUserId } from '@documenso/lib/server-only/subscription/get-subscriptions-by-user-id';
import { prisma } from '@documenso/prisma';

import { BillingPlans } from '~/components/general/billing-plans';
import { BillingPortalButton } from '~/components/general/billing-portal-button';
import { PlanSwitcher } from '~/components/general/plan-switcher';
import { RedeemLicenseKeyCard } from '~/components/general/redeem-license-key-card';
import { SubscriptionAddons } from '~/components/general/subscription-addons';
import { appMetaTags } from '~/utils/meta';
import { superLoaderJson, useSuperLoaderData } from '~/utils/super-json-loader';

import type { Route } from './+types/billing';

export function meta() {
  return appMetaTags('Billing');
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await getSession(request);

  // Redirect if subscriptions are not enabled.
  if (!IS_BILLING_ENABLED()) {
    throw redirect('/settings/profile');
  }

  // Org seat limits supersede personal subscription limits entirely (see
  // `getServerLimits`), regardless of context or whether a seat is even
  // assigned yet — so personal billing is genuinely irrelevant for any org
  // member, not just once they're seated. Skip the Stripe/price fetching
  // below and point them at Organization > Billing instead.
  const orgMembership = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
  });

  if (orgMembership) {
    return superLoaderJson({ isOrgManaged: true as const });
  }

  if (!user.customerId) {
    await getStripeCustomerByUser(user).then((result) => result.user);
  }

  const [subscriptions, prices, addonPrices, primaryAccountPlanPrices] = await Promise.all([
    getSubscriptionsByUserId({ userId: user.id }),
    getPricesByInterval({
      plans: [STRIPE_PLAN_TYPE.REGULAR, STRIPE_PLAN_TYPE.PLATFORM, STRIPE_PLAN_TYPE.ENTERPRISE],
    }),
    getPricesByInterval({ plans: [STRIPE_PLAN_TYPE.DMS] }),
    getPrimaryAccountPlanPrices(),
  ]);

  const primaryAccountPlanPriceIds = primaryAccountPlanPrices.map(({ id }) => id);

  let subscriptionProduct: Stripe.Product | null = null;

  const primaryAccountPlanSubscriptions = subscriptions.filter(({ priceId }) =>
    primaryAccountPlanPriceIds.includes(priceId),
  );

  const subscription =
    primaryAccountPlanSubscriptions.find(({ status }) => status === SubscriptionStatus.ACTIVE) ??
    primaryAccountPlanSubscriptions[0];

  if (subscription?.priceId) {
    subscriptionProduct = await getProductByPriceId({ priceId: subscription.priceId }).catch(
      () => null,
    );
  }

  // Determine which add-ons (e.g. DMS) are already stacked on the live
  // Stripe subscription, so the UI can show "Remove" instead of "Add".
  const addonPriceIds = Object.values(addonPrices)
    .flat()
    .map(({ id }) => id);

  let activeAddonPriceIds: string[] = [];

  if (subscription?.status === SubscriptionStatus.ACTIVE) {
    const stripeSubscription = await stripe.subscriptions
      .retrieve(subscription.planId)
      .catch(() => null);

    activeAddonPriceIds =
      stripeSubscription?.items.data
        .map((item) => item.price.id)
        .filter((priceId) => addonPriceIds.includes(priceId)) ?? [];
  }

  const isMissingOrInactiveOrFreePlan =
    !subscription || subscription.status === SubscriptionStatus.INACTIVE;

  // Fetch the subscriber's own price directly (with its product expanded)
  // rather than looking it up inside the freshly-fetched *active* price list.
  // A subscriber can be "grandfathered" on a price that's since been archived
  // (e.g. after a plan restructure/reprice) — archived prices are still valid
  // on existing subscriptions, they just don't show up as options for new
  // checkouts. Deriving the interval this way means the plan switcher and
  // add-ons section still render correctly for those subscribers, instead of
  // silently disappearing because their current price isn't in the "active"
  // list used to compute it.
  let currentPrice: PriceWithProduct | null = null;

  if (subscription) {
    currentPrice = await stripe.prices
      .retrieve(subscription.priceId, { expand: ['product'] })
      // `expand` isn't reflected in the SDK's return type, so the product
      // comes back as a full object despite the type saying `string`.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      .then((price) => price as unknown as PriceWithProduct)
      .catch(() => null);
  }

  const subscriptionInterval = currentPrice?.recurring?.interval;

  return superLoaderJson({
    isOrgManaged: false as const,
    prices,
    addonPrices,
    activeAddonPriceIds,
    subscription,
    subscriptionInterval,
    currentPrice,
    subscriptionProductName: subscriptionProduct?.name,
    isMissingOrInactiveOrFreePlan,
  });
}

export default function TeamsSettingBillingPage() {
  const data = useSuperLoaderData<typeof loader>();
  const { i18n } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoSubscribeIndividual = searchParams.get('plan') === 'individual';

  // Clear the param once read — `BillingPlans`' own auto-subscribe guard
  // already fired for this mount, so leaving it in the URL would just
  // re-trigger checkout on every future reload/bookmark of this page.
  useEffect(() => {
    if (autoSubscribeIndividual) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (data.isOrgManaged) {
    return (
      <div>
        <h3 className="text-2xl font-semibold">
          <Trans>Billing</Trans>
        </h3>

        <hr className="my-4" />

        <p className="text-muted-foreground text-sm">
          <Trans>
            Your billing is managed by your organization.{' '}
            <Link to="/org/billing" className="text-primary underline underline-offset-4">
              View organization billing
            </Link>
          </Trans>
        </p>
      </div>
    );
  }

  const {
    prices,
    addonPrices,
    activeAddonPriceIds,
    subscription,
    subscriptionInterval,
    currentPrice,
    subscriptionProductName,
    isMissingOrInactiveOrFreePlan,
  } = data;

  return (
    <div>
      <div className="mb-8">
        <RedeemLicenseKeyCard />
      </div>

      <div className="flex flex-row items-end justify-between">
        <div>
          <h3 className="text-2xl font-semibold">
            <Trans>Billing</Trans>
          </h3>

          <div className="text-muted-foreground mt-2 text-sm">
            {isMissingOrInactiveOrFreePlan && (
              <p>
                <Trans>
                  You are currently on the <span className="font-semibold">Free Plan</span>.
                </Trans>
              </p>
            )}

            {/* Todo: Translation */}
            {!isMissingOrInactiveOrFreePlan &&
              match(subscription.status)
                .with('ACTIVE', () => (
                  <p>
                    {subscriptionProductName ? (
                      <span>
                        You are currently subscribed to{' '}
                        <span className="font-semibold">{subscriptionProductName}</span>
                      </span>
                    ) : (
                      <span>You currently have an active plan</span>
                    )}

                    {subscription.periodEnd && (
                      <span>
                        {' '}
                        which is set to{' '}
                        {subscription.cancelAtPeriodEnd ? (
                          <span>
                            end on{' '}
                            <span className="font-semibold">
                              {i18n.date(subscription.periodEnd)}.
                            </span>
                          </span>
                        ) : (
                          <span>
                            automatically renew on{' '}
                            <span className="font-semibold">
                              {i18n.date(subscription.periodEnd)}.
                            </span>
                          </span>
                        )}
                      </span>
                    )}
                  </p>
                ))
                .with('PAST_DUE', () => (
                  <p>
                    <Trans>
                      Your current plan is past due. Please update your payment information.
                    </Trans>
                  </p>
                ))
                .otherwise(() => null)}
          </div>
        </div>

        {isMissingOrInactiveOrFreePlan && (
          <BillingPortalButton>
            <Trans>Manage billing</Trans>
          </BillingPortalButton>
        )}
      </div>

      <hr className="my-4" />

      {isMissingOrInactiveOrFreePlan ? (
        <BillingPlans prices={prices} autoSubscribe={autoSubscribeIndividual} />
      ) : (
        <>
          <BillingPortalButton />
          {subscriptionInterval && (
            <>
              <PlanSwitcher
                prices={prices}
                currentPriceId={subscription.priceId}
                currentInterval={subscriptionInterval}
                currentPrice={currentPrice}
              />
              <SubscriptionAddons
                prices={addonPrices}
                activePriceIds={activeAddonPriceIds}
                currentInterval={subscriptionInterval}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
