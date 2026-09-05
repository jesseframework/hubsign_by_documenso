import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';

import { DonutChart } from '~/components/general/org-dashboard/donut-chart';

/**
 * The three bottleneck tiles.
 *
 * Each is a summary sized to the row — a headline figure, one plot, one line
 * naming the worst case — with the full list behind a click. The first cut put
 * whole ranked lists in the cards and they grew to twice the height of their
 * neighbours, which is what a summary tile is specifically not for.
 *
 * The three plots are deliberately different shapes. A donut, a segmented bar
 * and a ranked bar read as three different questions; three identical bar lists
 * read as one chart repeated, which is how the first version looked.
 */

export type Person = {
  name: string;
  email: string;
  open: number;
  oldestDays: number;
  reminders: number;
  neverEmailed: number;
  openedNotSigned: number;
};

export type VendorInvoice = {
  inboxItemId: string;
  documentId: number;
  label: string;
  invoiceNumber: string | null;
  documentTitle: string;
  dueAt: string | Date | null;
  daysPastDue: number;
  basis: 'invoice' | 'invoice-terms' | 'terms' | 'terms-from-arrival' | 'invoice-echoed' | 'none';
  daysHeld: number | null;
  arrivedOverdue: boolean;
};

export type VendorRow = {
  vendor: string;
  overdue: number;
  open: number;
  invoices: VendorInvoice[];
  moreOverdue: number;
};

export type Stages = { neverEmailed: number; emailedNotOpened: number; openedNotSigned: number };
export type Chase = { none: number; once: number; repeatedly: number };

const PLOT_HEIGHT = 150;

/** Distinct enough to tell apart, and stable so a person keeps their colour. */
const PERSON_COLORS = ['#f59e0b', '#6366f1', '#0ea5e9', '#10b981', '#a855f7', '#94a3b8'];

const dayLabel = (days: number) => (days === 0 ? 'today' : `${days}d`);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div
    className="flex items-center justify-center text-center text-[12px] text-muted-foreground"
    style={{ height: PLOT_HEIGHT }}
  >
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// 1. Waiting on — a ring, because the question is "how is the load divided".
// ---------------------------------------------------------------------------

export const WaitingOnTile = ({
  people,
  otherPeople,
}: {
  people: Person[];
  otherPeople: number;
}) => {
  if (people.length === 0) {
    return <Empty>
      <Trans>Nothing is waiting on anyone.</Trans>
    </Empty>;
  }

  // The person with the single oldest document, which is not always the person
  // holding the most — and is usually the one worth a phone call.
  const longest = [...people].sort((a, b) => b.oldestDays - a.oldestDays)[0];

  return (
    <div>
      <DonutChart
        height={PLOT_HEIGHT}
        data={people.slice(0, 5).map((person, index) => ({
          // First name only: the ring legend is narrow, and the full address is
          // in the detail panel.
          label: person.name.split(' ')[0] || person.email,
          value: person.open,
          color: PERSON_COLORS[index % PERSON_COLORS.length],
        }))}
      />

      <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <Trans>
          Longest wait: <span className="font-medium text-foreground">{longest.name}</span>,{' '}
          {dayLabel(longest.oldestDays)}
        </Trans>
        {/* Everyone not in the ring, whether trimmed here or server-side. */}
        {people.length - 5 + otherPeople > 0 && (
          <span>
            {' · '}
            <Trans>+{people.length - 5 + otherPeople} more people</Trans>
          </span>
        )}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. Where it's stuck — one segmented bar, because these are stages of one set.
// ---------------------------------------------------------------------------

const STAGE_STYLE = [
  { key: 'neverEmailed' as const, colour: '#ef4444', label: <Trans>Never emailed</Trans> },
  { key: 'emailedNotOpened' as const, colour: '#f59e0b', label: <Trans>Not opened</Trans> },
  { key: 'openedNotSigned' as const, colour: '#0ea5e9', label: <Trans>Opened, not signed</Trans> },
];

export const WhereItsStuckTile = ({
  stages,
  chase,
  totalOpen,
}: {
  stages: Stages;
  chase: Chase;
  totalOpen: number;
}) => {
  if (totalOpen === 0) {
    return <Empty>
      <Trans>No signatures outstanding.</Trans>
    </Empty>;
  }

  const worst = STAGE_STYLE.map((stage) => ({ ...stage, count: stages[stage.key] })).sort(
    (a, b) => b.count - a.count,
  )[0];

  return (
    <div className="flex flex-col justify-center" style={{ minHeight: PLOT_HEIGHT }}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {STAGE_STYLE.map((stage) => {
          const count = stages[stage.key];
          if (count === 0) return null;

          return (
            <div
              key={stage.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(count / totalOpen) * 100}%`, background: stage.colour }}
              title={`${count}`}
            />
          );
        })}
      </div>

      <ul className="mt-3 space-y-1.5">
        {STAGE_STYLE.map((stage) => (
          <li key={stage.key} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: stage.colour }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{stage.label}</span>
            <span className="font-semibold tabular-nums">{stages[stage.key]}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <Trans>
          Mostly <span className="font-medium text-foreground">{worst.label}</span> ·{' '}
          {chase.none} never chased
        </Trans>
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. Overdue by vendor — a ranked bar, because the question is "who is worst".
// ---------------------------------------------------------------------------

export const OverdueByVendorTile = ({
  rows,
  unattributed,
  noDueDate,
}: {
  rows: VendorRow[];
  unattributed: number;
  /** Open invoices that carry no due date and no vendor terms code. */
  noDueDate: number;
}) => {
  if (rows.length === 0) {
    return (
      <Empty>
        <span>
          <Trans>Nothing past its due date.</Trans>
          {unattributed > 0 && (
            <span className="mt-1 block">
              <Trans>{unattributed} overdue with no vendor name.</Trans>
            </span>
          )}
          {/* Said out loud, because an unmeasured queue and a punctual one look
              identical from a chart showing nothing. */}
          {noDueDate > 0 && (
            <span className="mt-1 block">
              <Trans>{noDueDate} cannot be judged — no due date and no terms code.</Trans>
            </span>
          )}
        </span>
      </Empty>
    );
  }

  const top = rows.slice(0, 3);
  const worst = Math.max(...top.map((row) => row.overdue), 1);

  return (
    <div className="flex flex-col justify-center" style={{ minHeight: PLOT_HEIGHT }}>
      <div className="space-y-2.5">
        {top.map((row) => (
          <div key={row.vendor}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[12px]" title={row.vendor}>
                {row.vendor}
              </span>
              <span className="flex-shrink-0 text-[12px] font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                {row.overdue}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-orange-500"
                style={{ width: `${Math.round((row.overdue / worst) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
        {rows.length > top.length ? (
          <Trans>+{rows.length - top.length} more vendors</Trans>
        ) : (
          <Trans>All late vendors shown</Trans>
        )}
        {unattributed > 0 && (
          <span>
            {' · '}
            <Trans>{unattributed} unattributed</Trans>
          </span>
        )}
        {noDueDate > 0 && (
          <span>
            {' · '}
            <Trans>{noDueDate} undated</Trans>
          </span>
        )}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail panels
// ---------------------------------------------------------------------------

export type BottleneckDetail = 'waiting' | 'stuck' | 'vendors' | null;

const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground';
const td = 'px-2 py-1.5 text-[12px] align-top';

/**
 * Where a due date came from, said out loud — but only when it is not simply
 * printed on the invoice.
 *
 * A date the supplier put on the page and a date this product worked out from a
 * terms code are different kinds of fact, and the panel used to render them
 * identically, which is how a derived date gets read as the vendor's own deadline
 * and argued about. The ordinary case stays unlabelled so the noise falls only on
 * the rows that have earned it.
 */
const DueDateBasisNote = ({ basis }: { basis: VendorInvoice['basis'] }) => {
  switch (basis) {
    case 'invoice-terms':
      return (
        <span className="block text-[10px] text-muted-foreground">
          <Trans>from invoice terms</Trans>
        </span>
      );
    case 'terms':
      return (
        <span className="block text-[10px] text-muted-foreground">
          <Trans>from vendor terms</Trans>
        </span>
      );
    case 'terms-from-arrival':
      return (
        <span className="block text-[10px] text-muted-foreground">
          <Trans>est. from arrival</Trans>
        </span>
      );
    // The extractor echoed the invoice date into the due-date field and nothing —
    // no terms on the page, no terms code on the vendor — was available to correct
    // it. The figure is the best available and is very likely too harsh; saying so
    // is the difference between a number someone can act on and one they cannot.
    case 'invoice-echoed':
      return (
        <span className="block text-[10px] text-amber-600 dark:text-amber-400">
          <Trans>no due date printed</Trans>
        </span>
      );
    default:
      return null;
  }
};

export const BottleneckDetailDialog = ({
  detail,
  onClose,
  people,
  stages,
  chase,
  totalOpen,
  vendors,
}: {
  detail: BottleneckDetail;
  onClose: () => void;
  people: Person[];
  stages: Stages;
  chase: Chase;
  totalOpen: number;
  vendors: { rows: VendorRow[]; unattributed: number; noDueDate: number };
}) => {
  return (
    <Dialog open={detail !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent position="center" className="max-h-[85vh] w-full max-w-2xl overflow-hidden">
        {detail === 'waiting' && (
          <>
            <DialogHeader>
              <DialogTitle>
                <Trans>Waiting on</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>
                  Everyone currently holding a signature. For a document signed in order, only
                  the person whose turn it is appears — nobody is listed for a document that has
                  not reached them.
                </Trans>
              </DialogDescription>
            </DialogHeader>

            <div className="custom-scrollbar max-h-[60vh] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border">
                    <th className={th}>
                      <Trans>Person</Trans>
                    </th>
                    <th className={`${th} text-right`}>
                      <Trans>Open</Trans>
                    </th>
                    <th className={`${th} text-right`}>
                      <Trans>Oldest</Trans>
                    </th>
                    <th className={`${th} text-right`}>
                      <Trans>Chased</Trans>
                    </th>
                    <th className={`${th} text-right`}>
                      <Trans>Opened</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <tr key={person.email} className="border-b border-border last:border-0">
                      <td className={td}>
                        <p className="font-medium">{person.name}</p>
                        <p className="text-[11px] text-muted-foreground">{person.email}</p>
                        {person.neverEmailed > 0 && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            <Trans>
                              {person.neverEmailed} never emailed — a send that did not happen
                            </Trans>
                          </p>
                        )}
                      </td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>
                        {person.open}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {dayLabel(person.oldestDays)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{person.reminders}</td>
                      <td className={`${td} text-right tabular-nums text-muted-foreground`}>
                        {person.openedNotSigned}/{person.open}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground">
              <Trans>
                "Oldest" counts from when that person was emailed, not from when the document was
                created.
              </Trans>
            </p>
          </>
        )}

        {detail === 'stuck' && (
          <>
            <DialogHeader>
              <DialogTitle>
                <Trans>Where it's stuck</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>
                  The {totalOpen} outstanding signatures, split by what is actually holding them
                  up.
                </Trans>
              </DialogDescription>
            </DialogHeader>

            <dl className="space-y-3">
              <div>
                <dt className="text-[13px] font-medium">
                  <Trans>Never emailed — {stages.neverEmailed}</Trans>
                </dt>
                <dd className="text-[12px] text-muted-foreground">
                  <Trans>
                    The recipient was never sent a request. This is a send that did not happen,
                    not a slow signer — chasing the person will not help.
                  </Trans>
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-medium">
                  <Trans>Emailed, not opened — {stages.emailedNotOpened}</Trans>
                </dt>
                <dd className="text-[12px] text-muted-foreground">
                  <Trans>
                    The request went out and has never been opened. Often a delivery problem —
                    a wrong address, or the mail sitting in a spam folder.
                  </Trans>
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-medium">
                  <Trans>Opened, not signed — {stages.openedNotSigned}</Trans>
                </dt>
                <dd className="text-[12px] text-muted-foreground">
                  <Trans>
                    Seen and not acted on. These are the ones a reminder or a phone call is for.
                  </Trans>
                </dd>
              </div>
            </dl>

            <div className="rounded-[var(--r-sm)] border border-border bg-muted/20 p-3">
              <p className="mb-1 text-[12px] font-medium">
                <Trans>How hard we have chased</Trans>
              </p>
              <p className="text-[12px] text-muted-foreground">
                <Trans>
                  {chase.none} have had no reminder at all, {chase.once} have had one, and{' '}
                  {chase.repeatedly} have had two or more. Something outstanding with no reminder
                  is a gap in the process; something outstanding after several is a gap in the
                  relationship.
                </Trans>
              </p>
            </div>
          </>
        )}

        {detail === 'vendors' && (
          <>
            <DialogHeader>
              <DialogTitle>
                <Trans>Overdue by vendor</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>
                  Invoices past the date the vendor is owed by, and still awaiting signature. The
                  due date is the one printed on the invoice; where it states none, the terms
                  printed on the invoice are applied to the invoice date, and failing those the
                  vendor's terms code. Any date not taken straight off the page is labelled as
                  such. One already signed is history and is not counted here.
                </Trans>{' '}
                {/*
                  Said plainly, because the figure is read as a reproach otherwise.
                  It measures the invoice against its own due date, and an invoice
                  can be months past due on the day it lands in the inbox.
                */}
                <Trans>
                  Days past due are counted from that date, not from the day the invoice reached
                  you — where it arrived already overdue, the row also says how long you have
                  actually held it.
                </Trans>
              </DialogDescription>
            </DialogHeader>

            {/*
              The invoices, not only the counts. A count says a supplier is a
              problem; the invoice number and how late it is are what someone acts
              on, and they had to leave this panel and search the inbox to find
              them. Each row opens the item it names.
            */}
            <div className="custom-scrollbar max-h-[60vh] space-y-4 overflow-y-auto">
              {vendors.rows.map((row) => (
                <div key={row.vendor}>
                  <div className="sticky top-0 flex items-baseline justify-between gap-3 border-b border-border bg-card pb-1.5">
                    <p className="min-w-0 truncate text-[13px] font-semibold" title={row.vendor}>
                      {row.vendor}
                    </p>
                    <p className="flex-shrink-0 text-[11px] text-muted-foreground">
                      <span className="font-semibold text-orange-600 dark:text-orange-400">
                        {row.overdue}
                      </span>{' '}
                      <Trans>overdue</Trans>
                      {' · '}
                      <Trans>{row.open} open</Trans>
                    </p>
                  </div>

                  <ul className="divide-y divide-border">
                    {row.invoices.map((invoice) => (
                      <li key={invoice.inboxItemId}>
                        <Link
                          to={`/org/inbox/${invoice.inboxItemId}`}
                          className="flex items-baseline justify-between gap-3 py-1.5 hover:bg-muted/40"
                        >
                          <span
                            className="min-w-0 flex-1 truncate text-[12px]"
                            title={`${invoice.label} · ${invoice.documentTitle}`}
                          >
                            {invoice.label}
                            {/* Only when it adds something: the title IS the label
                                whenever no number extracted, and printing it twice
                                would pad every such row. */}
                            {invoice.documentTitle !== invoice.label && (
                              <span className="ml-1.5 text-muted-foreground">
                                {invoice.documentTitle}
                              </span>
                            )}
                          </span>
                          <span className="flex-shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                            <span className="block">
                              {invoice.dueAt
                                ? new Date(invoice.dueAt).toISOString().slice(0, 10)
                                : '—'}
                            </span>
                            <DueDateBasisNote basis={invoice.basis} />
                          </span>
                          {/*
                            Two numbers, because one of them was being misread as
                            the other. The invoice is 161 days past due; we have
                            had it for one afternoon. Only the second is shown
                            when the two differ, so a normal overdue invoice — one
                            that went past its date on our watch — stays a single
                            figure.
                          */}
                          <span className="w-[6.5rem] flex-shrink-0 text-right text-[11px] tabular-nums">
                            <span className="block font-medium text-orange-600 dark:text-orange-400">
                              <Trans>{invoice.daysPastDue}d past due</Trans>
                            </span>
                            {invoice.arrivedOverdue && invoice.daysHeld !== null && (
                              <span className="block text-muted-foreground">
                                <Trans>here {dayLabel(invoice.daysHeld)}</Trans>
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  {row.moreOverdue > 0 && (
                    <p className="pt-1.5 text-[11px] text-muted-foreground">
                      <Trans>+{row.moreOverdue} more overdue from this vendor</Trans>
                    </p>
                  )}
                </div>
              ))}
            </div>

            {vendors.unattributed > 0 && (
              <p className="text-[11px] text-muted-foreground">
                <Trans>
                  A further {vendors.unattributed} are late but carry no vendor name, so they
                  cannot be grouped. They are counted nowhere in the table above.
                </Trans>
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
