import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { PlusIcon, XIcon } from 'lucide-react';

import {
  REPORT_FILTER_OPS,
  REPORT_FILTER_OP_LABELS,
  REPORT_MEASURES,
  REPORT_MEASURE_LABELS,
  type TReportConfig,
  type TReportFilter,
  isMoneyMeasure,
} from '@documenso/lib/universal/report-config';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';

/**
 * The controls that define a report.
 *
 * Separated from the page because a saved view and the thing being edited are the
 * same object, and keeping the editor in one component makes that hard to forget:
 * every control here writes to the config, and the config is what gets saved.
 */

const WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
  { days: 730, label: '24 months' },
];

const selectClass = 'h-8 rounded-md border border-border bg-card px-2 text-[13px]';
const labelClass = 'mb-1 block text-[11px] font-medium text-muted-foreground';

export type ReportBuilderProps = {
  config: TReportConfig;
  onChange: (config: TReportConfig) => void;
  groupOptions: { key: string; label: string }[];
  budgetOptions: { key: string; label: string }[];
  currencies: { code: string; label: string; invoices: number }[];
};

export function ReportBuilder({
  config,
  onChange,
  groupOptions,
  budgetOptions,
  currencies,
}: ReportBuilderProps) {
  const { _ } = useLingui();

  const set = (patch: Partial<TReportConfig>) => onChange({ ...config, ...patch });

  const setFilter = (index: number, patch: Partial<TReportFilter>) =>
    set({
      filters: config.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)),
    });

  /*
    Everything a filter can read: the invoice's own figure and identity, plus every
    field the organization defined — including the number fields, which are useless
    as an axis and perfectly good as a condition ("limit is more than 10000").
  */
  const filterFields = [
    { key: 'amount', label: 'Invoice amount' },
    ...groupOptions,
    ...budgetOptions,
  ];

  return (
    <div className="space-y-3 rounded-[var(--r)] border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass} htmlFor="report-measure">
            <Trans>Measure</Trans>
          </label>
          <select
            id="report-measure"
            className={`${selectClass} min-w-[150px]`}
            value={config.measure}
            onChange={(e) =>
              set({ measure: e.target.value as TReportConfig['measure'] })
            }
          >
            {REPORT_MEASURES.map((measure) => (
              <option key={measure} value={measure}>
                {REPORT_MEASURE_LABELS[measure]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="report-group">
            <Trans>Group by</Trans>
          </label>
          <select
            id="report-group"
            className={`${selectClass} min-w-[160px]`}
            value={config.groupBy}
            onChange={(e) => set({ groupBy: e.target.value })}
          >
            {groupOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {budgetOptions.length > 0 && (
          <div>
            <label className={labelClass} htmlFor="report-budget">
              <Trans>Compare against</Trans>
            </label>
            <select
              id="report-budget"
              className={`${selectClass} min-w-[160px]`}
              value={config.budgetField ?? ''}
              onChange={(e) => set({ budgetField: e.target.value || undefined })}
            >
              <option value="">{_(msg`Nothing`)}</option>
              {budgetOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="report-window">
            <Trans>Window</Trans>
          </label>
          <select
            id="report-window"
            className={selectClass}
            value={config.days}
            onChange={(e) => set({ days: Number(e.target.value) })}
          >
            {WINDOWS.map((window) => (
              <option key={window.days} value={window.days}>
                {window.label}
              </option>
            ))}
          </select>
        </div>

        {/* A count has no currency to be in, so the control would be a lie. */}
        {isMoneyMeasure(config.measure) && currencies.length > 1 && (
          <div>
            <label className={labelClass} htmlFor="report-currency">
              <Trans>Currency</Trans>
            </label>
            <select
              id="report-currency"
              className={selectClass}
              value={config.currency ?? currencies[0]?.code ?? ''}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {currencies.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label} ({entry.invoices})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            <Trans>Filters</Trans>
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            disabled={config.filters.length >= 8}
            onClick={() =>
              set({
                filters: [
                  ...config.filters,
                  { field: filterFields[0]?.key ?? 'amount', op: 'is', value: '' },
                ],
              })
            }
          >
            <PlusIcon className="mr-1 h-3 w-3" />
            <Trans>Add filter</Trans>
          </Button>
        </div>

        {config.filters.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            <Trans>Every invoice in the window is included.</Trans>
          </p>
        ) : (
          config.filters.map((filter, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                className={`${selectClass} min-w-[150px]`}
                value={filter.field}
                onChange={(e) => setFilter(index, { field: e.target.value })}
              >
                {filterFields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>

              <select
                className={selectClass}
                value={filter.op}
                onChange={(e) =>
                  setFilter(index, { op: e.target.value as TReportFilter['op'] })
                }
              >
                {REPORT_FILTER_OPS.map((op) => (
                  <option key={op} value={op}>
                    {REPORT_FILTER_OP_LABELS[op]}
                  </option>
                ))}
              </select>

              <Input
                className="h-8 max-w-[200px] text-[13px]"
                value={filter.value}
                placeholder={_(msg`value`)}
                onChange={(e) => setFilter(index, { value: e.target.value })}
              />

              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-destructive"
                title={_(msg`Remove this filter`)}
                onClick={() =>
                  set({ filters: config.filters.filter((_f, i) => i !== index) })
                }
              >
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
