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
  UserXIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { CardMetric } from '~/components/general/metric-card';
import { ChartCard } from '~/components/general/org-dashboard/chart-card';
import { SlaToolbarButton } from '~/components/general/org-dashboard/sla-toolbar-button';
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
import {
  type BottleneckDetail,
  BottleneckDetailDialog,
  OverdueByVendorTile,
  WaitingOnTile,
  WhereItsStuckTile,
} from '~/components/general/dashboard/bottleneck-tiles';
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
  /** Which bottleneck tile has been opened for its full detail. */
  const [detail, setDetail] = useState<BottleneckDetail>(null);

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
  const undated = stats.ageBuckets.find((bucket) => bucket.key === 'unknown')?.count ?? 0;
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
        leading={<SlaToolbarButton />}
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
          // The population these buckets actually cover — unsettled invoices from
          // the inbox — not the pending-document count, which is a different set
          // and left the slices not adding up to the number above them.
          value={stats.agingOpenInvoices}
          icon={ClockIcon}
          iconBg="bg-status-pending-bg"
          iconColor={status.pending}
          /*
            Worst first, then the caveat, then the scope. `undated` is reported
            rather than rounded away: those invoices are the ones the aging figures
            cannot speak for, and a clean chart that quietly excludes them is the
            misleading version. The scope is stated because this headline counts a
            different population from the pending figure beside it.
          */
          footer={
            overdue > 0 ? (
              <span style={{ color: status.rejected }}>
                <Trans>{overdue} more than 90 days past due</Trans>
              </span>
            ) : undated > 0 ? (
              <Trans>{undated} undated · unsettled inbox invoices</Trans>
            ) : (
              <Trans>Unsettled inbox invoices, any date range</Trans>
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

        {/*
          These three replaced the approval charts and the top-sender bar. Both
          approval tiles read 0 because the module is unused, and the sender bar
          was a single bar because every document arrives through one mailbox —
          three tiles of screen showing nothing actionable. What was missing was
          the question the queue is opened to answer: who is holding this up.

          Each is a summary at the height of its row, with the full list behind
          a click. Three different plot shapes, so they read as three questions
          rather than one chart repeated.
        */}
        <ChartCard
          title={<Trans>Waiting on</Trans>}
          value={stats.bottlenecks.totalOpen}
          icon={UserXIcon}
          iconBg="bg-status-pending-bg"
          iconColor={status.pending}
          onClick={() => setDetail('waiting')}
          footer={<Trans>Outstanding signatures, by person</Trans>}
        >
          <WaitingOnTile
            people={stats.bottlenecks.people}
            otherPeople={stats.bottlenecks.otherPeople}
          />
        </ChartCard>

        <ChartCard
          title={<Trans>Where it's stuck</Trans>}
          value={stats.bottlenecks.totalOpen}
          icon={AlertTriangleIcon}
          iconBg="bg-status-draft-bg"
          iconColor={status.draft}
          onClick={() => setDetail('stuck')}
          footer={<Trans>What is actually holding them up</Trans>}
        >
          <WhereItsStuckTile
            stages={stats.bottlenecks.stages}
            chase={stats.bottlenecks.chase}
            totalOpen={stats.bottlenecks.totalOpen}
          />
        </ChartCard>

        <ChartCard
          title={<Trans>Overdue by vendor</Trans>}
          value={stats.bottlenecks.vendors.rows.reduce((sum, row) => sum + row.overdue, 0)}
          icon={ClockIcon}
          iconBg="bg-status-rejected-bg"
          iconColor={status.rejected}
          onClick={() => setDetail('vendors')}
          // Names the basis, because "overdue" against our own turnaround target
          // and overdue against the vendor's due date are different claims and
          // this card used to make the first while appearing to make the second.
          footer={<Trans>Past the invoice due date, still unsigned</Trans>}
        >
          <OverdueByVendorTile
            rows={stats.bottlenecks.vendors.rows}
            unattributed={stats.bottlenecks.vendors.unattributed}
            noDueDate={stats.bottlenecks.vendors.noDueDate}
          />
        </ChartCard>
      </div>

      <BottleneckDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
        people={stats.bottlenecks.people}
        stages={stats.bottlenecks.stages}
        chase={stats.bottlenecks.chase}
        totalOpen={stats.bottlenecks.totalOpen}
        vendors={stats.bottlenecks.vendors}
      />
    </div>
  );
}

