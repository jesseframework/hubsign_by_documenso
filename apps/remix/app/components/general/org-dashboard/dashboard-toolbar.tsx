import { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { DateTime } from 'luxon';
import { RefreshCwIcon, XIcon } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';

export type DashboardRange = { from?: string; to?: string };

/** Interval options, in ms. `0` means no polling. */
export const REFRESH_INTERVALS = [
  { ms: 0, label: 'Off' },
  { ms: 30_000, label: '30 seconds' },
  { ms: 60_000, label: '1 minute' },
  { ms: 300_000, label: '5 minutes' },
  { ms: 600_000, label: '10 minutes' },
] as const;

const REFRESH_STORAGE_KEY = 'hubsign.org-dashboard.refresh-ms';

/**
 * Reads the persisted interval. Kept in localStorage rather than component state
 * so the choice survives navigation — an auto-refresh you have to re-pick every
 * visit isn't one.
 */
export const readStoredRefreshMs = (): number => {
  if (typeof window === 'undefined') return 0;

  const raw = window.localStorage.getItem(REFRESH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : 0;

  // Only honour a value that's still on the menu; a stale or hand-edited entry
  // must not produce, say, a 50ms poll.
  return REFRESH_INTERVALS.some((option) => option.ms === parsed) ? parsed : 0;
};

const PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'mtd', label: 'Month to date', days: null },
  { key: '12m', label: 'Last 12 months', days: 365 },
] as const;

const fmt = (d: DateTime) => d.toFormat('yyyy-MM-dd');

const presetRange = (key: string): DashboardRange => {
  const today = DateTime.utc().startOf('day');

  if (key === 'mtd') {
    return { from: fmt(today.startOf('month')), to: fmt(today) };
  }

  const preset = PRESETS.find((p) => p.key === key);
  if (!preset?.days) return {};

  // Inclusive of today, so "last 7 days" spans 7 days rather than 8.
  return { from: fmt(today.minus({ days: preset.days - 1 })), to: fmt(today) };
};

export type DashboardToolbarProps = {
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  refreshMs: number;
  onRefreshMsChange: (ms: number) => void;
  onRefreshNow: () => void;
  isFetching: boolean;
  /** Server timestamp of the data currently on screen. */
  generatedAt?: string | null;
  /** Rendered at the start of the bar — used for the SLA entry point. */
  leading?: React.ReactNode;
};

export const DashboardToolbar = ({
  leading,
  range,
  onRangeChange,
  refreshMs,
  onRefreshMsChange,
  onRefreshNow,
  isFetching,
  generatedAt,
}: DashboardToolbarProps) => {
  // Re-render on a timer so "updated 45s ago" stays honest between refetches;
  // without this it would freeze at whatever it said when the data arrived.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!generatedAt) return;

    const timer = setInterval(() => setTick((t) => t + 1), 15_000);

    return () => clearInterval(timer);
  }, [generatedAt]);

  const activePreset =
    PRESETS.find((p) => {
      const candidate = presetRange(p.key);
      return candidate.from === range.from && candidate.to === range.to;
    })?.key ?? (range.from || range.to ? 'custom' : 'all');

  const updatedAgo = generatedAt
    ? DateTime.fromISO(generatedAt).toRelative({ style: 'narrow' })
    : null;

  const controlClass =
    'h-8 rounded-[var(--r-sm)] border border-border bg-card px-2 text-[12px] outline-none focus:border-primary';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--r)] border border-border bg-card p-2">
      {leading}
      <select
        className={cn(controlClass, 'font-medium')}
        value={activePreset}
        onChange={(e) => {
          const key = e.target.value;

          if (key === 'all') return onRangeChange({});
          // "Custom" is a display state, not a range — selecting it keeps
          // whatever dates are already in the two inputs.
          if (key === 'custom') return;

          onRangeChange(presetRange(key));
        }}
        aria-label="Date range preset"
      >
        <option value="all">All time</option>
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        {activePreset === 'custom' && <option value="custom">Custom</option>}
      </select>

      <div className="flex items-center gap-1">
        <input
          type="date"
          className={controlClass}
          value={range.from ?? ''}
          max={range.to ?? undefined}
          onChange={(e) => onRangeChange({ ...range, from: e.target.value || undefined })}
          aria-label="From date"
        />
        <span className="text-[12px] text-muted-foreground">–</span>
        <input
          type="date"
          className={controlClass}
          value={range.to ?? ''}
          min={range.from ?? undefined}
          onChange={(e) => onRangeChange({ ...range, to: e.target.value || undefined })}
          aria-label="To date"
        />

        {(range.from || range.to) && (
          <button
            type="button"
            onClick={() => onRangeChange({})}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] border border-border text-muted-foreground hover:bg-muted"
            aria-label="Clear date range"
            title="Clear date range"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {updatedAgo && (
          <span className="text-[11px] text-muted-foreground">
            <Trans>Updated {updatedAgo}</Trans>
          </span>
        )}

        <button
          type="button"
          onClick={onRefreshNow}
          disabled={isFetching}
          className="flex h-8 items-center gap-1.5 rounded-[var(--r-sm)] border border-border px-2 text-[12px] hover:bg-muted disabled:opacity-60"
          aria-label="Refresh now"
        >
          <RefreshCwIcon className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          <Trans>Refresh</Trans>
        </button>

        <select
          className={controlClass}
          value={refreshMs}
          onChange={(e) => onRefreshMsChange(Number(e.target.value))}
          aria-label="Auto-refresh interval"
          title="Auto-refresh interval"
        >
          {REFRESH_INTERVALS.map((option) => (
            <option key={option.ms} value={option.ms}>
              {option.ms === 0 ? 'Auto-refresh off' : `Every ${option.label}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
