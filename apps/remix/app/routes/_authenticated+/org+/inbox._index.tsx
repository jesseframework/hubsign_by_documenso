import { useEffect, useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CalendarIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleDashedIcon,
  CoinsIcon,
  DollarSignIcon,
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
import { ocrFieldNames, ocrSearchText } from '@documenso/lib/utils/ocr-fields';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@documenso/ui/primitives/hover-card';
import { useToast } from '@documenso/ui/primitives/use-toast';

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

/** Read the first non-empty value among the given OCR field names. */
const fieldStr = (item: { extractedData?: unknown }, keys: string[]): string => {
  const data = (item.extractedData ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = data[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return '';
};

/** Best-effort numeric amount from the OCR fields (currency-agnostic). */
const amountOf = (item: { extractedData?: unknown }): number | null => {
  // Wider than OCR_FIELD_ALIASES on purpose: this drives the high/low amount
  // filter, where an approximate figure beats none. `subtotal` is a last resort
  // and must never be treated as a synonym for the total elsewhere.
  const raw = fieldStr(item, [
    ...ocrFieldNames('total_amount'),
    'invoice_amount',
    'totalAmount',
    'amount',
    'grand_total',
    'subtotal',
  ]);
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

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
  const n = Number(raw.replace(/[^0-9.\-]/g, ''));
  const s = Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : raw;
  return currency ? `${currency} ${s}` : s;
};

/** All invoice fields we surface in the grid — sourced ONLY from BMS ML metadata. */
const invoiceFields = (item: { extractedData?: unknown }) => ({
  invoiceNumber: fieldStr(item, ['invoice_number', 'invoiceNumber', 'invoice_no']),
  poNumber: fieldStr(item, ['po_number', 'purchase_order', 'poNumber']),
  // `ocrFieldNames` supplies the extractor's real synonyms (e.g. merchant_name),
  // which is why this column used to be blank for half the queue; the extra
  // entries after it are display-only guesses that cost nothing to try.
  vendorName: fieldStr(item, [...ocrFieldNames('vendor_name'), 'vendor_display_name']),
  vendorEmail: fieldStr(item, ['vendor_email', 'vendorEmail', 'email', 'merchant_contact']),
  currency: fieldStr(item, ['currency', 'currency_code', 'ccy']),
  total: fieldStr(item, [...ocrFieldNames('total_amount'), 'invoice_amount', 'grand_total']),
  tax: fieldStr(item, [...ocrFieldNames('tax_amount'), 'vat']),
  net: fieldStr(item, ['subtotal', 'net_amount', 'net']),
  invoiceDate: fieldStr(item, ['invoice_date', 'date', 'issue_date']),
  dueDate: fieldStr(item, [...ocrFieldNames('due_date'), 'payment_due']),
  customerName: fieldStr(item, ocrFieldNames('customer_name')),
});

const STATUS_FILTERS = [
  { key: 'READY', label: 'Ready', icon: CheckCircle2Icon },
  { key: 'needs-review', label: 'Needs review', icon: AlertTriangleIcon },
  { key: 'SENT_FOR_SIGNATURE', label: 'Sent to sign', icon: SendIcon },
  { key: 'OCR_FAILED', label: 'OCR failed', icon: XCircleIcon },
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

/** A pill toggle in HubSign's palette. */
function FilterChip({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
      }`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </button>
  );
}

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
        const amt = amountOf(it);
        if (amt == null) return false;
        if (amountFilter === 'high' && !(amt > 10000)) return false;
        if (amountFilter === 'low' && !(amt < 1000)) return false;
      }
      return true;
    });
  }, [items, search, statusFilter, typeFilter, dateFilter, amountFilter]);

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Signature Inbox</Trans>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Documents emailed in for signature. Each is read by OCR (BMS ML) so you can review the
              data, then send it off to sign.
            </Trans>
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="px-2"
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
              <Volume2Icon className="h-3.5 w-3.5" />
            ) : (
              <VolumeXIcon className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={fetchNow.isPending}
            onClick={() => fetchNow.mutate()}
          >
            <RefreshCwIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Fetch from WorkHub</Trans>
          </Button>
        </div>
      </div>

      {inboxAddress && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r)] border border-border bg-muted/30 px-4 py-3 text-[12px]">
          <span className="text-muted-foreground">
            <Trans>Email PDFs to your organization's inbox:</Trans>
          </span>
          <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[12px] font-medium">
            {inboxAddress}
          </code>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => {
              void navigator.clipboard?.writeText(inboxAddress);
              toast({ title: _(msg`Copied`) });
            }}
          >
            <Trans>Copy</Trans>
          </Button>
        </div>
      )}

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
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={_(msg`Search by document, vendor, invoice #, PO #, or amount`)}
                className="h-9 w-full rounded-[var(--r)] border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-primary/50"
              />
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
            <div className="rounded-[var(--r)] border border-border bg-card">
              <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Invoice info</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Vendor / Contact</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Amounts</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Dates</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Actions</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
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
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-border last:border-0 ${
                      isOverdue
                        ? 'bg-orange-50 hover:bg-orange-100/70 dark:bg-orange-950/40 dark:hover:bg-orange-950/60'
                        : 'hover:bg-muted/20'
                    }`}
                  >
                    {/* Invoice info */}
                    <td
                      className={`border-l-[3px] px-4 py-3 align-top ${
                        isOverdue
                          ? 'border-l-orange-500'
                          : isUnread
                            ? 'border-l-primary'
                            : 'border-l-transparent'
                      }`}
                    >
                      <Link
                        to={`/org/inbox/${item.id}`}
                        className={`text-[13px] hover:text-primary hover:underline ${
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
                            <Trans>overdue {overdueLabel(item.sla?.overdueByMinutes ?? 0)}</Trans>
                          </span>
                        )}
                        <SignatureStatus signature={item.signature} />
                        <WorkflowActivityIndicator item={item} />
                      </div>
                    </td>

                    {/* Vendor / contact */}
                    <td className="px-4 py-3 align-top">
                      <p className="text-[13px] font-medium">{f.vendorName || '—'}</p>
                      {f.vendorEmail && (
                        <p className="text-[12px] text-muted-foreground">{f.vendorEmail}</p>
                      )}
                      {item.senderEmail && (
                        <p className="text-[11px] text-muted-foreground/70">from {item.senderEmail}</p>
                      )}
                    </td>

                    {/* Amounts — single currency, straight from BMS ML metadata */}
                    <td className="px-4 py-3 align-top text-right">
                      {f.currency && (
                        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {f.currency}
                        </div>
                      )}
                      {hasAmounts ? (
                        <dl className="space-y-0.5 text-[12px]">
                          {f.total && (
                            <div className="flex items-baseline justify-end gap-2">
                              <dt className="text-[10px] uppercase text-muted-foreground">Inv</dt>
                              <dd className="font-semibold tabular-nums">{fmtMoney(f.currency, f.total)}</dd>
                            </div>
                          )}
                          {f.tax && (
                            <div className="flex items-baseline justify-end gap-2">
                              <dt className="text-[10px] uppercase text-muted-foreground">Tax</dt>
                              <dd className="tabular-nums">{fmtMoney(f.currency, f.tax)}</dd>
                            </div>
                          )}
                          {f.net && (
                            <div className="flex items-baseline justify-end gap-2">
                              <dt className="text-[10px] uppercase text-muted-foreground">Net</dt>
                              <dd className="font-medium tabular-nums">{fmtMoney(f.currency, f.net)}</dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Dates */}
                    <td className="px-4 py-3 align-top text-[12px]">
                      <dl className="space-y-0.5">
                        {f.invoiceDate && (
                          <div className="flex items-baseline gap-2">
                            <dt className="w-16 text-[10px] uppercase text-muted-foreground">Invoice</dt>
                            <dd className="tabular-nums">{fmtDate(f.invoiceDate)}</dd>
                          </div>
                        )}
                        {f.dueDate && (
                          <div className="flex items-baseline gap-2">
                            <dt className="w-16 text-[10px] uppercase text-muted-foreground">Due</dt>
                            <dd className="tabular-nums">{fmtDate(f.dueDate)}</dd>
                          </div>
                        )}
                        <div className="flex items-baseline gap-2">
                          <dt className="w-16 text-[10px] uppercase text-muted-foreground">Created</dt>
                          <dd className="tabular-nums text-muted-foreground">{fmtDate(item.createdAt)}</dd>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <dt className="w-16 text-[10px] uppercase text-muted-foreground">Updated</dt>
                          <dd className="tabular-nums text-muted-foreground">
                            {formatRelativeTime(item.updatedAt)}
                          </dd>
                        </div>
                      </dl>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center justify-end gap-1">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
