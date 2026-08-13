import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  CalendarIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  FileIcon,
  MailIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';

import { useDebouncedValue } from '@documenso/lib/client-only/hooks/use-debounced-value';
import { ExtendedDocumentStatus } from '@documenso/prisma/types/extended-document-status';

import { FilterChip, FilterGroupLabel } from '~/components/general/filter-chip';

/**
 * The Signature Inbox filter card, over the E-Sign list.
 *
 * The two screens are the same job at different stages — mail waiting to be sent
 * for signature, then everything that was sent — and until now they filtered by
 * completely different means: chips and a live search on one, a period dropdown
 * and a bare input on the other.
 *
 * The one structural difference is where filtering happens. The inbox holds at
 * most 100 rows and filters them in the browser; this list is paginated on the
 * server, so every control here writes a URL search param that the query reads.
 * That is also what makes the filters shareable and survive a reload, which the
 * inbox's do not.
 */

const STATUS_FILTERS = [
  { key: ExtendedDocumentStatus.INBOX, label: msg`Needs action`, icon: MailIcon },
  { key: ExtendedDocumentStatus.PENDING, label: msg`Awaiting others`, icon: ClockIcon },
  { key: ExtendedDocumentStatus.COMPLETED, label: msg`Completed`, icon: CheckCircle2Icon },
  { key: ExtendedDocumentStatus.DRAFT, label: msg`Draft`, icon: FileIcon },
  // Rejected has no metric card of its own, so before these chips existed the
  // only way to see rejected documents was to type the status into the URL.
  { key: ExtendedDocumentStatus.REJECTED, label: msg`Rejected`, icon: XCircleIcon },
] as const;

/** Mirrors `PeriodSelectorValue` in `find-documents`, which the server parses. */
const PERIOD_FILTERS = [
  { key: '7d', label: msg`Last 7 days` },
  { key: '14d', label: msg`Last 14 days` },
  { key: '30d', label: msg`Last 30 days` },
] as const;

export const DocumentsFilterCard = ({
  /** Rows on the current page, and how many the filters match in total. */
  shown,
  total,
  /** The team sender dropdown, which only exists inside a team. */
  senderFilter,
}: {
  shown: number;
  total: number;
  senderFilter?: React.ReactNode;
}) => {
  const { _ } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get('status') ?? '';
  const period = searchParams.get('period') ?? '';
  const queryParam = searchParams.get('query') ?? '';

  const [search, setSearch] = useState(queryParam);
  const debouncedSearch = useDebouncedValue(search, 500);

  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * Write a param, dropping `page` with it.
   *
   * Without that, narrowing the list while on page 4 lands the reader on page 4
   * of a two-page result — an empty table that looks like "no matches".
   */
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    params.delete('page');
    setSearchParams(params);
  };

  // The input is the one control that does not write on every keystroke.
  useEffect(() => {
    if (debouncedSearch !== queryParam) {
      setParam('query', debouncedSearch || null);
    }
  }, [debouncedSearch]);

  // A filter changed elsewhere (a metric card, the back button) must not leave a
  // stale term in the box.
  useEffect(() => {
    setSearch(queryParam);
  }, [queryParam]);

  const toggle = (key: string, current: string, value: string) =>
    setParam(key, current === value ? null : value);

  const activeChipCount = [status, period].filter(Boolean).length;
  const anyFilter = Boolean(status || period || queryParam || searchParams.get('senderIds'));

  const clearAll = () => {
    const params = new URLSearchParams(searchParams);

    for (const key of ['status', 'period', 'query', 'senderIds', 'page']) {
      params.delete(key);
    }

    setSearch('');
    setSearchParams(params);
  };

  return (
    <div className="mb-3 space-y-3 rounded-[var(--r)] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Names what the search actually reaches, now that it reads the OCR
            // extraction as well as the document's own fields.
            placeholder={_(msg`Search by title, recipient, vendor, invoice # or PO #`)}
            className="h-9 w-full rounded-[var(--r)] border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-primary/50"
          />
        </div>

        {senderFilter}
      </div>

      <button
        type="button"
        onClick={() => setFiltersOpen((open) => !open)}
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
            <FilterGroupLabel>
              <Trans>Status</Trans>
            </FilterGroupLabel>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.key}
                  active={status === filter.key}
                  icon={filter.icon}
                  onClick={() => toggle('status', status, filter.key)}
                >
                  {_(filter.label)}
                </FilterChip>
              ))}
            </div>
          </div>

          <div>
            <FilterGroupLabel>
              <Trans>Created</Trans>
            </FilterGroupLabel>
            <div className="flex flex-wrap gap-1.5">
              {PERIOD_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.key}
                  active={period === filter.key}
                  icon={CalendarIcon}
                  onClick={() => toggle('period', period, filter.key)}
                >
                  {_(filter.label)}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-[11px] text-muted-foreground">
          <Trans>
            Showing {shown} of {total}
          </Trans>
        </span>
        {anyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <XIcon className="h-3 w-3" />
            <Trans>Clear all</Trans>
          </button>
        )}
      </div>
    </div>
  );
};
