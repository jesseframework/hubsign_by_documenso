import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon } from 'lucide-react';

import type { VendorSpendMeter } from '@documenso/lib/server-only/document/vendor-spend-meter';

/**
 * Where the organization stands with this vendor, shown while signing.
 *
 * The bar is drawn in two segments — what was already spent, then what signing
 * this invoice adds — because the question an approver has is not "what have we
 * spent" but "what does approving this do". A single filled bar answers the
 * first and leaves the second to be worked out from two numbers in a caption,
 * which is exactly the arithmetic someone about to sign will skip.
 *
 * Thresholds match the Reports page (amber from 90%, red past 100%) so the same
 * vendor does not read as comfortable in one place and alarming in the other.
 *
 * This is information, never a gate. Enforcing a limit is what business rules
 * are for, and they can already block DOCUMENT_SIGN with a message that explains
 * itself. A meter that quietly disabled the button would leave someone staring
 * at a page with no way to find out why.
 */

const money = (currency: string, value: number): string => {
  const amount = Math.round(value).toLocaleString();

  return currency ? `${currency} ${amount}` : amount;
};

export const VendorSpendMeterPanel = ({ meter }: { meter: VendorSpendMeter }) => {
  const { limit, spent, thisInvoice, projected, usedShare, spentShare, remaining } = meter;

  const over = usedShare > 1;
  const near = !over && usedShare >= 0.9;

  const tone = over
    ? 'text-red-600 dark:text-red-400'
    : near
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-emerald-700 dark:text-emerald-400';

  // Both segments are measured against the limit and clamped together, so the
  // bar stops at full rather than running off the panel. An overrun is stated in
  // the caption, where it can carry a figure — a bar that simply looks full
  // cannot say by how much.
  const spentWidth = Math.max(0, Math.min(100, spentShare * 100));
  const addedWidth = Math.max(0, Math.min(100 - spentWidth, ((thisInvoice ?? 0) / limit) * 100));

  return (
    <div className="border-border bg-muted/30 rounded-[var(--r)] border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p
          className="text-foreground min-w-0 truncate text-[13px] font-medium"
          title={meter.vendorLabel}
        >
          {meter.vendorLabel}
        </p>
        <p className={`flex-shrink-0 text-[13px] font-semibold tabular-nums ${tone}`}>
          {Math.round(usedShare * 100)}%
        </p>
      </div>

      <p className="text-muted-foreground mt-0.5 text-[11px]">
        <Trans>
          {meter.limitLabel} · last {meter.days} days
        </Trans>
      </p>

      <div className="bg-muted mt-2 flex h-2 w-full overflow-hidden rounded-full">
        <div
          className={`h-full ${over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${spentWidth}%` }}
        />
        {/*
          This invoice, drawn lighter and against the same scale. Striped rather
          than solid so it reads as "not yet spent" at a glance — it becomes part
          of the solid segment only once the document is signed.
        */}
        {addedWidth > 0 && (
          <div
            className={`h-full opacity-50 ${over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{
              width: `${addedWidth}%`,
              backgroundImage:
                'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 6px)',
            }}
          />
        )}
      </div>

      <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
        <span className="tabular-nums">{money(meter.currency, spent)}</span>{' '}
        <Trans>spent on {meter.invoices} invoice(s)</Trans>
        {thisInvoice !== null && (
          <>
            {' · '}
            <span className="text-foreground font-medium tabular-nums">
              +{money(meter.currency, thisInvoice)}
            </span>{' '}
            <Trans>this one</Trans>
          </>
        )}
      </p>

      <p className={`mt-1 text-[11px] font-medium ${tone}`}>
        {over ? (
          <Trans>
            <span className="tabular-nums">{money(meter.currency, projected)}</span> of{' '}
            <span className="tabular-nums">{money(meter.currency, limit)}</span> — over by{' '}
            <span className="tabular-nums">{money(meter.currency, -remaining)}</span>
          </Trans>
        ) : (
          <Trans>
            <span className="tabular-nums">{money(meter.currency, projected)}</span> of{' '}
            <span className="tabular-nums">{money(meter.currency, limit)}</span> —{' '}
            <span className="tabular-nums">{money(meter.currency, remaining)}</span> left
          </Trans>
        )}
      </p>

      {/*
        What the figure does not include.

        An invoice whose total OCR could not read is in none of these numbers, and
        one in another currency cannot be added to them. Both make the meter
        understate, so both are said out loud — a percentage that is quietly
        missing invoices is worse than no percentage.
      */}
      {(meter.unreadable > 0 || meter.otherCurrency > 0) && (
        <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-[11px]">
          <AlertTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>
            {meter.unreadable > 0 && (
              <Trans>{meter.unreadable} invoice(s) with no readable total are not counted.</Trans>
            )}
            {meter.unreadable > 0 && meter.otherCurrency > 0 && ' '}
            {meter.otherCurrency > 0 && (
              <Trans>
                {meter.otherCurrency} invoice(s) in another currency are counted separately.
              </Trans>
            )}
          </span>
        </p>
      )}

      {thisInvoice === null && (
        <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-[11px]">
          <AlertTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <Trans>This invoice's total could not be read, so it is not in the figure above.</Trans>
        </p>
      )}
    </div>
  );
};
