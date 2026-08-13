import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  GaugeIcon,
  TimerIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('SLA');
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/**
 * A rate as a percentage. Rounding is floored below 100 so that 249 of 250
 * reads "99%" rather than a flawless "100%" — a perfect score has to be earned.
 */
const pct = (rate: number | null | undefined): string => {
  if (rate === null || rate === undefined) return '—';
  return `${rate >= 1 ? 100 : Math.min(99, Math.floor(rate * 100))}%`;
};

/** "3h", "45m", "2d 1h" — never "0h" for a real overrun. */
const shortDuration = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.round((m % (60 * 24)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
};

const rateTone = (rate: number | null | undefined): string => {
  if (rate === null || rate === undefined) return 'text-muted-foreground';
  if (rate >= 0.95) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 0.8) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
};

const BAND_STYLE: Record<string, { ring: string; text: string; label: string }> = {
  healthy: { ring: 'stroke-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Healthy' },
  watch: { ring: 'stroke-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Needs attention' },
  critical: { ring: 'stroke-red-500', text: 'text-red-600 dark:text-red-400', label: 'Critical' },
  unknown: { ring: 'stroke-muted-foreground/30', text: 'text-muted-foreground', label: 'No data yet' },
};

/** Ring gauge — a score reads faster as a filled arc than as a number alone. */
function HealthGauge({ score, band }: { score: number | null; band: string }) {
  const style = BAND_STYLE[band] ?? BAND_STYLE.unknown;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = ((score ?? 0) / 100) * circumference;

  return (
    <div className="relative h-[132px] w-[132px] flex-shrink-0">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          strokeWidth="10"
          className="stroke-muted"
        />
        {score !== null && (
          <circle
            cx="66"
            cy="66"
            r={radius}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            className={style.ring}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-semibold tabular-nums ${style.text}`}>
          {score === null ? '—' : score}
        </span>
        <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <Trans>health</Trans>
        </span>
      </div>
    </div>
  );
}

/** Bar-per-bucket trend. Bars beat a line here: gaps stay visibly empty. */
/** "Jul 11–16", or a single date when the bucket is one day wide. */
const bucketLabel = (from: string, to: string): string => {
  const short = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return from === to ? short(from) : `${short(from)}–${short(to)}`;
};

function TrendChart({
  data,
}: {
  data: { from: string; to: string; onTimeRate: number | null; met: number; breached: number }[];
}) {
  const hasAny = data.some((d) => d.onTimeRate !== null);

  if (!hasAny) {
    return (
      <p className="py-8 text-center text-[12px] text-muted-foreground">
        <Trans>Nothing has finished in this window yet, so there is no trend to show.</Trans>
      </p>
    );
  }

  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((bucket) => {
        const rate = bucket.onTimeRate;
        const height = rate === null ? 0 : Math.max(2, rate * 100);
        const tone =
          rate === null
            ? 'bg-muted'
            : rate >= 0.95
              ? 'bg-emerald-500'
              : rate >= 0.8
                ? 'bg-amber-500'
                : 'bg-red-500';

        return (
          <div key={bucket.from} className="group relative flex flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end">
              <div
                className={`w-full rounded-t ${tone} transition-opacity group-hover:opacity-80`}
                style={{ height: `${height}%` }}
              />
            </div>
            <span className="text-[9px] tabular-nums text-muted-foreground">
              {bucketLabel(bucket.from, bucket.to)}
            </span>
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-[11px] shadow group-hover:block">
              {bucketLabel(bucket.from, bucket.to)} · {pct(rate)} · {bucket.met} met /{' '}
              {bucket.breached} missed <Trans>clocks</Trans>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LegCard({
  title,
  hint,
  leg,
}: {
  title: React.ReactNode;
  hint: React.ReactNode;
  leg: {
    tracked: number;
    met: number;
    breached: number;
    breachedOpen: number;
    atRisk: number;
    onTrack: number;
    onTimeRate: number | null;
  };
}) {
  return (
    <div className="rounded-[var(--r)] border border-border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${rateTone(leg.onTimeRate)}`}>
        {pct(leg.onTimeRate)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {leg.onTimeRate === null ? (
          <Trans>nothing scored yet</Trans>
        ) : (
          // "scored", not "finished": the denominator includes breaches that are
          // still outstanding, which have very much not finished.
          <Trans>on time · {leg.met} of {leg.met + leg.breached} scored</Trans>
        )}
      </p>
      <div className="mt-3 grid grid-cols-4 gap-1 border-t border-border pt-2 text-center">
        {[
          { n: leg.met, label: <Trans>met</Trans>, tone: 'text-emerald-600 dark:text-emerald-400' },
          { n: leg.breached, label: <Trans>breached</Trans>, tone: 'text-red-600 dark:text-red-400' },
          { n: leg.atRisk, label: <Trans>at risk</Trans>, tone: 'text-amber-600 dark:text-amber-400' },
          { n: leg.onTrack, label: <Trans>on track</Trans>, tone: 'text-muted-foreground' },
        ].map((cell, i) => (
          <div key={i}>
            <p className={`text-[15px] font-semibold tabular-nums ${cell.tone}`}>{cell.n}</p>
            <p className="text-[10px] text-muted-foreground">{cell.label}</p>
          </div>
        ))}
      </div>
      {leg.breached > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {leg.breachedOpen === 0 ? (
            <Trans>All {leg.breached} breaches are finished work — none still outstanding.</Trans>
          ) : (
            <Trans>
              {leg.breachedOpen} of those {leg.breached} are still outstanding right now.
            </Trans>
          )}
        </p>
      )}
    </div>
  );
}

export default function OrgSlaPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = trpc.inbox.slaStats.useQuery({ days });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  if (!data?.enabled) {
    return (
      <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-16 text-center">
        <GaugeIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p className="text-[14px] font-medium">
          <Trans>SLA tracking is off</Trans>
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
          <Trans>
            Turn it on in Organization → Settings → SLA Setup, then set turnaround targets there or
            per vendor on the Metadata page.
          </Trans>
        </p>
        <Link to="/org/settings" className="mt-4 inline-block">
          <Button size="sm" variant="outline">
            <Trans>Open SLA Setup</Trans>
          </Button>
        </Link>
      </div>
    );
  }

  const style = BAND_STYLE[data.health.band] ?? BAND_STYLE.unknown;
  const DirectionIcon =
    data.health.direction === 'improving'
      ? ArrowUpRightIcon
      : data.health.direction === 'declining'
        ? ArrowDownRightIcon
        : ArrowRightIcon;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            <Trans>SLA</Trans>
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Invoice turnaround against target, measured in business hours from the moment the
              invoice reaches the inbox.
            </Trans>
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((range) => (
            <Button
              key={range.days}
              size="sm"
              variant={days === range.days ? 'default' : 'outline'}
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Health + forecast */}
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-6">
          <HealthGauge score={data.health.score} band={data.health.band} />

          <div className="min-w-[200px] flex-1">
            <p className={`text-[15px] font-semibold ${style.text}`}>{style.label}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              <Trans>
                Across {data.total} invoices in the last {data.days} days. Items already past
                target count against the score rather than waiting to be finished. Scored on the
                internal and end-to-end clocks; the signing clock is reported beside them but not
                folded in, so this number means the same thing it did before it existed.
              </Trans>
            </p>

            {data.health.deltaPoints !== null && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px]">
                <DirectionIcon
                  className={`h-3.5 w-3.5 ${
                    data.health.direction === 'improving'
                      ? 'text-emerald-600'
                      : data.health.direction === 'declining'
                        ? 'text-red-600'
                        : 'text-muted-foreground'
                  }`}
                />
                <span className="capitalize">{data.health.direction}</span>
                <span className="text-muted-foreground">
                  {data.health.deltaPoints > 0 ? '+' : ''}
                  {data.health.deltaPoints} pts
                  {data.health.trendSpan
                    ? ` · ${bucketLabel(data.health.trendSpan.from, data.health.trendSpan.to)}`
                    : ''}
                </span>
              </p>
            )}
          </div>

          <div className="min-w-[190px] rounded-md border border-border p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              <TimerIcon className="h-3.5 w-3.5" />
              <Trans>Will miss without action</Trans>
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              {data.forecast.willMissWithoutAction}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <Trans>
                {data.forecast.openBreached} over target and still open,{' '}
                {data.forecast.openAtRisk} past 80% with the clock running.
              </Trans>
            </p>
            {data.forecast.finishedLate > 0 && (
              <p className="mt-1 border-t border-border pt-1 text-[11px] text-muted-foreground">
                <Trans>
                  {data.forecast.finishedLate} more missed target but are already done — counted
                  against the score, not against you today.
                </Trans>
              </p>
            )}
          </div>
        </div>
      </div>

      {/*
        Three cards in the order the stages happen. The middle one is the whole
        reason the internal clock going quiet at the send is no longer a blind
        spot: it starts where that one stops.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <LegCard
          title={<Trans>Internal turnaround</Trans>}
          hint={<Trans>received → sent for signature · what your team controls</Trans>}
          leg={data.internal}
        />
        <LegCard
          title={<Trans>Waiting on signature</Trans>}
          hint={<Trans>sent → fully signed · what the signer controls</Trans>}
          leg={data.signing}
        />
        <LegCard
          title={<Trans>End to end</Trans>}
          hint={<Trans>received → fully signed · both stages together</Trans>}
          leg={data.endToEnd}
        />
      </div>

      {/*
        Said plainly rather than left to be inferred from an empty card: a leg
        with no target measures nothing, and a page of zeroes reads as "nothing
        is late" instead of "nothing is being watched".
      */}
      {data.signing.tracked === 0 && data.awaitingSignature > 0 && (
        <p className="rounded-[var(--r)] border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Trans>
            {data.awaitingSignature} invoice(s) are out for signature and unsigned, and none of them
            is being measured — no signing target is set. Set one under Settings → SLA, or on an
            individual vendor's Metadata record.
          </Trans>
        </p>
      )}

      {/* Trend */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <h2 className="text-[14px] font-semibold">
          <Trans>On-time trend</Trans>
        </h2>
        <p className="mb-3 mt-0.5 text-[12px] text-muted-foreground">
          <Trans>
            Grouped by when the invoice arrived, so each bar answers "how well did we handle what
            came in then". A bar counts clocks, not invoices — an invoice carrying all three
            targets contributes three.
          </Trans>
        </p>
        <TrendChart data={data.trend} />
      </div>

      {/* Overdue */}
      {data.breachedOpen.count > 0 && (
        <div className="rounded-[var(--r)] border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-red-700 dark:text-red-300">
            <AlertTriangleIcon className="h-4 w-4" />
            <Trans>{data.breachedOpen.count} overdue and still unsent</Trans>
          </h2>
          <ul className="mt-2 space-y-1">
            {data.breachedOpen.items.map((item) => (
              <li key={item.inboxItemId} className="flex justify-between text-[12px]">
                <Link
                  to={`/org/inbox/${item.inboxItemId}`}
                  className="truncate pr-3 text-red-700 hover:underline dark:text-red-300"
                >
                  {item.vendor ?? 'Unknown vendor'}
                </Link>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  <Trans>over by {shortDuration(item.overdueByMinutes)}</Trans>
                </span>
              </li>
            ))}
          </ul>
          {data.breachedOpen.count > data.breachedOpen.items.length && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              <Trans>
                Showing the {data.breachedOpen.items.length} longest-waiting of{' '}
                {data.breachedOpen.count}.
              </Trans>
            </p>
          )}
        </div>
      )}

      {/*
        Its own panel, not appended to the one above. Both lists are late
        invoices; only one of them is anybody here's fault, and merging them
        produces a to-do list where half the entries have no action attached.
      */}
      {data.unsignedOpen.count > 0 && (
        <div className="rounded-[var(--r)] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangleIcon className="h-4 w-4" />
            <Trans>{data.unsignedOpen.count} sent and still unsigned past target</Trans>
          </h2>
          <p className="mt-0.5 text-[12px] text-amber-800/80 dark:text-amber-200/80">
            <Trans>These are with the signer. A reminder is the action, not reprocessing.</Trans>
          </p>
          <ul className="mt-2 space-y-1">
            {data.unsignedOpen.items.map((item) => (
              <li key={item.inboxItemId} className="flex justify-between text-[12px]">
                <Link
                  to={`/org/inbox/${item.inboxItemId}`}
                  className="truncate pr-3 text-amber-800 hover:underline dark:text-amber-200"
                >
                  {item.vendor ?? 'Unknown vendor'}
                </Link>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  <Trans>over by {shortDuration(item.overdueByMinutes)}</Trans>
                </span>
              </li>
            ))}
          </ul>
          {data.unsignedOpen.count > data.unsignedOpen.items.length && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              <Trans>
                Showing the {data.unsignedOpen.items.length} longest-waiting of{' '}
                {data.unsignedOpen.count}.
              </Trans>
            </p>
          )}
        </div>
      )}

      {/* Vendors */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="text-[14px] font-semibold">
            <Trans>By vendor</Trans>
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            <Trans>
              Worst first. Average turnaround covers invoices that have actually been sent, late
              ones included, so it is not flattered by the ones that went out fastest. A vendor
              consistently missing target may simply need a longer one set on its Metadata record.
            </Trans>
          </p>
        </div>
        {data.vendors.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-muted-foreground">
            <Trans>No invoices in this window.</Trans>
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  <Trans key="v">Vendor</Trans>,
                  <Trans key="i">Invoices</Trans>,
                  // Every column after the first measures the internal clock
                  // only — a vendor's end-to-end misses are not in these.
                  <Trans key="o">On time (to send)</Trans>,
                  <Trans key="b">Breached (to send)</Trans>,
                  <Trans key="a">Avg time to send</Trans>,
                ].map((label, i) => (
                  <th
                    key={i}
                    className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground ${
                      i === 0 ? 'text-left' : 'text-right'
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((vendor) => (
                <tr key={vendor.vendor} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-[13px]">{vendor.vendor}</td>
                  <td className="px-4 py-2.5 text-right text-[13px] tabular-nums">{vendor.total}</td>
                  <td
                    className={`px-4 py-2.5 text-right text-[13px] font-medium tabular-nums ${rateTone(vendor.onTimeRate)}`}
                  >
                    {pct(vendor.onTimeRate)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[13px] tabular-nums">
                    {vendor.breached || '—'}
                    {vendor.openBreached > 0 && (
                      <span className="ml-1 text-[11px] text-red-600 dark:text-red-400">
                        <Trans>({vendor.openBreached} open)</Trans>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-muted-foreground">
                    {vendor.avgInternalMinutes === null ? (
                      '—'
                    ) : (
                      <>
                        {shortDuration(vendor.avgInternalMinutes)}
                        <span className="ml-1 text-[11px] opacity-60">
                          <Trans>(n={vendor.avgSampleSize})</Trans>
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-1">
        {data.untracked > 0 && (
          <p className="text-[11px] text-muted-foreground">
            <Trans>
              {data.untracked} item(s) are missing a target on at least one clock and are excluded
              from it — set one on the vendor's Metadata record, or an organization default in
              Settings.
            </Trans>
          </p>
        )}
        {data.archived > 0 && (
          <p className="text-[11px] text-muted-foreground">
            <Trans>
              {data.archived} archived invoice(s) from this window are not measured, so archiving a
              late invoice removes it from these figures.
            </Trans>
          </p>
        )}
        {data.truncated && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            <Trans>
              {data.truncated.inRange} invoices arrived in this window but only the most recent{' '}
              {data.truncated.evaluated} were measured. Every figure above describes that subset.
            </Trans>
          </p>
        )}
        {data.ingestTimed > 0 && (
          <p className="text-[11px] text-muted-foreground">
            <Trans>
              {data.ingestTimed} of {data.total} invoices have no arrival time from the mail server,
              so their clock starts when HubSign ingested them. If the inbox poller was ever down,
              those invoices look faster than they were.
            </Trans>
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          <Trans>
            The clock starts when the invoice reached the mailbox. Health is scored over{' '}
            {data.health.judged} decided outcomes across the internal and end-to-end clocks, so an
            invoice carrying both targets counts twice.
          </Trans>
        </p>
      </div>
    </div>
  );
}
