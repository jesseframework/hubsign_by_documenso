import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { ChevronDownIcon } from 'lucide-react';
import { useRevalidator } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Card, CardContent, CardTitle } from '@documenso/ui/primitives/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@documenso/ui/primitives/collapsible';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type RedeemLicenseKeyCardProps = {
  /** Set for an organization (seat-plan) redemption; omit for an individual one. */
  organizationId?: number;
};

/**
 * "Redeem a license key" — activates a WorkHub-minted HubSign key (the
 * Stripe-free path). Reused on both the personal and org billing pages; the
 * presence of `organizationId` picks the org vs individual tRPC mutation.
 */
export const RedeemLicenseKeyCard = ({ organizationId }: RedeemLicenseKeyCardProps) => {
  const { toast } = useToast();
  const revalidator = useRevalidator();

  const [open, setOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const orgRedeem = trpc.org.redeemLicenseKey.useMutation();
  const individualRedeem = trpc.profile.redeemLicenseKey.useMutation();

  const onActivate = async () => {
    const key = licenseKey.trim();
    if (!key || submitting) return;

    setSubmitting(true);
    try {
      const result =
        organizationId != null
          ? await orgRedeem.mutateAsync({ key, organizationId })
          : await individualRedeem.mutateAsync({ key });

      const addonSuffix = result.addons?.length ? ` + ${result.addons.join(', ')}` : '';
      toast({
        title: 'License activated',
        description: `${result.tier}${addonSuffix} — active until ${new Date(
          result.expiresAt,
        ).toLocaleDateString()}.`,
      });
      setLicenseKey('');
      void revalidator.revalidate();
    } catch (err) {
      toast({
        title: 'Could not activate key',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between p-3 text-left">
            <CardTitle>
              <Trans>Redeem a license key</Trans>
            </CardTitle>
            <ChevronDownIcon
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4 px-6 pb-6 pt-0">
            <p className="text-muted-foreground text-sm">
              <Trans>
                Have an activation key? Enter it to unlock your plan without a card. The key is
                single-use.
              </Trans>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                placeholder="HSGN1..."
                className="font-mono"
                disabled={submitting}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void onActivate();
                  }
                }}
              />
              <Button onClick={() => void onActivate()} loading={submitting} disabled={!licenseKey.trim()}>
                <Trans>Activate</Trans>
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
