import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { PERIOD_LABEL_MAP } from '@documenso/ee/server-only/limits/period-label';
import { isApproachingLimit } from '@documenso/ee/server-only/limits/thresholds';
import { cn } from '@documenso/ui/lib/utils';

export type SidebarUsageIndicatorProps = {
  billingUrl: string;
  sidebarTextColor?: string;
};

type UsageRowProps = {
  label: React.ReactNode;
  used: number;
  quota: number;
  sidebarTextColor?: string;
};

/** Renders nothing for unlimited (`Infinity`) quotas — there's no meaningful ratio to show. */
const UsageRow = ({ label, used, quota, sidebarTextColor }: UsageRowProps) => {
  if (!Number.isFinite(quota) || quota <= 0) {
    return null;
  }

  const remaining = Math.max(quota - used, 0);
  const isExceeded = remaining <= 0;
  const isWarning = !isExceeded && isApproachingLimit(quota, remaining);
  const percent = Math.min((used / quota) * 100, 100);

  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-[10.5px]">
        <span
          className={!sidebarTextColor ? 'text-muted-foreground' : undefined}
          style={sidebarTextColor ? { color: `${sidebarTextColor}90` } : undefined}
        >
          {label}
        </span>
        <span
          className={cn(
            'font-medium',
            !sidebarTextColor &&
              (isExceeded
                ? 'text-red-600 dark:text-red-400'
                : isWarning
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground'),
          )}
          style={
            sidebarTextColor
              ? { color: isExceeded ? '#ef4444' : isWarning ? '#f59e0b' : sidebarTextColor }
              : undefined
          }
        >
          {used}/{quota}
        </span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isExceeded ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-primary/60',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Persistent usage widget for the sidebar — the only other places quota usage
 * surfaces are hover-only tooltips (personal accounts only) or alert banners
 * that stay hidden until you're already at 80%+. Renders nothing once every
 * tracked quota is unlimited (paid unlimited tier, or billing disabled
 * entirely, since `SELFHOSTED_PLAN_LIMITS` is also `Infinity`-based).
 */
export const SidebarUsageIndicator = ({
  billingUrl,
  sidebarTextColor,
}: SidebarUsageIndicatorProps) => {
  const { quota, remaining } = useLimits();
  const { _ } = useLingui();
  const periodLabel = _(PERIOD_LABEL_MAP[quota.period]);

  const showDocuments = Number.isFinite(quota.documents);
  const showDirectTemplates = Number.isFinite(quota.directTemplates);
  const showOcrPages = Number.isFinite(quota.ocrPages);

  if (!showDocuments && !showDirectTemplates && !showOcrPages) {
    return null;
  }

  const documentsUsed = Math.max(quota.documents - remaining.documents, 0);
  const directTemplatesUsed = Math.max(quota.directTemplates - remaining.directTemplates, 0);
  const ocrPagesUsed = Math.max(quota.ocrPages - remaining.ocrPages, 0);

  const isAnyLimitClose =
    (showDocuments &&
      (remaining.documents <= 0 || isApproachingLimit(quota.documents, remaining.documents))) ||
    (showDirectTemplates &&
      (remaining.directTemplates <= 0 ||
        isApproachingLimit(quota.directTemplates, remaining.directTemplates))) ||
    // Soft-stop, not a hard block (see the OCR runners) — still worth the
    // same "you're close/at the limit" nudge as documents/directTemplates.
    (showOcrPages &&
      (remaining.ocrPages <= 0 || isApproachingLimit(quota.ocrPages, remaining.ocrPages)));

  return (
    <div
      className="border-t px-3 py-2.5"
      style={{ borderColor: sidebarTextColor ? `${sidebarTextColor}20` : 'hsl(var(--sidebar-border))' }}
    >
      {showDocuments && (
        <UsageRow
          label={<Trans>Signature requests this {periodLabel}</Trans>}
          used={documentsUsed}
          quota={quota.documents}
          sidebarTextColor={sidebarTextColor}
        />
      )}

      {showDirectTemplates && (
        <UsageRow
          label={<Trans>Direct templates</Trans>}
          used={directTemplatesUsed}
          quota={quota.directTemplates}
          sidebarTextColor={sidebarTextColor}
        />
      )}

      {showOcrPages && (
        <UsageRow
          label={<Trans>Smart OCR pages this {periodLabel}</Trans>}
          used={ocrPagesUsed}
          quota={quota.ocrPages}
          sidebarTextColor={sidebarTextColor}
        />
      )}

      {isAnyLimitClose && (
        <Link
          to={billingUrl}
          className="mt-1 block text-[10px] font-medium text-primary hover:underline"
        >
          <Trans>Upgrade plan</Trans>
        </Link>
      )}
    </div>
  );
};
