import { useEffect, useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  AtSignIcon,
  CalendarIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleDashedIcon,
  ClockIcon,
  CoinsIcon,
  CopyIcon,
  DollarSignIcon,
  FileSpreadsheetIcon,
  InboxIcon,
  MinusCircleIcon,
  PenLineIcon,
  RefreshCwIcon,
  ScanLineIcon,
  SearchIcon,
  SendIcon,
  SlidersHorizontalIcon,
  Volume2Icon,
  VolumeXIcon,
  WorkflowIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { INBOUND_EMAIL_DOMAIN } from '@documenso/lib/constants/app';
// Shared with the spreadsheet exporter, so what the grid shows and what the
// export writes are resolved by the same code.
import type { TExportFilterValue } from '@documenso/lib/types/export';
import {
  invoiceAmount,
  invoiceFields,
  parseAmount,
} from '@documenso/lib/universal/inbox-invoice-fields';
import { ocrSearchText } from '@documenso/lib/utils/ocr-fields';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@documenso/ui/primitives/hover-card';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { ExportBuilderDialog } from '~/components/general/export/export-builder-dialog';
import { FilterChip } from '~/components/general/filter-chip';
import { ResponsibilityCell } from '~/components/general/inbox/responsibility-cell';
import { useInboxEvents } from '~/hooks/use-inbox-events';
import { formatRelativeTime } from '~/utils/format-relative-time';
import {
  isInboxChimeEnabled,
  playInboxChime,
  setInboxChimeEnabled,
} from '~/utils/inbox-chime';
import { appMetaTags } from '~/utils/meta';

const runStatusColor = (status: string | null | undefined): string => {
  switch (status) {
    case 'COMPLETED':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'FAILED':
    case 'CANCELLED':
      return 'text-red-600 dark:text-red-400';
    case 'RUNNING':
    case 'PENDING':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-muted-foreground/30';
  }
};

const stepIcon = (status: string) => {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2Icon className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />;
    case 'FAILED':
      return <XCircleIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-red-600" />;
    case 'SKIPPED':
      return <MinusCircleIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />;
    default:
      return <CircleDashedIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-600" />;
  }
};

/** Per-row workflow indicator: a colored icon with a hover card of run steps. */
function WorkflowActivityIndicator({
  item,
}: {
  item: { id: string; workflow?: { status: string | null; runs: number } | null };
}) {
  const [open, setOpen] = useState(false);
  const summary = item.workflow;
  const { data: runs, isLoading } = trpc.inbox.workflowActivity.useQuery(
    { inboxItemId: item.id },
    { enabled: open },
  );

  if (!summary || summary.runs === 0) return null;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button type="button" className="inline-flex items-center" aria-label="Workflow activity">
          <WorkflowIcon className={`h-3.5 w-3.5 ${runStatusColor(summary.status)}`} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 p-3 text-[12px]">
        <p className="mb-2 font-semibold">Workflow activity</p>
        {isLoading || !runs ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground">No runs found.</p>
        ) : (
          <div className="max-h-72 space-y-3 overflow-auto">
            {runs.map((run) => (
              <div key={run.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{run.workflow?.name ?? 'Workflow'}</span>
                  <span className={`text-[11px] ${runStatusColor(run.status)}`}>
                    {run.status.toLowerCase()}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {run.steps.map((s) => (
                    <li key={s.stepId} className="flex items-start gap-1.5">
                      {stepIcon(s.status)}
                      <span className="flex-1 leading-tight">
                        <span className="font-medium">{s.stepId}</span>{' '}
                        <span className="text-muted-foreground">({s.type.toLowerCase()})</span>
                        {s.error && (
                          <span className="block text-red-600 dark:text-red-400">{s.error}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {run.error && !run.steps.some((s) => s.error) && (
                  <p className="mt-1 text-red-600 dark:text-red-400">{run.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export function meta() {
  return appMetaTags('Signature Inbox');
}

/**
 * The org's inbound address, as a click-to-copy chip.
 *
 * This used to be a full-width bar under the heading with its own label, code
 * block and Copy button — three elements and a band of chrome for one string that
 * is only needed the handful of times someone sets up a forwarding rule. Folding
 * it into the header line keeps it available without spending vertical space on it
 * every visit.
 *
 * The tick is shown on the chip itself rather than only in a toast: on a wide
 * screen the toast lands far from where the click happened.
 */
function InboxAddressChip({ address }: { address: string }) {
  const { _ } = useLingui();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      title={_(msg`Copy your organization's inbox address`)}
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        setCopied(true);
      }}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-[var(--r-sm)] border border-border bg-muted/40 py-0.5 pl-1.5 pr-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
    >
      <AtSignIcon className="h-3 w-3 flex-shrink-0 opacity-50" />
      <span className="truncate">{address}</span>
      {copied ? (
        <CheckIcon className="h-3 w-3 flex-shrink-0 text-status-complete-text" />
      ) : (
        <CopyIcon className="h-3 w-3 flex-shrink-0 opacity-40 transition-opacity group-hover:opacity-80" />
      )}
      <span className="sr-only">
        {copied ? <Trans>Copied</Trans> : <Trans>Copy inbox address</Trans>}
      </span>
    </button>
  );
}

/**
 * Whether OCR is still reading this item, so its extracted data is not yet
 * trustworthy.
 *
 * Only the active window counts. `PENDING` (queued, not started) and `OCR_FAILED`
 * are deliberately excluded: an item that never got picked up, or whose read
 * failed, has to stay openable or it becomes unreachable — the reviewer needs to
 * see it in order to do anything about it.
 */
const isOcrInFlight = (status: string): boolean => status === 'OCR_PROCESSING';

const ocrBadge = (status: string): string => {
  switch (status) {
    case 'OCR_PROCESSING':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    // Over the org's Smart OCR page quota — paused, not broken. Orange
    // rather than OCR_FAILED's red: nothing needs fixing here, it just
    // needs quota (or time) to free up.
    case 'OCR_QUEUED':
      return 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    case 'OCR_FAILED':
      return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'READY':
    case 'OCR_COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'SENT_FOR_SIGNATURE':
      return 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300';
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    // Terminal but unsuccessful — must not inherit the amber "in progress"
    // default, which would read as still-pending.
    case 'REJECTED':
      return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'ARCHIVED':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  }
};

/**
 * Where the signatures actually stand, as opposed to whether a send happened.
 *
 * `item.status` reaching SENT_FOR_SIGNATURE only records that the document went
 * out. It stays there whether the signer opened it a minute later or has been
 * ignoring it for a week, so on its own it cannot answer the question the queue
 * exists to answer.
 */
function SignatureStatus({
  signature,
}: {
  signature: {
    documentStatus: string;
    total: number;
    signed: number;
    rejected: number;
    pending: number;
    waitingOn: string[];
  };
}) {
  const { documentStatus, total, signed, rejected, pending, waitingOn } = signature;

  // Nothing has been sent, so there is no signing state to report yet.
  if (documentStatus === 'DRAFT' || total === 0) {
    return null;
  }

  if (rejected > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
        <XCircleIcon className="h-3 w-3" />
        <Trans>declined</Trans>
      </span>
    );
  }

  if (documentStatus === 'COMPLETED' || (total > 0 && signed === total)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCheckIcon className="h-3 w-3" />
        <Trans>signed {signed}/{total}</Trans>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300"
      title={waitingOn.length ? `Waiting on ${waitingOn.join(', ')}` : undefined}
    >
      <PenLineIcon className="h-3 w-3" />
      {signed > 0 ? (
        <Trans>signed {signed}/{total}</Trans>
      ) : (
        <Trans>awaiting {pending} signature(s)</Trans>
      )}
    </span>
  );
}

/** "3h", "2d 4h" — how far past target an overdue invoice is. */
const overdueLabel = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / (60 * 24));
  const h = Math.round((m % (60 * 24)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
};

/**
 * The queue's column widths, shared by the header and every row.
 *
 * A CSS grid rather than a `<table>`, for one reason: the same six blocks have to
 * be a dense row on a monitor and a card on a phone, and only one of those is a
 * table. Restacking table cells with `display: block` gets the pixels roughly
 * right but produces a column of orphaned values with no hierarchy — and strips
 * the table semantics screen readers rely on, so it isn't even a fair trade. Here
 * the row is `grid-cols-2` by default and picks up these columns at xl, from one
 * set of markup.
 *
 * `minmax(0, Nfr)` on the three text columns lets them absorb every pixel of a
 * wide monitor and shrink on a laptop without the auto-layout guesswork the table
 * did. The three fixed columns are sized to their content and never move: amounts
 * to `USD 2,843.38`, dates to a label plus `2026-08-02`, actions to Review and its
 * two icon buttons. That is also why nothing scrolls sideways any more.
 */
const GRID_COLUMNS =
  'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_8rem_10.5rem_minmax(0,1fr)_10.5rem]';

/** Format an OCR date value to YYYY-MM-DD (leaves unparseable values as-is). */
const fmtDate = (raw: string | Date): string => {
  const s = typeof raw === 'string' ? raw : raw.toISOString();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

/** Format a money value with the single currency the ML returned. */
const fmtMoney = (currency: string, raw: string): string => {
  if (!raw) return '';
  // `parseAmount` rather than a local Number(): it returns null for a value
  // with no digits, where this used to render "0.00". The spreadsheet export
  // shows the raw text in that case, and the two must not disagree.
  const n = parseAmount(raw);
  const s =
    n === null ? raw : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
};

const STATUS_FILTERS = [
  { key: 'READY', label: 'Ready', icon: CheckCircle2Icon },
  { key: 'needs-review', label: 'Needs review', icon: AlertTriangleIcon },
  { key: 'duplicate', label: 'Duplicates', icon: CopyIcon },
  { key: 'SENT_FOR_SIGNATURE', label: 'Sent to sign', icon: SendIcon },
  { key: 'OCR_FAILED', label: 'OCR failed', icon: XCircleIcon },
  { key: 'OCR_QUEUED', label: 'OCR paused (quota)', icon: ClockIcon },
  { key: 'COMPLETED', label: 'Completed', icon: CheckCheckIcon },
  { key: 'REJECTED', label: 'Rejected', icon: XCircleIcon },
  { key: 'ARCHIVED', label: 'Archived', icon: ArchiveIcon },
] as const;

const DATE_FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
] as const;

const AMOUNT_FILTERS = [
  { key: 'high', label: 'High value (>$10K)', icon: DollarSignIcon },
  { key: 'low', label: 'Small (<$1K)', icon: CoinsIcon },
] as const;

export default function SignatureInboxPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: items, isLoading } = trpc.inbox.list.useQuery({ limit: 100 });

  // Search + quick filters (client-side over the loaded queue).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [amountFilter, setAmountFilter] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const docTypes = useMemo(
    () =>
      Array.from(
        new Set((items ?? []).map((i) => i.documentType).filter((t): t is string => !!t)),
      ).slice(0, 6),
    [items],
  );

  const filteredItems = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const now = Date.now();
    return items.filter((it) => {
      if (q) {
        // Every extracted value, not a fixed set of field names. The previous
        // four-name list missed anything the extractor spelled differently —
        // a vendor stored as `merchant_name` was unfindable — and excluded
        // line items, addresses and reference numbers entirely.
        const hay = [it.document.title, it.senderEmail ?? '', ocrSearchText(it.extractedData)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter) {
        if (statusFilter === 'needs-review') {
          if (!it.needsReview) return false;
        } else if (statusFilter === 'duplicate') {
          if (!it.duplicateOf) return false;
        } else if (it.status !== statusFilter) return false;
      }
      if (typeFilter && (it.documentType ?? '').toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }
      if (dateFilter) {
        const t = new Date(it.createdAt).getTime();
        if (dateFilter === 'today' && t < startOfToday.getTime()) return false;
        if (dateFilter === 'week' && t < now - 7 * 864e5) return false;
        if (dateFilter === 'month' && t < now - 30 * 864e5) return false;
      }
      if (amountFilter) {
        const amt = invoiceAmount(it);
        if (amt == null) return false;
        if (amountFilter === 'high' && !(amt > 10000)) return false;
        if (amountFilter === 'low' && !(amt < 1000)) return false;
      }
      return true;
    });
  }, [items, search, statusFilter, typeFilter, dateFilter, amountFilter]);

  /**
   * The grid's filters, translated into the export's vocabulary.
   *
   * Two of them cannot cross over faithfully, and it is better to drop those
   * than to ship a spreadsheet that claims a filter it did not apply:
   *
   *   - "Needs review" is a flag on the item, not one of the statuses the
   *     export filters on, so it is left off rather than mapped to something
   *     adjacent.
   *   - The date chips are relative to the grid's `createdAt`, while the export
   *     filters on arrival (mail time where known). Same intent, and the
   *     boundary can differ by the ingest lag — which is why the workbook
   *     records the resolved dates on its notes sheet.
   */
  const exportFilters = useMemo(() => {
    const seeded: { id: string; value: TExportFilterValue }[] = [];

    if (search.trim()) {
      seeded.push({ id: 'search', value: { kind: 'text', value: search.trim() } });
    }

    if (statusFilter && statusFilter !== 'needs-review') {
      seeded.push({ id: 'status', value: { kind: 'select', value: [statusFilter] } });
    }

    if (typeFilter) {
      seeded.push({ id: 'documentType', value: { kind: 'select', value: [typeFilter] } });
    }

    if (dateFilter) {
      const from = new Date();
      if (dateFilter === 'today') {
        from.setHours(0, 0, 0, 0);
      } else {
        from.setTime(from.getTime() - (dateFilter === 'week' ? 7 : 30) * 864e5);
      }
      seeded.push({ id: 'received', value: { kind: 'dateRange', from: from.toISOString(), to: null } });
    }

    if (amountFilter === 'high') {
      seeded.push({ id: 'amount', value: { kind: 'numberRange', min: 10000, max: null } });
    } else if (amountFilter === 'low') {
      seeded.push({ id: 'amount', value: { kind: 'numberRange', min: null, max: 1000 } });
    }

    return seeded;
  }, [search, statusFilter, typeFilter, dateFilter, amountFilter]);

  const anyFilter = Boolean(search || statusFilter || typeFilter || dateFilter || amountFilter);
  const activeChipCount = [statusFilter, typeFilter, dateFilter, amountFilter].filter(Boolean).length;
  const clearFilters = () => {
    setSearch('');
    setStatusFilter(null);
    setTypeFilter(null);
    setDateFilter(null);
    setAmountFilter(null);
  };
  const toggle = (
    setter: (v: string | null) => void,
    current: string | null,
    key: string,
  ) => setter(current === key ? null : key);
  const { data: membership } = trpc.org.getMyOrganization.useQuery();
  const org = membership?.organization;
  const { data: unreadCount } = trpc.inbox.unreadCount.useQuery();

  // Live-refresh the list when OCR finishes or new mail is ingested (SSE).
  useInboxEvents();

  // Start at the util's default so server and first client render agree, then
  // read the stored preference once mounted — localStorage doesn't exist during
  // SSR and reading it in the initialiser would cause a hydration mismatch.
  const [chimeOn, setChimeOn] = useState(true);
  useEffect(() => setChimeOn(isInboxChimeEnabled()), []);
  const inboxAddress =
    org?.inboxEmail || (org?.slug ? `${org.slug}@${INBOUND_EMAIL_DOMAIN()}` : null);

  const reprocess = trpc.inbox.reprocessOcr.useMutation({
    onSuccess: () => {
      void utils.inbox.list.invalidate();
      toast({ title: _(msg`Re-running OCR…`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });
  const archive = trpc.inbox.archive.useMutation({
    onSuccess: () => void utils.inbox.list.invalidate(),
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  const fetchNow = trpc.inbox.fetchNow.useMutation({
    onSuccess: (r) => {
      void utils.inbox.list.invalidate();
      toast({
        title: r.configured
          ? _(msg`Imported ${r.imported}, skipped ${r.skipped}`)
          : _(msg`WorkHub inbox not configured`),
      });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      {/*
        One header band instead of three stacked ones. The title, the count, the
        inbox address and the two actions all sit on a single line-pair closed by a
        rule, so the grid starts near the top of the viewport — which is what the
        page is actually for.
      */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">
              <Trans>Signature Inbox</Trans>
            </h2>
            {/*
              Same query the sidebar badge reads, so the two can never disagree —
              a header saying "4 unopened" beside a nav badge saying 6 would put
              every other number on the page in doubt.
            */}
            {typeof unreadCount === 'number' && unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold leading-5 text-primary">
                <Trans>{unreadCount} unopened</Trans>
              </span>
            )}
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted-foreground">
            <span>
              <Trans>Emailed in, read by OCR, then sent to sign.</Trans>
            </span>
            {inboxAddress && (
              <>
                {/* Hidden once the chip wraps to its own line, where a leading
                    interpunct is just a stray dot. */}
                <span className="hidden opacity-40 sm:inline">·</span>
                <InboxAddressChip address={inboxAddress} />
              </>
            )}
          </div>
        </div>

        {/*
          Both controls carry `border-border bg-card` rather than relying on the
          outline variant. `--input` (97% L) is indistinguishable from the page
          background (also 97% L), so an outline button here has a border only in
          theory — on the page it reads as loose text. On a white card it is fine,
          which is why "Export to Excel" below needs no such treatment.
        */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 border-border bg-card p-0 text-muted-foreground hover:text-foreground"
            title={
              chimeOn
                ? _(msg`Sound on for new mail — click to mute`)
                : _(msg`Sound muted — click to unmute`)
            }
            aria-pressed={chimeOn}
            onClick={() => {
              const next = !chimeOn;
              setChimeOn(next);
              setInboxChimeEnabled(next);
              // Play on enable so the volume is known before relying on it —
              // and because this click satisfies the browser's autoplay gate.
              if (next) playInboxChime();
            }}
          >
            {chimeOn ? (
              <Volume2Icon className="h-4 w-4" />
            ) : (
              <VolumeXIcon className="h-4 w-4" />
            )}
            <span className="sr-only">
              <Trans>New mail sound</Trans>
            </span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-border bg-card text-[12px] font-medium"
            disabled={fetchNow.isPending}
            onClick={() => fetchNow.mutate()}
          >
            <RefreshCwIcon
              className={`mr-1.5 h-3.5 w-3.5 ${fetchNow.isPending ? 'animate-spin' : ''}`}
            />
            <Trans>Fetch from WorkHub</Trans>
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <InboxIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>Your inbox is empty</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
            <Trans>
              Email a PDF to your org's inbox alias to see it here. Enable email-to-sign and OCR in
              Organization settings.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Search + quick filters */}
          <div className="space-y-3 rounded-[var(--r)] border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={_(msg`Search by document, vendor, invoice #, PO #, or amount`)}
                  className="h-9 w-full rounded-[var(--r)] border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-primary/50"
                />
              </div>

              {/*
                The export re-runs the query server-side rather than serialising
                what the grid holds — the list is capped at 100 rows and filtered
                in the browser, so exporting the visible array would quietly
                export a page. The filters are carried over so the file starts
                out matching what is on screen.
              */}
              <Button
                type="button"
                variant="outline"
                className="h-9 flex-shrink-0 text-[12px]"
                onClick={() => setExportOpen(true)}
              >
                <FileSpreadsheetIcon className="mr-1.5 h-4 w-4" />
                <Trans>Export to Excel</Trans>
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className="flex w-full items-center gap-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              <SlidersHorizontalIcon className="h-3.5 w-3.5" />
              <Trans>Quick filters</Trans>
              {activeChipCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                  {activeChipCount}
                </span>
              )}
              {filtersOpen ? (
                <ChevronUpIcon className="ml-auto h-3.5 w-3.5" />
              ) : (
                <ChevronDownIcon className="ml-auto h-3.5 w-3.5" />
              )}
            </button>

            {filtersOpen && (
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <Trans>Status</Trans>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_FILTERS.map((f) => (
                    <FilterChip
                      key={f.key}
                      active={statusFilter === f.key}
                      icon={f.icon}
                      onClick={() => toggle(setStatusFilter, statusFilter, f.key)}
                    >
                      {f.label}
                    </FilterChip>
                  ))}
                </div>
              </div>

              {docTypes.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <Trans>Type</Trans>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {docTypes.map((t) => (
                      <FilterChip
                        key={t}
                        active={typeFilter === t}
                        onClick={() => toggle(setTypeFilter, typeFilter, t)}
                      >
                        <span className="capitalize">{t}</span>
                      </FilterChip>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <Trans>Received</Trans>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DATE_FILTERS.map((f) => (
                    <FilterChip
                      key={f.key}
                      active={dateFilter === f.key}
                      icon={CalendarIcon}
                      onClick={() => toggle(setDateFilter, dateFilter, f.key)}
                    >
                      {f.label}
                    </FilterChip>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <Trans>Amount</Trans>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AMOUNT_FILTERS.map((f) => (
                    <FilterChip
                      key={f.key}
                      active={amountFilter === f.key}
                      icon={f.icon}
                      onClick={() => toggle(setAmountFilter, amountFilter, f.key)}
                    >
                      {f.label}
                    </FilterChip>
                  ))}
                </div>
              </div>
            </div>

            )}

            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-[11px] text-muted-foreground">
                <Trans>
                  Showing {filteredItems.length} of {items.length}
                </Trans>
              </span>
              {anyFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-3 w-3" />
                  <Trans>Clear all</Trans>
                </button>
              )}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-12 text-center">
              <InboxIcon className="mx-auto mb-3 h-9 w-9 opacity-30" />
              <p className="text-[13px] font-medium">
                <Trans>No documents match your filters</Trans>
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>
                <XIcon className="mr-1 h-3.5 w-3.5" />
                <Trans>Clear filters</Trans>
              </Button>
            </div>
          ) : (
            <div role="table" className="rounded-[var(--r)] border border-border bg-card">
              {/* Column headers exist only in row mode; a card labels its own
                  values. Never wrapped — "Vendor / Contact" over two lines makes
                  the header band taller for no gain. */}
              <div
                role="row"
                className={`hidden border-b border-border bg-[#faf9fe] dark:bg-muted/30 xl:grid ${GRID_COLUMNS}`}
              >
                {[
                  <Trans key="a">Invoice info</Trans>,
                  <Trans key="b">Vendor / Contact</Trans>,
                  <Trans key="c">Amounts</Trans>,
                  <Trans key="d">Dates</Trans>,
                  <Trans key="e">Responsibility</Trans>,
                  <Trans key="f">Actions</Trans>,
                ].map((label, index) => (
                  <div
                    key={index}
                    role="columnheader"
                    className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground ${
                      index === 2 || index === 5 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>

            <div role="rowgroup">
              {filteredItems.map((item) => {
                const f = invoiceFields(item);
                const headline = f.invoiceNumber || item.document.title;
                const hasAmounts = Boolean(f.total || f.tax || f.net);
                const isUnread = !item.viewedAt;
                // Past its internal target AND still unsent. Coloured at the row
                // rather than tucked into a badge: an overdue invoice should be
                // findable by scrolling, not by reading.
                //
                // `open` is what keeps a completed-but-late invoice out of this.
                // It missed its target, which the SLA dashboard records, but it
                // is finished and nothing about it needs doing today.
                const isOverdue = item.sla?.state === 'breached' && item.sla.open;
                // An invoice we already have. Outranks overdue in the row colour:
                // a late invoice needs doing sooner, a duplicate needs not doing
                // at all, and paying it twice costs more than paying it late.
                const isDuplicate = Boolean(item.duplicateOf);
                // Built here rather than inline: the translated string takes
                // plain values, not expressions dug out of a nullable relation.
                const originalName =
                  item.duplicateOf?.subject || item.duplicateOf?.document.title || '';
                const originalOn = item.duplicateOf
                  ? new Date(item.duplicateOf.createdAt).toLocaleDateString()
                  : '';
                const matchedOn =
                  item.duplicateMatchedOn === 'invoice-number'
                    ? _(msg`the invoice number`)
                    : _(msg`the invoice date`);
                return (
                  <div
                    role="row"
                    key={item.id}
                    /*
                      Card below xl, row at xl. The accent that marks unread,
                      duplicate and overdue moves to the container here — as a
                      border on the first cell it would have striped only the top
                      block of a card.
                    */
                    className={`grid grid-cols-2 gap-x-4 gap-y-2 border-b border-l-[3px] border-border p-4 last:border-b-0 xl:gap-x-0 xl:gap-y-0 xl:p-0 ${GRID_COLUMNS} ${
                      isDuplicate
                        ? 'border-l-red-600 bg-red-50 hover:bg-red-100/70 dark:bg-red-950/40 dark:hover:bg-red-950/60'
                        : isOverdue
                          ? 'border-l-orange-500 bg-orange-50 hover:bg-orange-100/70 dark:bg-orange-950/40 dark:hover:bg-orange-950/60'
                          : `hover:bg-muted/20 ${isUnread ? 'border-l-primary' : 'border-l-transparent'}`
                    }`}
                  >
                    {/* Invoice info */}
                    <div role="cell" className="col-span-2 min-w-0 xl:col-span-1 xl:px-4 xl:py-3">
                      <Link
                        to={`/org/inbox/${item.id}`}
                        className={`text-[14px] hover:text-primary hover:underline xl:text-[13px] ${
                          isUnread ? 'font-bold' : 'font-medium text-foreground/80'
                        }`}
                      >
                        {headline}
                      </Link>
                      {f.invoiceNumber && item.document.title !== f.invoiceNumber && (
                        <p className="text-[11px] text-muted-foreground">{item.document.title}</p>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        {item.documentType && <span className="capitalize">{item.documentType}</span>}
                        {f.poNumber && <span>PO: {f.poNumber}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${ocrBadge(item.status)}`}
                        >
                          {item.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                        {item.ocrProcessed && item.ocrConfidence != null && (
                          <span className="text-[10px] text-muted-foreground">
                            {Math.round(item.ocrConfidence * 100)}%
                          </span>
                        )}
                        {item.needsReview && (
                          <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            review
                          </span>
                        )}
                        {/*
                          Named, not just flagged. "Duplicate" on its own sends
                          someone hunting through the queue for the other copy;
                          the link goes straight to it.
                        */}
                        {item.duplicateOf && (
                          <Link
                            to={`/org/inbox/${item.duplicateOf.id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 hover:underline dark:bg-red-900 dark:text-red-200"
                            title={_(
                              msg`Same vendor and total as "${originalName}", received ${originalOn}. Matched on ${matchedOn}.`,
                            )}
                          >
                            <CopyIcon className="h-3 w-3" />
                            <Trans>duplicate</Trans>
                          </Link>
                        )}
                        {/*
                          The other end of the same fact. Without it the original
                          looks untouched next to a red row and there is no telling
                          which of two identical invoices is the one to pay.
                        */}
                        {!item.duplicateOf && item._count.duplicates > 0 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={_(msg`This is the first copy received. Later copies are marked as duplicates.`)}
                          >
                            <CopyIcon className="h-3 w-3" />
                            <Trans>original</Trans>
                          </span>
                        )}
                        {/*
                          Which stage is late, not just that something is. "Overdue"
                          alone sends someone to process an invoice that went out
                          days ago and is waiting on a signer — different problem,
                          different person to chase.
                        */}
                        {isOverdue && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                            title={
                              item.sla?.dueAt
                                ? `SLA due ${new Date(item.sla.dueAt).toLocaleString()}`
                                : undefined
                            }
                          >
                            <AlertTriangleIcon className="h-3 w-3" />
                            {item.sla?.stage === 'signing' ? (
                              <Trans>
                                unsigned {overdueLabel(item.sla?.overdueByMinutes ?? 0)}
                              </Trans>
                            ) : (
                              <Trans>overdue {overdueLabel(item.sla?.overdueByMinutes ?? 0)}</Trans>
                            )}
                          </span>
                        )}
                        <SignatureStatus signature={item.signature} />
                        <WorkflowActivityIndicator item={item} />
                      </div>
                    </div>

                    {/*
                      Vendor / contact.

                      The addresses truncate rather than wrap. An email is one
                      unbreakable token, so a column narrower than the address either
                      spills into its neighbour or forces the column wider at every
                      other row's expense; an ellipsis with the full value in the
                      title attribute costs a hover. The name above it wraps, because
                      half a company name is not a company name.
                    */}
                    <div role="cell" className="col-span-2 min-w-0 xl:col-span-1 xl:px-4 xl:py-3">
                      <p className="text-[13px] font-medium">{f.vendorName || '—'}</p>
                      {f.vendorEmail && (
                        <p className="truncate text-[12px] text-muted-foreground" title={f.vendorEmail}>
                          {f.vendorEmail}
                        </p>
                      )}
                      {item.senderEmail && (
                        <p
                          className="truncate text-[11px] text-muted-foreground/70"
                          title={item.senderEmail}
                        >
                          from {item.senderEmail}
                        </p>
                      )}
                    </div>

                    {/*
                      Amounts — single currency, straight from BMS ML metadata.

                      Tinted on a card so the two figure blocks read as a pair of
                      facts rather than more stacked text; in row mode the column
                      itself provides that separation.
                    */}
                    <div
                      role="cell"
                      className="min-w-0 whitespace-nowrap rounded-[var(--r-sm)] bg-muted/40 p-2.5 text-left xl:rounded-none xl:bg-transparent xl:px-4 xl:py-3 xl:text-right"
                    >
                      {/*
                        No separate currency line: `fmtMoney` already prefixes every
                        figure with it, so a JMD header above "JMD 66.59" was saying
                        it twice and costing a line in every row.
                      */}
                      {hasAmounts ? (
                        <dl className="space-y-0.5 text-[12px]">
                          {f.total && (
                            <div className="flex items-baseline justify-start gap-2 xl:justify-end">
                              <dt className="text-[10px] uppercase text-muted-foreground">Inv</dt>
                              <dd className="font-semibold tabular-nums">{fmtMoney(f.currency, f.total)}</dd>
                            </div>
                          )}
                          {f.tax && (
                            <div className="flex items-baseline justify-start gap-2 xl:justify-end">
                              <dt className="text-[10px] uppercase text-muted-foreground">Tax</dt>
                              <dd className="tabular-nums">{fmtMoney(f.currency, f.tax)}</dd>
                            </div>
                          )}
                          {f.net && (
                            <div className="flex items-baseline justify-start gap-2 xl:justify-end">
                              <dt className="text-[10px] uppercase text-muted-foreground">Net</dt>
                              <dd className="font-medium tabular-nums">{fmtMoney(f.currency, f.net)}</dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </div>

                    {/*
                      Dates.

                      `whitespace-nowrap` is the whole point of this cell: a date is
                      one token, and the layout was happily breaking 2026-08-02 after
                      a hyphen to squeeze the column, which turns four dates into
                      eight lines of hyphenated digits. The column is now sized to a
                      label plus a date and never squeezed at all.
                    */}
                    <div
                      role="cell"
                      className="min-w-0 whitespace-nowrap rounded-[var(--r-sm)] bg-muted/40 p-2.5 text-[12px] xl:rounded-none xl:bg-transparent xl:px-4 xl:py-3"
                    >
                      <dl className="space-y-0.5">
                        {f.invoiceDate && (
                          <div className="flex items-baseline gap-2">
                            <dt className="w-14 text-[10px] uppercase text-muted-foreground">Invoice</dt>
                            <dd className="tabular-nums">{fmtDate(f.invoiceDate)}</dd>
                          </div>
                        )}
                        {f.dueDate && (
                          <div className="flex items-baseline gap-2">
                            <dt className="w-14 text-[10px] uppercase text-muted-foreground">Due</dt>
                            <dd className="tabular-nums">{fmtDate(f.dueDate)}</dd>
                          </div>
                        )}
                        <div className="flex items-baseline gap-2">
                          <dt className="w-14 text-[10px] uppercase text-muted-foreground">Created</dt>
                          <dd className="tabular-nums text-muted-foreground">{fmtDate(item.createdAt)}</dd>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <dt className="w-14 text-[10px] uppercase text-muted-foreground">Updated</dt>
                          <dd className="tabular-nums text-muted-foreground">
                            {formatRelativeTime(item.updatedAt)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Responsibility — who owes a signature, and the chasing so far */}
                    <div role="cell" className="col-span-2 min-w-0 xl:col-span-1 xl:px-4 xl:py-3">
                      <ResponsibilityCell
                        responsibility={item.responsibility}
                        documentStatus={item.signature.documentStatus}
                      />
                    </div>

                    {/* Actions */}
                    <div
                      role="cell"
                      className="col-span-2 min-w-0 whitespace-nowrap xl:col-span-1 xl:px-4 xl:py-3"
                    >
                      <div className="flex items-center justify-start gap-1 xl:justify-end">
                        {/*
                          Review is withheld while OCR is running: the extracted
                          fields are what the reviewer is there to check, and
                          opening the item mid-read shows them blank or partial,
                          which invites approving figures that have not been read
                          yet. Rendered as a disabled button rather than a disabled
                          Button inside the Link — the Link would still navigate,
                          since it captures the click before the button sees it.
                          The row updates itself when OCR finishes, so this
                          re-enables without a refresh.
                        */}
                        {isOcrInFlight(item.status) ? (
                          <Button
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled
                            title={_(msg`OCR is still reading this document`)}
                          >
                            <RefreshCwIcon className="mr-1 h-3.5 w-3.5 animate-spin" />
                            <Trans>Reading…</Trans>
                          </Button>
                        ) : (
                          <Link to={`/org/inbox/${item.id}`}>
                            <Button size="sm" className="h-7 text-[11px]">
                              <ScanLineIcon className="mr-1 h-3.5 w-3.5" />
                              <Trans>Review</Trans>
                            </Button>
                          </Link>
                        )}
                        {/*
                          Re-run OCR stays available even while a read is in
                          flight — it is the only way to recover an item that has
                          stuck in OCR_PROCESSING, and disabling it there would
                          leave the row with no action but Archive.

                          Scoped to the row being re-run: `reprocess.isPending`
                          alone disabled the button on every row at once, because
                          one mutation hook serves the whole table.
                        */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          title={_(msg`Re-run OCR`)}
                          disabled={reprocess.isPending && reprocess.variables?.id === item.id}
                          onClick={() => reprocess.mutate({ id: item.id })}
                        >
                          <RefreshCwIcon
                            className={`h-3.5 w-3.5 ${
                              reprocess.isPending && reprocess.variables?.id === item.id
                                ? 'animate-spin'
                                : ''
                            }`}
                          />
                        </Button>
                        {item.status !== 'ARCHIVED' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px] text-muted-foreground"
                            title={_(msg`Archive`)}
                            onClick={() => archive.mutate({ id: item.id })}
                          >
                            <ArchiveIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </div>
      )}

      <ExportBuilderDialog
        datasetId="signature-inbox"
        open={exportOpen}
        onOpenChange={setExportOpen}
        initialFilters={exportFilters}
      />
    </div>
  );
}
