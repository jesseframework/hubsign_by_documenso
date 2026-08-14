import { useState } from 'react';

import { Trans } from '@lingui/react/macro';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Card, CardContent, CardTitle } from '@documenso/ui/primitives/card';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * "Redeem Aubrey AI credits" — tops up the org's shared credit pool with a
 * WorkHub-minted credit-pack key (same single-use redemption model as a license
 * key). Shown on the org billing page for admins; also shows the live balance.
 */
export const RedeemAiCreditsCard = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [key, setKey] = useState('');

  const { data: usage } = trpc.aubrey.getUsage.useQuery();
  const redeem = trpc.aubrey.redeemCredits.useMutation({
    onSuccess: (result) => {
      toast({
        title: 'AI credits added',
        description: `${result.credits} credits redeemed — ${result.balance} now in the pool.`,
      });
      setKey('');
      void utils.aubrey.getUsage.invalidate();
    },
    onError: (err) => {
      toast({ title: 'Could not redeem credits', description: err.message, variant: 'destructive' });
    },
  });

  const onActivate = () => {
    const trimmed = key.trim();
    if (!trimmed || redeem.isPending) return;
    redeem.mutate({ key: trimmed });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>
              <Trans>Aubrey AI credits</Trans>
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              <Trans>
                Top up the shared pool your team draws from once monthly free messages run out. Keys
                are single-use.
              </Trans>
            </p>
          </div>
          {usage && (
            <div className="text-right">
              <p className="text-2xl font-semibold leading-none">{usage.purchasedBalance}</p>
              <p className="text-muted-foreground mt-1 text-[11px]">
                <Trans>credits in pool</Trans>
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="HSAI1..."
            className="font-mono"
            disabled={redeem.isPending}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onActivate();
              }
            }}
          />
          <Button onClick={onActivate} loading={redeem.isPending} disabled={!key.trim()}>
            <Trans>Redeem</Trans>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
