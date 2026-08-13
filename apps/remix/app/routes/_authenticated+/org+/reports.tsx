import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ReceiptIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from 'lucide-react';
import { Link } from 'react-router';

import {
  BUILT_IN_REPORT_VIEW,
  REPORT_MEASURE_LABELS,
  type TReportConfig,
  describeReportConfig,
  isBuiltInViewId,
  isMoneyMeasure,
} from '@documenso/lib/universal/report-config';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { ReportBuilder } from '~/components/general/org-dashboard/report-builder';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Reports');
}

/**
 * Reports the organization builds for itself.
 *
 * This page was "Spend", shaped around two number fields one organization had
 * defined. The report was right; the shape was not — hard-wiring a page to
 * another org's custom fields leaves every other org with a page that cannot
 * answer their question, and no way to add one that does.
 *
 * So a report is a saved configuration: a measure, a grouping, a window, filters,
 * and optionally a number field to compare against. Spend by vendor is the
 * built-in one, present for everybody, and everything else the organization names
 * and saves for itself.
 *
 * Everything here is measured from figures OCR read off the invoices, so the page
 * is as much a report on the extraction as on the spend — which is why the
 * unmeasured invoices, the undated ones and the vendors missing from the directory
 * are all stated on its face rather than quietly excluded. A total that hides what
 * it could not count is worse than no total.
 */

/** Money with no decimals: at report scale the cents are noise. */
const money = (currency: string | null, value: number): string => {
  const formatted = Math.round(value).toLocaleString();
  return currency ? `${currency} ${formatted}` : formatted;
};

const pct = (share: number): string => `${Math.round(share * 100)}%`;

export default function ReportsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [viewId, setViewId] = useState<string>(BUILT_IN_REPORT_VIEW.id);
  const [config, setConfig] = useState<TReportConfig>({ ...BUILT_IN_REPORT_VIEW.config });
  const [editing, setEditing] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: viewList } = trpc.org.listReportViews.useQuery();
  const { data, isLoading } = trpc.org.getInvoiceReport.useQuery({ config });

  const views = viewList?.views ?? [{ ...BUILT_IN_REPORT_VIEW, builtIn: true }];
  const currentView = views.find((view) => view.id === viewId);
  /** True once the controls no longer match what the selected view holds. */
  const dirty = JSON.stringify(currentView?.config ?? null) !== JSON.stringify(config);

  const onSaved = (title: string) => {
    void utils.org.listReportViews.invalidate();
    setSaveAsName('');
    toast({ title });
  };

  const onError = (e: { message: string }) =>
    toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' });

  const upsertView = trpc.org.upsertReportView.useMutation({
    onSuccess: (saved) => {
      setViewId(saved.id);
      onSaved(_(msg`Report saved`));
    },
    onError,
  });

  const deleteView = trpc.org.deleteReportView.useMutation({
    onSuccess: () => {
      setViewId(BUILT_IN_REPORT_VIEW.id);
      setConfig({ ...BUILT_IN_REPORT_VIEW.config });
      onSaved(_(msg`Report deleted`));
    },
    onError,
  });

  const selectView = (id: string) => {
    const view = views.find((candidate) => candidate.id === id);
    if (!view) return;

    setViewId(id);
    setConfig(view.config as TReportConfig);
    setExpanded(null);
  };

  const budgeted = Boolean(data?.budgetField);
  const rows = data?.rows ?? [];
  // Bars are scaled against the biggest row, not against the total: with thirty
  // rows every bar would otherwise be a sliver, and the comparison between them is
  // the whole reason for the chart.
  const biggest = rows.at(0)?.total ?? 0;
  const money0 = (value: number) => money(data?.currency ?? null, value);
  const measureLabel = REPORT_MEASURE_LABELS[data?.measure ?? config.measure];

  const excluded = (data?.currencies ?? []).filter(
    (entry) => isMoneyMeasure(config.measure) && entry.code !== data?.currency,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            <Trans>Reports</Trans>
          </h1>
          <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">
            <Trans>
              What the invoices in your inbox come to, grouped however you need — by supplier, by
              month, or by any field you defined on your vendor records. Save the ones you use.
            </Trans>
          </p>
        </div>

        <Button
          size="sm"
          variant={editing ? 'default' : 'outline'}
          onClick={() => setEditing((open) => !open)}
        >
          <SlidersHorizontalIcon className="mr-1.5 h-3.5 w-3.5" />
          {editing ? <Trans>Done</Trans> : <Trans>Configure</Trans>}
        </Button>
      </div>

      {/*
        The saved views, as one row of chips. A list rather than a dropdown because
        with three or four saved reports the whole set is worth seeing, and each
        chip carries what its report actually does underneath its name.
      */}
      <div className="flex flex-wrap items-stretch gap-2">
        {views.map((view) => {
          const viewConfig = view.config as TReportConfig;
          const groupLabel =
            data?.groupOptions.find((option) => option.key === viewConfig.groupBy)?.label ??
            viewConfig.groupBy;
          const budgetLabel = data?.budgetOptions.find(
            (option) => option.key === viewConfig.budgetField,
          )?.label;

          return (
            <button
              key={view.id}
              type="button"
              className={`rounded-[var(--r-sm)] border px-3 py-1.5 text-left ${
                view.id === viewId
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:bg-muted/40'
              }`}
              onClick={() => selectView(view.id)}
            >
              <span className="block text-[13px] font-medium">
                {view.name}
                {view.id === viewId && dirty && (
                  <span className="text-muted-foreground ml-1.5 text-[10px] font-normal">
                    <Trans>edited</Trans>
                  </span>
                )}
              </span>
              <span className="text-muted-foreground block text-[10px]">
                {describeReportConfig(viewConfig, groupLabel, budgetLabel)}
              </span>
            </button>
          );
        })}
      </div>

      {editing && (
        <>
          <ReportBuilder
            config={config}
            onChange={setConfig}
            groupOptions={data?.groupOptions ?? []}
            budgetOptions={data?.budgetOptions ?? []}
            currencies={data?.currencies ?? []}
          />

          <div className="flex flex-wrap items-center gap-2">
            {/*
              Saving over the built-in view is not offered: it is a constant, the
              same for every organization, and the way back to a working report
              when a saved one goes wrong.
            */}
            {currentView && !isBuiltInViewId(currentView.id) && (
              <>
                <Button
                  size="sm"
                  disabled={!dirty || upsertView.isPending}
                  onClick={() =>
                    upsertView.mutate({ id: currentView.id, name: currentView.name, config })
                  }
                >
                  <Trans>Save changes</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={deleteView.isPending}
                  onClick={() => deleteView.mutate({ id: currentView.id })}
                >
                  <Trash2Icon className="mr-1 h-3.5 w-3.5" />
                  <Trans>Delete</Trans>
                </Button>
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Input
                className="h-8 max-w-[220px] text-[13px]"
                placeholder={_(msg`Name this report…`)}
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="whitespace-nowrap"
                disabled={saveAsName.trim() === '' || upsertView.isPending}
                onClick={() => upsertView.mutate({ name: saveAsName.trim(), config })}
              >
                <Trans>Save as new</Trans>
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-end gap-6 rounded-[var(--r)] border border-border bg-card p-4">
        <div>
          <p className="text-[11px] font-medium uppercase text-muted-foreground">{measureLabel}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {isMoneyMeasure(config.measure)
              ? money0(data?.totalSpend ?? 0)
              : (data?.totalSpend ?? 0).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            <Trans>Invoices</Trans>
          </p>
          <p className="text-2xl font-semibold tabular-nums">{data?.invoices ?? 0}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            <Trans>Groups</Trans>
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {rows.length + (data?.otherRows ?? 0)}
          </p>
        </div>

        {budgeted && (
          <>
            {/*
              Like for like: the budgeted vendors' own figures against their
              budgets. The report total includes vendors carrying no figure, and
              comparing that against the budget total made one budgeted supplier
              out of six read as thousands of percent overspent.
            */}
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">
                {data?.budgetLabel}
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {money0(data?.budgetedActual ?? 0)}
                <span className="text-base font-normal text-muted-foreground">
                  {' / '}
                  {money0(data?.budgetTotal ?? 0)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">
                <Trans>Variance</Trans>
              </p>
              <p
                className={`text-2xl font-semibold tabular-nums ${
                  (data?.budgetedActual ?? 0) > (data?.budgetTotal ?? 0)
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
                title={_(
                  msg`Across the vendors that carry a figure. Spend from vendors without one is excluded from both sides.`,
                )}
              >
                {(data?.budgetedActual ?? 0) > (data?.budgetTotal ?? 0) ? '+' : '−'}
                {money0(Math.abs((data?.budgetedActual ?? 0) - (data?.budgetTotal ?? 0)))}
              </p>
            </div>
          </>
        )}
      </div>

      {Boolean(
        (data?.withoutAmount ?? 0) > 0 ||
          excluded.length > 0 ||
          (data?.unidentifiedVendors ?? 0) > 0 ||
          (data?.doubtfulAmounts ?? 0) > 0,
      ) && (
        <div className="rounded-[var(--r)] border border-amber-500/30 bg-amber-50/50 p-3 dark:bg-amber-950/20">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            <Trans>What to know about this total</Trans>
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            {/*
              First, because it is the one that can make every figure above wrong
              by an order of magnitude — and unlike the others it is included in
              the total rather than left out of it.
            */}
            {(data?.doubtfulAmounts ?? 0) > 0 && (
              <li className="text-amber-700 dark:text-amber-300">
                <Trans>
                  {data?.doubtfulAmounts} invoice(s) totalling{' '}
                  {money(data?.currency ?? null, data?.doubtfulTotal ?? 0)} are more than 25× the
                  median invoice. They ARE counted above, but a figure that far out is usually OCR
                  reading the wrong number off the page — open the flagged rows and check.
                </Trans>
              </li>
            )}
            {(data?.withoutAmount ?? 0) > 0 && (
              <li>
                <Trans>
                  {data?.withoutAmount} invoice(s) had no readable total and are counted in none of
                  these figures — including the invoice count, so no two figures here describe
                  different sets.
                </Trans>
              </li>
            )}
            {(data?.excludedByFilters ?? 0) > 0 && (
              <li>
                <Trans>
                  {data?.excludedByFilters} invoice(s) were removed by this report's filters.
                </Trans>
              </li>
            )}
            {excluded.map((entry) => (
              <li key={entry.code}>
                <Trans>
                  {entry.invoices} invoice(s) in {entry.label} ({money(entry.code, entry.total)}) —
                  switch currency to see them. Amounts in different currencies are never added
                  together.
                </Trans>
              </li>
            ))}
            {(data?.unidentifiedVendors ?? 0) > 0 && (
              <li>
                <Trans>
                  {data?.unidentifiedVendors} invoice(s) are from a vendor with no directory record,
                  so they carry no custom field values.
                </Trans>
              </li>
            )}
            {budgeted && (
              <li>
                <Trans>
                  {data?.budgetLabel} is a single figure on each vendor and carries no period of its
                  own, so it is compared against the window selected above as-is — pick the window
                  the figure was written for.
                </Trans>
              </li>
            )}
            {budgeted && (data?.vendorsWithoutBudget ?? 0) > 0 && (
              <li>
                <Trans>
                  {data?.vendorsWithoutBudget} vendor(s) with invoices here have no{' '}
                  {data?.budgetLabel} set. Their spend is in the total above but excluded from the
                  variance, which compares only the vendors that carry a figure.
                </Trans>
              </li>
            )}
            {data && data.invoices > 0 && data.datedByInvoice < data.invoices && (
              <li>
                <Trans>
                  {data.invoices - data.datedByInvoice} invoice(s) had no readable invoice date and
                  are dated by when the email arrived.
                </Trans>
              </li>
            )}
          </ul>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Trans>Loading…</Trans>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <ReceiptIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>Nothing to measure yet</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
            <Trans>
              No invoice in this window had a total OCR could read. Widen the window, or check the
              extraction template on the vendors you expect to see.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-[13px] font-semibold">
              {budgeted ? (
                <Trans>
                  {measureLabel} by {data?.groupLabel} vs {data?.budgetLabel}
                </Trans>
              ) : (
                <Trans>
                  {measureLabel} by {data?.groupLabel}
                </Trans>
              )}
              {budgeted && (data?.overBudgetRows ?? 0) > 0 && (
                <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                  <Trans>{data?.overBudgetRows} over</Trans>
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {budgeted ? (
                <Trans>Biggest overrun first · click a row for its invoices</Trans>
              ) : (
                <Trans>Largest first · click a row for its invoices</Trans>
              )}
            </p>
          </div>

          <ul>
            {rows.map((row) => {
              const open = expanded === row.key;

              return (
                <li key={row.key} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
                    onClick={() => setExpanded(open ? null : row.key)}
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDownIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[13px] font-medium" title={row.label}>
                          {row.label}
                        </p>
                        <p className="flex-shrink-0 text-[13px] font-semibold tabular-nums">
                          {isMoneyMeasure(config.measure)
                            ? money0(row.total)
                            : row.total.toLocaleString()}
                        </p>
                      </div>

                      {/*
                        Without a budget the bar compares rows to each other; with
                        one it compares the row to its own limit, and the scale
                        stops at 100% so an overrun is visibly full rather than
                        merely long. The overspend is drawn as a separate red
                        segment past the mark it broke.
                      */}
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        {row.usedShare === null ? (
                          <div
                            /*
                              Muted while a budget is selected: a full-width brand
                              bar on an unmeasured row sat beside a full-width red
                              one on an overspent row and read as the same news.
                            */
                            className={`h-full rounded-full ${
                              budgeted ? 'bg-muted-foreground/25' : 'bg-[hsl(var(--brand-chart))]'
                            }`}
                            style={{ width: `${biggest > 0 ? (row.total / biggest) * 100 : 0}%` }}
                          />
                        ) : (
                          <div className="flex h-full">
                            <div
                              className={`h-full ${
                                row.usedShare > 1
                                  ? 'bg-red-500'
                                  : row.usedShare >= 0.9
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(100, row.usedShare * 100)}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        {/* An average as a fraction of the overall average is not a
                            share of anything, so the server sends 0 and it is not
                            shown. */}
                        {row.share > 0 && (
                          <span>
                            {pct(row.share)} <Trans>of total</Trans>
                          </span>
                        )}
                        {/* The invoice count IS the number for a count report, so
                            repeating it as a detail says nothing — and the mean of a
                            count is 1 by construction. */}
                        {isMoneyMeasure(config.measure) && (
                          <>
                            <span>
                              <Trans>{row.invoices} invoice(s)</Trans>
                            </span>
                            <span>
                              <Trans>avg</Trans>{' '}
                              <span className="tabular-nums">{money0(row.average)}</span>
                            </span>
                          </>
                        )}
                        {data?.groupBy !== 'vendor' && (
                          <span>
                            <Trans>{row.vendors} vendor(s)</Trans>
                          </span>
                        )}
                        {budgeted && row.budget !== null && (
                          <span
                            className={
                              row.usedShare !== null && row.usedShare > 1
                                ? 'font-medium text-red-600 dark:text-red-400'
                                : row.usedShare !== null && row.usedShare >= 0.9
                                  ? 'font-medium text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                            }
                          >
                            {row.usedShare !== null && (
                              <>
                                {Math.round(row.usedShare * 100)}%{' '}
                                <Trans>of</Trans>{' '}
                              </>
                            )}
                            <span className="tabular-nums">
                              {money(data?.currency ?? null, row.budget)}
                            </span>
                            {row.variance !== null && row.variance > 0 ? (
                              <>
                                {' · '}
                                <Trans>over by</Trans>{' '}
                                <span className="tabular-nums">
                                  {money(data?.currency ?? null, row.variance)}
                                </span>
                              </>
                            ) : row.variance !== null ? (
                              <>
                                {' · '}
                                <span className="tabular-nums">
                                  {money(data?.currency ?? null, -row.variance)}
                                </span>{' '}
                                <Trans>left</Trans>
                              </>
                            ) : null}
                            {row.budgetVendors > 1 && (
                              <>
                                {' '}
                                <Trans>(across {row.budgetVendors} vendors)</Trans>
                              </>
                            )}
                          </span>
                        )}
                        {budgeted && row.budget === null && (
                          <span title={_(msg`No figure set on this vendor's record.`)}>
                            <Trans>no {data?.budgetLabel} set</Trans>
                          </span>
                        )}
                        {row.overdueInvoices > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {isMoneyMeasure(config.measure) ? (
                              <Trans>
                                {money0(row.overdueTotal)} past due on {row.overdueInvoices}
                              </Trans>
                            ) : (
                              <Trans>{row.overdueInvoices} past due</Trans>
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-border bg-muted/20 px-4 py-2">
                      <ul className="space-y-1">
                        {row.items.map((item) => (
                          <li key={item.inboxItemId} className="flex items-baseline gap-2 text-[12px]">
                            <Link
                              to={`/org/inbox/${item.inboxItemId}`}
                              className="text-primary hover:underline"
                            >
                              {item.invoiceNumber || _(msg`(no number)`)}
                            </Link>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {data?.groupBy === 'vendor' ? '' : `${item.vendor} · `}
                              {item.date}
                              {item.dateBasis === 'arrival' && (
                                <span title={_(msg`Dated by when the email arrived — the invoice stated no date.`)}>
                                  {' '}
                                  <Trans>(arrival)</Trans>
                                </span>
                              )}
                              {item.daysPastDue !== null && item.daysPastDue > 0 && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {' · '}
                                  <Trans>{item.daysPastDue}d late</Trans>
                                </span>
                              )}
                            </span>
                            <span
                              className={`flex-shrink-0 font-medium tabular-nums ${
                                item.doubtful ? 'text-amber-600 dark:text-amber-400' : ''
                              }`}
                              title={
                                item.doubtful
                                  ? _(
                                      msg`More than 25× the median invoice — check that OCR read the right figure.`,
                                    )
                                  : undefined
                              }
                            >
                              {item.doubtful && '⚠ '}
                              {money(data?.currency ?? null, item.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {row.moreItems > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          <Trans>…and {row.moreItems} more invoice(s) in this group.</Trans>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {(data?.otherRows ?? 0) > 0 && (
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <Trans>
                {data?.otherRows} smaller group(s) totalling{' '}
                {isMoneyMeasure(config.measure)
                  ? money0(data?.otherRowsTotal ?? 0)
                  : (data?.otherRowsTotal ?? 0).toLocaleString()}{' '}
                are not listed.
              </Trans>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
