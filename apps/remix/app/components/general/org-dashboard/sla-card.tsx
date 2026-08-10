import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon, GaugeIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

/**
 * SLA performance for the Signature Inbox.
 *
 * Renders nothing at all when SLA is switched off, so the dashboard doesn't
 * carry an empty widget for organizations that don't track turnaround.
 */

const pct = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

/** Green at 95%+, amber from 80%, red below — matched to the at-risk threshold. */
const rateTone = (rate: number | null): string => {
  if (rate === null) return 'text-muted-foreground';
  if (rate >= 0.95) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 0.8) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
};

type Leg = {
  tracked: number;
  met: number;
  breached: number;
  atRisk: number;
  onTrack: number;
  onTimeRate: number | null;
};

function LegColumn({ title, hint, leg }: { title: React.ReactNode; hint: React.ReactNode; leg: Leg }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>

      <p className={`mt-2 text-2xl font-semibold tabular-nums ${rateTone(leg.onTimeRate)}`}>
        {pct(leg.onTimeRate)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {leg.onTimeRate === null ? (
          <Trans>nothing finished yet</Trans>
        ) : (
          <Trans>on time ({leg.met} of {leg.met + leg.breached} finished)</Trans>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {leg.atRisk > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            <Trans>{leg.atRisk} at risk</Trans>
          </span>
        )}
        {leg.breached > 0 && (
          <span className="text-red-600 dark:text-red-400">
            <Trans>{leg.breached} breached</Trans>
          </span>
        )}
        {leg.onTrack > 0 && (
          <span className="text-muted-foreground">
            <Trans>{leg.onTrack} open</Trans>
          </span>
        )}
      </div>
    </div>
  );
}

export function SlaCard() {
  const { data } = trpc.inbox.slaStats.useQuery({ days: 30 });

  if (!data?.enabled) {
    return null;
  }

  return (
    <div className="rounded-[var(--r)] border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GaugeIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[14px] font-semibold">
            <Trans>Invoice SLA</Trans>
          </h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          <Trans>last {data.days} days · {data.total} items</Trans>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LegColumn
          title={<Trans>Internal turnaround</Trans>}
          hint={<Trans>received → sent for signature</Trans>}
          leg={data.internal}
        />
        <LegColumn
          title={<Trans>End to end</Trans>}
          hint={<Trans>received → fully signed</Trans>}
          leg={data.endToEnd}
        />
      </div>

      {data.breachedOpen.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950/40">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            <Trans>{data.breachedOpen.length} overdue and still unsent</Trans>
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {data.breachedOpen.slice(0, 5).map((item) => (
              <li key={item.inboxItemId} className="text-[11px]">
                <Link
                  to={`/org/inbox/${item.inboxItemId}`}
                  className="text-red-700 hover:underline dark:text-red-300"
                >
                  {item.vendor ?? 'Unknown vendor'}
                </Link>
                <span className="text-muted-foreground">
                  {' '}
                  — <Trans>over by {Math.round(item.overdueByMinutes / 60)}h</Trans>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.worstVendors.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <Trans>Most breaches by vendor</Trans>
          </p>
          <ul className="mt-1 space-y-0.5">
            {data.worstVendors.map((vendor) => (
              <li key={vendor.vendor} className="flex justify-between text-[12px]">
                <span className="truncate pr-2">{vendor.vendor}</span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {vendor.breached}/{vendor.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.untracked > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <Trans>
            {data.untracked} item(s) have no SLA target — set one on the vendor's Metadata record
            or as an organization default.
          </Trans>
        </p>
      )}
    </div>
  );
}
