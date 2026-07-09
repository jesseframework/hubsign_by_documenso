import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useRevalidator } from 'react-router';

import type { PriceIntervals } from '@documenso/ee/server-only/stripe/get-prices-by-interval';
import { toHumanPrice } from '@documenso/lib/universal/stripe/to-human-price';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type SubscriptionAddonsProps = {
  prices: PriceIntervals;
  activePriceIds: string[];
  /** The interval (month/year) the subscriber's current plan is billed at. */
  currentInterval: string;
};

export const SubscriptionAddons = ({
  prices,
  activePriceIds,
  currentInterval,
}: SubscriptionAddonsProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const revalidator = useRevalidator();

  const [togglingPriceId, setTogglingPriceId] = useState<string | null>(null);

  const { mutateAsync: toggleSubscriptionAddon } = trpc.profile.toggleSubscriptionAddon.useMutation();

  // Keep add-ons on the same billing interval as the primary plan, to avoid
  // mixing monthly/yearly items on a single subscription.
  const addonPrices = prices[currentInterval as keyof PriceIntervals] ?? [];

  if (addonPrices.length === 0) {
    return null;
  }

  const onToggleClick = async (priceId: string, action: 'add' | 'remove') => {
    try {
      setTogglingPriceId(priceId);

      await toggleSubscriptionAddon({ priceId, action });

      toast({ title: action === 'add' ? _(msg`Add-on added`) : _(msg`Add-on removed`) });

      void revalidator.revalidate();
    } catch (_err) {
      toast({
        title: _(msg`Something went wrong`),
        description: _(msg`An error occurred while trying to update your add-ons.`),
        variant: 'destructive',
      });
    } finally {
      setTogglingPriceId(null);
    }
  };

  return (
    <div className="mt-6">
      <h4 className="text-muted-foreground text-sm font-medium">
        <Trans>Add-ons</Trans>
      </h4>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {addonPrices.map((price) => {
          const isActive = activePriceIds.includes(price.id);

          return (
            <div
              key={price.id}
              className="flex items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <div className="font-medium">{price.product.name}</div>
                <div className="text-muted-foreground text-sm">
                  ${toHumanPrice(price.unit_amount ?? 0)} {price.currency.toUpperCase()} /{' '}
                  {price.recurring?.interval}
                </div>

                {price.product.description && (
                  <div className="text-muted-foreground mt-1.5 text-sm">
                    {price.product.description}
                  </div>
                )}

                {price.product.features && price.product.features.length > 0 && (
                  <div className="text-muted-foreground mt-3">
                    <div className="text-sm font-medium">
                      <Trans>Includes:</Trans>
                    </div>

                    <ul className="mt-1 divide-y text-sm">
                      {price.product.features.map((feature, index) => (
                        <li key={index} className="py-2">
                          {feature.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant={isActive ? 'outline' : 'default'}
                disabled={togglingPriceId !== null}
                loading={togglingPriceId === price.id}
                onClick={() => void onToggleClick(price.id, isActive ? 'remove' : 'add')}
              >
                {isActive ? <Trans>Remove</Trans> : <Trans>Add</Trans>}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
