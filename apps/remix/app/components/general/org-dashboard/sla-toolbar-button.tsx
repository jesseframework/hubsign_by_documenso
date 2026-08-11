import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

/**
 * SLA entry point for the dashboard toolbar.
 *
 * The full breakdown lives at /org/sla. What belongs on the dashboard is one
 * glanceable signal — the health ring — and a way through. An earlier version
 * put the whole summary above the toolbar and it pushed the date filter, and
 * everything else, down the page.
 *
 * Renders nothing when SLA is off, so the toolbar stays as it was for
 * organizations that don't track turnaround.
 */

const BAND_RING: Record<string, string> = {
  healthy: 'stroke-emerald-500',
  watch: 'stroke-amber-500',
  critical: 'stroke-red-500',
  unknown: 'stroke-muted-foreground/40',
};

const BAND_TEXT: Record<string, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  watch: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
  unknown: 'text-muted-foreground',
};

/** 18px ring, filled in proportion to the score. */
function HealthDonut({ score, band }: { score: number | null; band: string }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const filled = ((score ?? 0) / 100) * circumference;

  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] flex-shrink-0 -rotate-90">
      <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="3" className="stroke-muted" />
      {score !== null && (
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          className={BAND_RING[band] ?? BAND_RING.unknown}
        />
      )}
    </svg>
  );
}

export function SlaToolbarButton() {
  const { data } = trpc.inbox.slaStats.useQuery({ days: 30 });

  if (!data?.enabled) {
    return null;
  }

  const atRisk = data.forecast.willMissWithoutAction;

  return (
    <Link
      to="/org/sla"
      title={`SLA health ${data.health.score ?? '—'}/100 · ${atRisk} will miss without action`}
      className="flex h-8 items-center gap-1.5 rounded-[var(--r-sm)] border border-border bg-card px-2 text-[12px] font-medium transition-colors hover:border-primary/50"
    >
      <HealthDonut score={data.health.score} band={data.health.band} />
      <span>
        <Trans>SLA</Trans>
      </span>
      <span className={`tabular-nums ${BAND_TEXT[data.health.band] ?? BAND_TEXT.unknown}`}>
        {data.health.score ?? '—'}
      </span>
      {atRisk > 0 && (
        <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold tabular-nums text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {atRisk}
        </span>
      )}
    </Link>
  );
}
