import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useRevalidator } from 'react-router';

import type { PriceIntervals, PriceWithProduct } from '@documenso/ee/server-only/stripe/get-prices-by-interval';
import { STRIPE_PLAN_TYPE } from '@documenso/lib/constants/billing';
import { toHumanPrice } from '@documenso/lib/universal/stripe/to-human-price';
import { trpc } from '@documenso/trpc/react';
import { Badge } from '@documenso/ui/primitives/badge';
import { Button } from '@documenso/ui/primitives/button';
import { Card, CardContent, CardTitle } from '@documenso/ui/primitives/card';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type PlanSwitcherProps = {
  prices: PriceIntervals;
  currentPriceId: string;
  /** The interval (month/year) the subscriber's current plan is billed at. */
  currentInterval: string;
  /**
   * The subscriber's own price, fetched directly rather than looked up in
   * `prices` (which only contains *active* prices). A subscriber can be
   * grandfathered on a price that's since been archived after a plan
   * restructure — falls back to searching `prices` if not provided.
   */
  currentPrice?: PriceWithProduct | null;
};

export const PlanSwitcher = ({
  prices,
  currentPriceId,
  currentInterval,
  currentPrice: currentPriceProp,
}: PlanSwitcherProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const revalidator = useRevalidator();

  const [switchingPriceId, setSwitchingPriceId] = useState<string | null>(null);

  const { mutateAsync: updateSubscriptionPlan } = trpc.profile.updateSubscriptionPlan.useMutation();

  const intervalPrices = prices[currentInterval as keyof PriceIntervals] ?? [];

  const currentPrice = currentPriceProp ?? intervalPrices.find((price) => price.id === currentPriceId);

  // Only offer switches within the subscriber's current billing interval —
  // switching monthly <-> yearly mid-term is a business decision (proration
  // on annual plans), not something to expose as a one-click action here.
  const otherPrices = intervalPrices.filter(
    (price) => price.id !== currentPriceId && price.product.metadata?.plan !== STRIPE_PLAN_TYPE.DMS,
  );

  if (otherPrices.length === 0) {
    return null;
  }

  const onSwitchClick = async (priceId: string) => {
    try {
      setSwitchingPriceId(priceId);

      await updateSubscriptionPlan({ priceId });

      toast({ title: _(msg`Plan updated`) });

      void revalidator.revalidate();
    } catch (_err) {
      toast({
        title: _(msg`Something went wrong`),
        description: _(msg`An error occurred while trying to change your plan.`),
        variant: 'destructive',
      });
    } finally {
      setSwitchingPriceId(null);
    }
  };

  return (
    <div className="mt-6">
      <h4 className="text-muted-foreground text-sm font-medium">
        <Trans>Change plan</Trans>
      </h4>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {currentPrice && (
          <Card className="border-primary/40 bg-muted/30">
            <CardContent className="flex h-full flex-col p-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{currentPrice.product.name}</CardTitle>
                <Badge variant="secondary">
                  <Trans>Current plan</Trans>
                </Badge>
              </div>

              <div className="text-muted-foreground mt-1 text-sm">
                ${toHumanPrice(currentPrice.unit_amount ?? 0)}{' '}
                {currentPrice.currency.toUpperCase()} / {currentPrice.recurring?.interval}
              </div>

              {currentPrice.product.features && currentPrice.product.features.length > 0 && (
                <div className="text-muted-foreground mt-3">
                  <div className="text-xs font-medium">
                    <Trans>Includes:</Trans>
                  </div>

                  <ul className="mt-1 divide-y text-sm">
                    {currentPrice.product.features.map((feature, index) => (
                      <li key={index} className="py-1.5">
                        {feature.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {otherPrices.map((price) => {
          const isUpgrade = currentPrice
            ? (price.unit_amount ?? 0) > (currentPrice.unit_amount ?? 0)
            : undefined;
          const isDowngrade = currentPrice
            ? (price.unit_amount ?? 0) < (currentPrice.unit_amount ?? 0)
            : undefined;

          const actionLabel = isUpgrade ? (
            <Trans>Upgrade</Trans>
          ) : isDowngrade ? (
            <Trans>Downgrade</Trans>
          ) : (
            <Trans>Switch</Trans>
          );

          return (
            <Card key={price.id}>
              <CardContent className="flex h-full flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{price.product.name}</CardTitle>

                  {isUpgrade && (
                    <Badge variant="default">
                      <Trans>Upgrade</Trans>
                    </Badge>
                  )}

                  {isDowngrade && (
                    <Badge variant="neutral">
                      <Trans>Downgrade</Trans>
                    </Badge>
                  )}
                </div>

                <div className="text-muted-foreground mt-1 text-sm">
                  ${toHumanPrice(price.unit_amount ?? 0)} {price.currency.toUpperCase()} /{' '}
                  {price.recurring?.interval}
                </div>

                {price.product.features && price.product.features.length > 0 && (
                  <div className="text-muted-foreground mt-3">
                    <div className="text-xs font-medium">
                      <Trans>Includes:</Trans>
                    </div>

                    <ul className="mt-1 divide-y text-sm">
                      {price.product.features.map((feature, index) => (
                        <li key={index} className="py-1.5">
                          {feature.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex-1" />

                <Button
                  className="mt-4"
                  size="sm"
                  variant={isDowngrade ? 'outline' : 'default'}
                  disabled={switchingPriceId !== null}
                  loading={switchingPriceId === price.id}
                  onClick={() => void onSwitchClick(price.id)}
                >
                  {actionLabel}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
