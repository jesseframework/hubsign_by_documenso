import { Trans } from '@lingui/react/macro';
import { SparklesIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Card, CardContent } from '@documenso/ui/primitives/card';

import { AiConnectionCard } from '~/components/general/ai-connection-card';
import { OrgAdminGuard } from '~/components/general/org-admin-guard';
import { RedeemAiCreditsCard } from '~/components/general/redeem-ai-credits-card';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('AI Credits');
}

/**
 * Aubrey AI credits, on their own page.
 *
 * They were a card on Billing & Plan, wedged between the license key and the
 * seat plans — three different things bought three different ways on one
 * screen. Credits also have a history worth reading, which had nowhere to live
 * there: the redemption ledger was already being written for audit and
 * idempotency, and nothing ever showed it.
 */
export default function OrgAiCreditsPage() {
  const { data: history } = trpc.aubrey.redemptionHistory.useQuery();
  const { data: usage } = trpc.aubrey.getUsage.useQuery();

  const totalPurchased = history?.totalPurchased ?? 0;
  const balance = history?.balance ?? 0;
  // Derived rather than stored, so it can never disagree with the two figures
  // it sits between.
  const used = Math.max(0, totalPurchased - balance);

  return (
    <OrgAdminGuard>
      <div className="space-y-4">
        <div>
          <h1 className="text-[20px] font-semibold">
            <Trans>AI Credits</Trans>
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Aubrey draws on a monthly free allowance per person first, then on this shared pool.
            </Trans>
          </p>
        </div>

        {/*
          Connection first, then credits. Credits are meaningless until AI can
          actually run, and a pool balance next to a dead connection is exactly
          the "I bought 500 and nothing works" confusion we keep fixing.
        */}
        <AiConnectionCard />

        <RedeemAiCreditsCard />

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label={<Trans>In the pool</Trans>} value={balance} />
          <Stat label={<Trans>Used from the pool</Trans>} value={used} />
          <Stat label={<Trans>Purchased all time</Trans>} value={totalPurchased} />
        </div>

        {usage && usage.monthlyLimit !== null && (
          <p className="text-[12px] text-muted-foreground">
            <Trans>
              Your own free allowance this month: {usage.monthlyUsed} of {usage.monthlyLimit} used.
              The pool is only drawn on once that runs out, and it is shared across everyone in the
              organization.
            </Trans>
          </p>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[14px] font-semibold">
                <Trans>Top-up history</Trans>
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <Trans>Every credit key redeemed for this organization.</Trans>
              </p>
            </div>

            {!history ? (
              <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                <Trans>Loading…</Trans>
              </p>
            ) : history.entries.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <SparklesIcon className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-[13px] font-medium">
                  <Trans>No credits have been redeemed yet</Trans>
                </p>
                <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
                  <Trans>
                    Aubrey still works on each person's monthly free allowance. Redeem a key above
                    to add a shared pool for when that runs out.
                  </Trans>
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className={th}>
                      <Trans>Redeemed</Trans>
                    </th>
                    <th className={th}>
                      <Trans>By</Trans>
                    </th>
                    <th className={th}>
                      <Trans>Key</Trans>
                    </th>
                    <th className={`${th} text-right`}>
                      <Trans>Credits</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <td className={td}>{new Date(entry.redeemedAt).toLocaleString()}</td>
                      <td className={td}>
                        {entry.redeemedBy ?? (
                          <span className="text-muted-foreground">
                            <Trans>account since removed</Trans>
                          </span>
                        )}
                      </td>
                      <td className={`${td} font-mono text-[11px] text-muted-foreground`}>
                        …{entry.reference}
                      </td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>
                        +{entry.credits}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </OrgAdminGuard>
  );
}

const th =
  'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground';
const td = 'px-4 py-2.5 text-[12px]';

const Stat = ({ label, value }: { label: React.ReactNode; value: number }) => (
  <Card>
    <CardContent className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold leading-none">{value.toLocaleString()}</p>
    </CardContent>
  </Card>
);
