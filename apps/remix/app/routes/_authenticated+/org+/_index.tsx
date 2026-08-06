import { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BarChart3Icon,
  CheckCheckIcon,
  ClipboardCheckIcon,
  ClockIcon,
  FileTextIcon,
  HourglassIcon,
  InboxIcon,
  PenLineIcon,
  UsersIcon,
  WorkflowIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { CardMetric } from '~/components/general/metric-card';
import { ChartCard } from '~/components/general/org-dashboard/chart-card';
import type { DashboardRange } from '~/components/general/org-dashboard/dashboard-toolbar';
import {
  DashboardToolbar,
  readStoredRefreshMs,
} from '~/components/general/org-dashboard/dashboard-toolbar';
import { AGING_RAMP, BRAND, STATUS_COLORS } from '~/components/general/org-dashboard/chart-tokens';
import { DonutChart } from '~/components/general/org-dashboard/donut-chart';
import {
  ComparisonBarChart,
  TrendAreaChart,
} from '~/components/general/org-dashboard/trend-chart';
import { useChartMode } from '~/components/general/org-dashboard/use-chart-mode';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Dashboard');
}

export default function OrgDashboard() {
  const mode = useChartMode();
  const status = STATUS_COLORS[mode];
  const aging = AGING_RAMP[mode];

  const { data: org } = trpc.org.getMyOrganization.useQuery();

  const [range, setRange] = useState<DashboardRange>({});
  // Initialised from localStorage in an effect rather than at useState time, so
  // the server render and the first client render agree (no hydration mismatch).
  const [refreshMs, setRefreshMs] = useState(0);

  useEffect(() => setRefreshMs(readStoredRefreshMs()), []);

  const {
    data: stats,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = trpc.org.getDashboardStats.useQuery(range, {
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    // Keep polling while the tab is backgrounded off: a dashboard left open on a
    // wall display should stay current, but there's no reason to poll a tab
    // nobody is looking at.
    refetchIntervalInBackground: false,
    // Show the previous numbers while a refetch is in flight instead of dropping
    // to the loading state on every poll.
    placeholderData: (previous) => previous,
  });

  const onRefreshMsChange = (ms: number) => {
    setRefreshMs(ms);
    window.localStorage.setItem('hubsign.org-dashboard.refresh-ms', String(ms));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-[13px] text-muted-foreground">
        <Trans>Loading dashboard...</Trans>
      </div>
    );
  }

  // Without this branch a settled error left `isLoading` false and rendered the
  // whole dashboard from `?? 0` fallbacks — a page full of authoritative-looking
  // zeros that were actually the absence of data. Users with no organization
  // hit exactly that path, since the procedure throws FORBIDDEN for them.
  if (isError || !stats) {
    const isNotAMember = error?.data?.code === 'FORBIDDEN';

    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--r)] border border-border bg-card py-20 text-center">
        <AlertTriangleIcon className="mb-3 h-9 w-9 text-muted-foreground opacity-50" />
        <p className="text-[14px] font-medium text-foreground">
          {isNotAMember ? (
            <Trans>You're not part of an organization</Trans>
          ) : (
            <Trans>Dashboard unavailable</Trans>
          )}
        </p>
        <p className="mt-1 max-w-sm text-[12px] text-muted-foreground">
          {isNotAMember ? (
            <Trans>
              Organization dashboards are only available to members. Ask an admin to invite you.
            </Trans>
          ) : (
            <Trans>
              These figures couldn't be loaded, so nothing is shown rather than showing zeros.
              Refresh to try again.
            </Trans>
          )}
        </p>
      </div>
    );
  }

  // Past this point `stats` is narrowed to a real payload, so nothing below
  // needs a `?? 0` fallback — every figure on the page is a value the server
  // actually computed, never a stand-in for a failed request.
  const overdue = stats.ageBuckets.find((bucket) => bucket.key === '90+')?.count ?? 0;
  const momChange = stats.monthOverMonth.percentChange;
  const MomIcon =
    momChange === null || momChange === 0
      ? ArrowRightIcon
      : momChange > 0
        ? ArrowUpRightIcon
        : ArrowDownRightIcon;

  // Labels must describe the period the server actually used, or a selected
  // range leaves every caption claiming "All time" / "Last 12 months".
  const periodLabel = stats.range.active
    ? `${stats.range.from ?? 'earliest'} to ${stats.range.to ?? 'today'}`
    : 'All time';
  const trendLabel = stats.range.active ? periodLabel : 'Last 12 months';
  // The chart buckets by day on short ranges, so "Monthly" would be wrong.
  const trendTitle =
    stats.range.grain === 'day' ? 'Daily Document Trend' : 'Monthly Document Trend';

  const inboxSourced = stats.inboxSourced;
  const activeWorkflows = stats.activeWorkflows;
  const approvalsTotal =
    stats.approvalsOpen +
    stats.approvalsApproved +
    stats.approvalsRejected +
    stats.approvalsCancelled;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          <Trans>Dashboard</Trans>
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {org?.organization?.name ? (
            <Trans>Welcome back — here's how {org.organization.name} is tracking.</Trans>
          ) : (
            <Trans>Welcome back.</Trans>
          )}
        </p>
      </div>

      <DashboardToolbar
        range={range}
        onRangeChange={setRange}
        refreshMs={refreshMs}
        onRefreshMsChange={onRefreshMsChange}
        onRefreshNow={() => void refetch()}
        isFetching={isFetching}
        generatedAt={stats.generatedAt}
      />

      {/* ── Headline counters ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardMetric
          icon={FileTextIcon}
          title="Total Documents"
          value={stats.totalDocuments}
          subtitle={periodLabel}
          accentColor={BRAND.primary}
          iconBgColor={BRAND.primaryTint}
          href="/documents"
        />
        <CardMetric
          icon={ClipboardCheckIcon}
          title="Open Approvals"
          value={stats.approvalsOpen}
          subtitle="Awaiting a decision"
          accentColor={status.pending}
          iconBg="bg-status-pending-bg"
          href="/org/approvals"
        />
        <CardMetric
          icon={PenLineIcon}
          title="Awaiting Signature"
          value={stats.pending}
          subtitle="Out for signature"
          accentColor={aging[2]}
          iconBg="bg-status-inbox-bg"
          href="/documents"
        />
        <CardMetric
          icon={CheckCheckIcon}
          title="Completed"
          value={stats.completed}
          subtitle="Fully signed"
          accentColor={status.complete}
          iconBg="bg-status-complete-bg"
          href="/documents"
        />
      </div>

      {/* ── Distribution, trend, aging, source ── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ChartCard
          title={<Trans>Document Status</Trans>}
          value={stats.totalDocuments}
          icon={FileTextIcon}
          iconBgColor={BRAND.primaryTint}
          iconColor={BRAND.primary}
          footer={<Trans>Across all organization members</Trans>}
        >
          <DonutChart
            data={[
              { label: 'Completed', value: stats.completed, color: status.complete },
              { label: 'Pending', value: stats.pending, color: status.pending },
              { label: 'Draft', value: stats.draft, color: status.draft },
              { label: 'Rejected', value: stats.rejected, color: status.rejected },
            ]}
          />
        </ChartCard>

        <ChartCard
          title={trendTitle}
          // The charted total, not the all-time one — this headline sits above
          // a 12-month chart and a "Last 12 months" caption.
          value={stats.documentsCharted}
          icon={BarChart3Icon}
          iconBgColor={BRAND.primaryTint}
          iconColor={BRAND.primary}
          footer={trendLabel}
        >
          <TrendAreaChart data={stats.documentTrend} seriesName="Documents" />
        </ChartCard>

        <ChartCard
          title={<Trans>Signature Aging</Trans>}
          value={stats.pending}
          icon={ClockIcon}
          iconBg="bg-status-pending-bg"
          iconColor={status.pending}
          footer={
            overdue > 0 ? (
              <span style={{ color: status.rejected }}>
                <Trans>{overdue} outstanding beyond 90 days</Trans>
              </span>
            ) : (
              <Trans>Nothing outstanding beyond 90 days</Trans>
            )
          }
        >
          <DonutChart
            data={stats.ageBuckets.map((bucket, index) => ({
              label: bucket.label,
              value: bucket.count,
              color: aging[index],
            }))}
          />
        </ChartCard>

        <ChartCard
          title={<Trans>Document Source</Trans>}
          value={stats.totalDocuments}
          icon={InboxIcon}
          iconBgColor={BRAND.primaryTint}
          iconColor={BRAND.primary}
          footer={<Trans>{inboxSourced} arrived via the signature inbox</Trans>}
        >
          <DonutChart
            solid
            data={[
              { label: 'Email inbox', value: stats.inboxSourced, color: BRAND.primary },
              { label: 'Created manually', value: stats.manualSourced, color: BRAND.gold },
            ]}
          />
        </ChartCard>
      </div>

      {/* ── Momentum, approvals, top senders ── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ChartCard
          title={<Trans>Month-over-Month</Trans>}
          icon={BarChart3Icon}
          iconBgColor={BRAND.primaryTint}
          iconColor={BRAND.primary}
          footer={
            <>
              <Trans>
                Month to date vs the same first {stats.monthOverMonth.throughDay} days last month
              </Trans>
              {/*
                This card is defined by calendar months, so it deliberately does
                not follow the selected range. Saying so beats letting it look
                like part of the filtered period.
              */}
              {stats.range.active && (
                <span className="mt-0.5 block italic">
                  <Trans>Not affected by the selected date range</Trans>
                </span>
              )}
            </>
          }
        >
          <div className="mb-1 flex items-center gap-1.5">
            <MomIcon
              className="h-5 w-5"
              style={{
                color:
                  momChange === null || momChange === 0
                    ? status.draft
                    : momChange > 0
                      ? status.complete
                      : status.rejected,
              }}
            />
            <span className="text-2xl font-semibold leading-none text-foreground">
              {/* Percent change from a zero base is undefined — say so rather
                  than printing a number that reads as a real measurement. */}
              {momChange === null ? (
                <Trans>New activity</Trans>
              ) : (
                `${Math.abs(momChange).toFixed(1)}%`
              )}
            </span>
          </div>

          {/*
            These two bars are the exact operands of the percentage above. They
            used to chart full months while the percentage compared like-for-like
            windows, so the card showed a large increase over two equal-looking
            bars.
          */}
          <ComparisonBarChart
            data={[
              {
                label: stats.monthOverMonth.previousLabel,
                count: stats.monthOverMonth.previousToDate,
              },
              { label: stats.monthOverMonth.currentLabel, count: stats.monthOverMonth.current },
            ]}
          />
        </ChartCard>

        <ChartCard
          title={<Trans>Approval Requests</Trans>}
          value={approvalsTotal}
          icon={ClipboardCheckIcon}
          iconBg="bg-status-complete-bg"
          iconColor={status.complete}
          footer={<Trans>{activeWorkflows} workflows currently enabled</Trans>}
        >
          <DonutChart
            data={[
              { label: 'Approved', value: stats.approvalsApproved, color: status.complete },
              { label: 'Open', value: stats.approvalsOpen, color: status.pending },
              { label: 'Cancelled', value: stats.approvalsCancelled, color: status.draft },
              { label: 'Rejected', value: stats.approvalsRejected, color: status.rejected },
            ]}
          />
        </ChartCard>

        <ChartCard
          title={<Trans>Approval Timeline</Trans>}
          value={stats.approvalsCharted}
          icon={WorkflowIcon}
          iconBgColor={BRAND.primaryTint}
          iconColor={BRAND.primary}
          footer={trendLabel}
        >
          <TrendAreaChart data={stats.approvalTrend} seriesName="Approvals" />
        </ChartCard>

        <ChartCard
          title={
            stats.distinctSenders > stats.topSenders.length ? (
              <Trans>Top Senders (of {stats.distinctSenders})</Trans>
            ) : (
              <Trans>Top Senders</Trans>
            )
          }
          // Deliberately no headline figure: the old one was the length of a
          // take:5 list, so it could never exceed 5 and wasn't a metric.
          icon={UsersIcon}
          iconBg="bg-muted"
          iconColor={status.draft}
          footer={
            <Link to="/org/members" className="hover:underline">
              <Trans>Manage members</Trans>
            </Link>
          }
        >
          <TopSenders senders={stats.topSenders} />
        </ChartCard>
      </div>
    </div>
  );
}

/**
 * Ranked member list. The bar behind each row encodes share of the top sender's
 * volume, so the ranking is readable without comparing the numerals — but the
 * count is printed too, since the bar alone is a weak channel at these widths.
 */
const TopSenders = ({
  senders,
}: {
  senders: Array<{ userId: number; name: string; email: string; count: number }>;
}) => {
  if (senders.length === 0) {
    return (
      <div className="flex h-[180px] flex-col items-center justify-center text-muted-foreground">
        <HourglassIcon className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-[12px]">
          <Trans>No documents sent yet</Trans>
        </p>
      </div>
    );
  }

  const max = Math.max(...senders.map((sender) => sender.count), 1);

  return (
    <ul className="space-y-2">
      {senders.map((sender) => (
        <li key={sender.userId}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">{sender.name}</span>
            <span className="flex-shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {sender.count.toLocaleString()}
            </span>
          </div>

          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((sender.count / max) * 100, 4)}%`,
                background: BRAND.primary,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};
