import { useMemo, useTransition } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Loader } from 'lucide-react';
import { DateTime } from 'luxon';
import { Link } from 'react-router';
import { match } from 'ts-pattern';

import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import type { TFindDocumentsInternalResponse } from '@documenso/trpc/server/document-router/schema';
import type { DataTableColumnDef } from '@documenso/ui/primitives/data-table';
import { DataTable } from '@documenso/ui/primitives/data-table';
import { DataTablePagination } from '@documenso/ui/primitives/data-table-pagination';
import { Skeleton } from '@documenso/ui/primitives/skeleton';
import { TableCell } from '@documenso/ui/primitives/table';

import { DocumentStatus } from '~/components/general/document/document-status';
import { useOptionalCurrentTeam } from '~/providers/team';

import { StackAvatarsWithTooltip } from '../general/stack-avatars-with-tooltip';
import { DocumentOcrSummary } from './document-ocr-summary';
import { DocumentsTableActionButton } from './documents-table-action-button';
import { DocumentsTableActionDropdown } from './documents-table-action-dropdown';

export type DocumentsTableProps = {
  /*
    The INTERNAL response, which is what both callers actually pass. It was typed
    as the public one, which happened to compile because the public shape is a
    subset — but it meant the table could not see fields the internal endpoint
    returns, `ocr` among them.
  */
  data?: TFindDocumentsInternalResponse;
  isLoading?: boolean;
  isLoadingError?: boolean;
  onMoveDocument?: (documentId: number) => void;
};

type DocumentsTableRow = TFindDocumentsInternalResponse['data'][number];

export const DocumentsTable = ({
  data,
  isLoading,
  isLoadingError,
  onMoveDocument,
}: DocumentsTableProps) => {
  const { _, i18n } = useLingui();

  const team = useOptionalCurrentTeam();
  const [isPending, startTransition] = useTransition();

  const updateSearchParams = useUpdateSearchParams();

  const columns = useMemo(() => {
    return [
      {
        header: _(msg`Created`),
        accessorKey: 'createdAt',
        cell: ({ row }) => {
          const date = new Date(row.original.createdAt);
          const dateStr = i18n.date(date, { month: 'short', day: 'numeric' });
          const timeStr = i18n.date(date, { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
          return (
            <div className="whitespace-nowrap text-[12px] text-muted-foreground">
              <div>{dateStr}</div>
              <div className="text-[10px] opacity-60">{timeStr}</div>
            </div>
          );
        },
        size: 130,
      },
      {
        header: _(msg`Title`),
        cell: ({ row }) => (
          <div className="min-w-0">
            <DataTableTitle row={row.original} teamUrl={team?.url} />
            {/*
              What OCR read, under the title rather than as three more columns.

              The table is already six columns wide and most of these documents
              are invoices whose filename says little — "Invoice-RFSKPWP7-0018-1"
              tells you nothing about who sent it or what it is for. Rendered only
              when the document came through the inbox and something was read, so
              a hand-uploaded contract looks exactly as it did before.
            */}
            <DocumentOcrSummary ocr={row.original.ocr} />
          </div>
        ),
      },
      {
        id: 'sender',
        header: _(msg`Sender`),
        cell: ({ row }) => (
          <span className="text-[12px] text-muted-foreground">
            {row.original.user.name ?? row.original.user.email}
          </span>
        ),
        size: 170,
      },
      {
        header: _(msg`Recip.`),
        accessorKey: 'recipient',
        cell: ({ row }) => (
          <StackAvatarsWithTooltip
            recipients={row.original.recipients}
            documentStatus={row.original.status}
          />
        ),
        size: 90,
      },
      {
        header: _(msg`Status`),
        accessorKey: 'status',
        cell: ({ row }) => <DocumentStatus status={row.original.status} asBadge />,
        size: 110,
      },
      {
        header: () => <span className="block text-right">{_(msg`Actions`)}</span>,
        id: 'actions',
        cell: ({ row }) =>
          (!row.original.deletedAt || isDocumentCompleted(row.original.status)) && (
            <div className="flex items-center justify-end gap-x-1.5">
              <DocumentsTableActionButton row={row.original} />
              <DocumentsTableActionDropdown
                row={row.original}
                onMoveDocument={onMoveDocument ? () => onMoveDocument(row.original.id) : undefined}
              />
            </div>
          ),
        size: 140,
      },
    ] satisfies DataTableColumnDef<DocumentsTableRow>[];
  }, [team, onMoveDocument]);

  const onPaginationChange = (page: number, perPage: number) => {
    startTransition(() => {
      updateSearchParams({
        page,
        perPage,
      });
    });
  };

  const results = data ?? {
    data: [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  return (
    <div className="relative">
      {/* Desktop table */}
      <div className="hidden sm:block">
        <DataTable
          columns={columns}
          data={results.data}
          perPage={results.perPage}
          currentPage={results.currentPage}
          totalPages={results.totalPages}
          onPaginationChange={onPaginationChange}
          columnVisibility={{
            sender: team !== undefined,
          }}
          error={{
            enable: isLoadingError || false,
          }}
          skeleton={{
            enable: isLoading || false,
            rows: 5,
            component: (
              <>
                <TableCell>
                  <Skeleton className="h-4 w-20 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-40 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20 rounded-full" />
                </TableCell>
                <TableCell className="py-4">
                  <div className="flex w-full flex-row items-center">
                    <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-8 w-24 rounded" />
                </TableCell>
              </>
            ),
          }}
        >
          {(table) => <DataTablePagination additionalInformation="VisibleCount" table={table} />}
        </DataTable>
      </div>

      {/* Mobile card list */}
      <div className="flex flex-col gap-2 sm:hidden">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : results.data.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-muted-foreground">
            No documents found
          </div>
        ) : (
          results.data.map((row) => (
            <MobileDocumentCard key={row.id} row={row} teamUrl={team?.url} onMoveDocument={onMoveDocument} />
          ))
        )}
      </div>

      {isPending && (
        <div className="bg-background/50 absolute inset-0 flex items-center justify-center">
          <Loader className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      )}
    </div>
  );
};

/* ── Mobile Document Card ── */
type MobileDocumentCardProps = {
  row: DocumentsTableRow;
  teamUrl?: string;
  onMoveDocument?: (documentId: number) => void;
};

const MobileDocumentCard = ({ row, teamUrl, onMoveDocument }: MobileDocumentCardProps) => {
  const { i18n } = useLingui();
  const date = new Date(row.createdAt);
  const dateStr = i18n.date(date, { month: 'short', day: 'numeric' });
  const timeStr = i18n.date(date, { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });

  return (
    <div className="flex flex-col gap-2 rounded-[var(--r)] border border-border bg-card p-3.5 transition-colors hover:border-primary/20">
      {/* Top: title + badge */}
      <div className="flex items-start justify-between gap-2.5">
        <DataTableTitle row={row} teamUrl={teamUrl} />
        <DocumentStatus status={row.status} asBadge />
      </div>

      {/* Meta: sender + date */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {row.user.name ?? row.user.email}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {dateStr} · {timeStr}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {(!row.deletedAt || isDocumentCompleted(row.status)) && (
            <>
              <DocumentsTableActionButton row={row} />
              <DocumentsTableActionDropdown
                row={row}
                onMoveDocument={onMoveDocument ? () => onMoveDocument(row.id) : undefined}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Title link ── */
type DataTableTitleProps = {
  row: DocumentsTableRow;
  teamUrl?: string;
};

const DataTableTitle = ({ row, teamUrl }: DataTableTitleProps) => {
  const { user } = useSession();

  const recipient = row.recipients.find((recipient) => recipient.email === user.email);

  const isOwner = row.user.id === user.id;
  const isRecipient = !!recipient;
  const isCurrentTeamDocument = teamUrl && row.team?.url === teamUrl;

  const documentsPath = formatDocumentsPath(isCurrentTeamDocument ? teamUrl : undefined);
  const formatPath = row.folderId
    ? `${documentsPath}/f/${row.folderId}/${row.id}`
    : `${documentsPath}/${row.id}`;

  const titleClass =
    'block max-w-[10rem] truncate text-[13px] font-medium text-foreground hover:underline md:max-w-[20rem]';

  return match({
    isOwner,
    isRecipient,
    isCurrentTeamDocument,
  })
    .with({ isOwner: true }, { isCurrentTeamDocument: true }, () => (
      <Link to={formatPath} title={row.title} className={titleClass}>
        {row.title}
      </Link>
    ))
    .with({ isRecipient: true }, () => (
      <Link to={`/sign/${recipient?.token}`} title={row.title} className={titleClass}>
        {row.title}
      </Link>
    ))
    .otherwise(() => (
      <span className={titleClass}>{row.title}</span>
    ));
};
