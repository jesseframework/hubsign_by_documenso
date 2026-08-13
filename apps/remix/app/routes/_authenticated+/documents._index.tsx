import { useEffect, useMemo, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import {
  CheckCircle2Icon,
  ClockIcon,
  FileIcon,
  FileTextIcon,
  Loader2,
  MailIcon,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { Link } from 'react-router';
import { z } from 'zod';

import { FolderType } from '@documenso/lib/types/folder-type';
import { parseToIntegerArray } from '@documenso/lib/utils/params';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { ExtendedDocumentStatus } from '@documenso/prisma/types/extended-document-status';
import { trpc } from '@documenso/trpc/react';
import {
  type TFindDocumentsInternalResponse,
  ZFindDocumentsInternalRequestSchema,
} from '@documenso/trpc/server/document-router/schema';
import { type TFolderWithSubfolders } from '@documenso/trpc/server/folder-router/schema';
import { Button } from '@documenso/ui/primitives/button';

import { CardMetric } from '~/components/general/metric-card';
import { DocumentMoveToFolderDialog } from '~/components/dialogs/document-move-to-folder-dialog';
import { CreateFolderDialog } from '~/components/dialogs/folder-create-dialog';
import { FolderDeleteDialog } from '~/components/dialogs/folder-delete-dialog';
import { FolderMoveDialog } from '~/components/dialogs/folder-move-dialog';
import { FolderSettingsDialog } from '~/components/dialogs/folder-settings-dialog';
import { DocumentDropZoneWrapper } from '~/components/general/document/document-drop-zone-wrapper';
import { DocumentUploadDropzone } from '~/components/general/document/document-upload';
import { FolderCard } from '~/components/general/folder/folder-card';
import { DocumentsFilterCard } from '~/components/tables/documents-filter-card';
import { DocumentsTable } from '~/components/tables/documents-table';
import { DocumentsTableEmptyState } from '~/components/tables/documents-table-empty-state';
import { DocumentsTableSenderFilter } from '~/components/tables/documents-table-sender-filter';
import { useOptionalCurrentTeam } from '~/providers/team';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('E-Sign');
}

const ZSearchParamsSchema = ZFindDocumentsInternalRequestSchema.pick({
  status: true,
  period: true,
  page: true,
  perPage: true,
  query: true,
}).extend({
  senderIds: z.string().transform(parseToIntegerArray).optional().catch([]),
});

export default function DocumentsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [isMovingDocument, setIsMovingDocument] = useState(false);
  const [documentToMove, setDocumentToMove] = useState<number | null>(null);
  const [isMovingFolder, setIsMovingFolder] = useState(false);
  const [folderToMove, setFolderToMove] = useState<TFolderWithSubfolders | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<TFolderWithSubfolders | null>(null);
  const [isSettingsFolderOpen, setIsSettingsFolderOpen] = useState(false);
  const [folderToSettings, setFolderToSettings] = useState<TFolderWithSubfolders | null>(null);

  const team = useOptionalCurrentTeam();

  const { mutateAsync: pinFolder } = trpc.folder.pinFolder.useMutation();
  const { mutateAsync: unpinFolder } = trpc.folder.unpinFolder.useMutation();

  const [stats, setStats] = useState<TFindDocumentsInternalResponse['stats']>({
    [ExtendedDocumentStatus.DRAFT]: 0,
    [ExtendedDocumentStatus.PENDING]: 0,
    [ExtendedDocumentStatus.COMPLETED]: 0,
    [ExtendedDocumentStatus.REJECTED]: 0,
    [ExtendedDocumentStatus.INBOX]: 0,
    [ExtendedDocumentStatus.ALL]: 0,
  });

  const findDocumentSearchParams = useMemo(
    () => ZSearchParamsSchema.safeParse(Object.fromEntries(searchParams.entries())).data || {},
    [searchParams],
  );

  const { data, isLoading, isLoadingError, refetch } = trpc.document.findDocumentsInternal.useQuery(
    {
      ...findDocumentSearchParams,
    },
  );

  const {
    data: foldersData,
    isLoading: isFoldersLoading,
    refetch: refetchFolders,
  } = trpc.folder.getFolders.useQuery({
    type: FolderType.DOCUMENT,
    parentId: null,
  });

  useEffect(() => {
    void refetch();
    void refetchFolders();
  }, [team?.url]);


  useEffect(() => {
    if (data?.stats) {
      setStats(data.stats);
    }
  }, [data?.stats]);

  // Build the URL for a status-filtered view of the document list. Used by
  // the metric cards so clicking one filters the table the same way the
  // (now-removed) tab strip used to.
  const getStatusHref = (value: keyof typeof ExtendedDocumentStatus) => {
    const params = new URLSearchParams(searchParams);
    params.set('status', value);
    if (value === ExtendedDocumentStatus.ALL) {
      params.delete('status');
    }
    if (params.has('page')) {
      params.delete('page');
    }
    return `${formatDocumentsPath(team?.url)}?${params.toString()}`;
  };

  const activeStatus = findDocumentSearchParams.status || ExtendedDocumentStatus.ALL;

  const navigateToFolder = (folderId?: string | null) => {
    const documentsPath = formatDocumentsPath(team?.url);

    if (folderId) {
      void navigate(`${documentsPath}/f/${folderId}`);
    } else {
      void navigate(documentsPath);
    }
  };

  const handleViewAllFolders = () => {
    void navigate(`${formatDocumentsPath(team?.url)}/folders`);
  };

  return (
    <DocumentDropZoneWrapper>
      <div className="w-full">
        {/*
          Same header as the Signature Inbox: name, one line saying what the screen
          holds, actions on the right, closed by a rule. The name used to sit
          two-thirds down the page immediately above the table, which read as a
          section heading for the table rather than the title of the screen — and at
          text-xl it was a different size from every other page's heading.
        */}
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border pb-3">
          <div className="min-w-0">
            {/* Matches the sidebar row and the breadcrumb exactly — one surface,
                one name, wherever the user reads it. */}
            <h2 className="text-lg font-semibold tracking-[-0.01em]">
              <Trans>E-Sign</Trans>
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              <Trans>Everything in signing — drafts, out for signature, and fully signed.</Trans>
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            <DocumentUploadDropzone />
            <CreateFolderDialog />
          </div>
        </header>

        {/* Stats grid — clickable, each card filters the document list to
            its status. Mirrors the behaviour of the removed tab strip. */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:grid-cols-5">
          <CardMetric
            icon={FileTextIcon}
            title="Total"
            value={stats[ExtendedDocumentStatus.ALL]}
            subtitle="All time"
            accentColor="#7c5cfc"
            iconBg="bg-primary/10"
            href={getStatusHref(ExtendedDocumentStatus.ALL)}
            isActive={activeStatus === ExtendedDocumentStatus.ALL}
          />
          <CardMetric
            icon={MailIcon}
            title="Inbox"
            value={stats[ExtendedDocumentStatus.INBOX]}
            subtitle="Needs action"
            accentColor="#3b5bdb"
            iconBg="bg-status-inbox-bg"
            href={getStatusHref(ExtendedDocumentStatus.INBOX)}
            isActive={activeStatus === ExtendedDocumentStatus.INBOX}
          />
          <CardMetric
            icon={ClockIcon}
            title="Pending"
            value={stats[ExtendedDocumentStatus.PENDING]}
            subtitle="Awaiting others"
            accentColor="#c07a00"
            iconBg="bg-status-pending-bg"
            href={getStatusHref(ExtendedDocumentStatus.PENDING)}
            isActive={activeStatus === ExtendedDocumentStatus.PENDING}
          />
          <CardMetric
            icon={CheckCircle2Icon}
            title="Completed"
            value={stats[ExtendedDocumentStatus.COMPLETED]}
            subtitle="Fully signed"
            accentColor="#1a9b6e"
            iconBg="bg-status-complete-bg"
            href={getStatusHref(ExtendedDocumentStatus.COMPLETED)}
            isActive={activeStatus === ExtendedDocumentStatus.COMPLETED}
          />
          <CardMetric
            icon={FileIcon}
            title="Draft"
            value={stats[ExtendedDocumentStatus.DRAFT]}
            subtitle="Not yet sent"
            accentColor="#6b7280"
            iconBg="bg-muted"
            href={getStatusHref(ExtendedDocumentStatus.DRAFT)}
            isActive={activeStatus === ExtendedDocumentStatus.DRAFT}
          />
        </div>

        {isFoldersLoading ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          </div>
        ) : (
          <>
            {foldersData?.folders && foldersData.folders.length > 0 && (
              <div className="mt-5 flex items-center justify-between">
                <span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <Trans>Folders</Trans>
                </span>
                {foldersData.folders.length > 12 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px]"
                    onClick={() => void handleViewAllFolders()}
                  >
                    See all
                  </Button>
                )}
              </div>
            )}

            {foldersData?.folders?.some((folder) => folder.pinned) && (
              <div className="mt-2.5">
                <div className="scrollbar-hide flex gap-2.5 overflow-x-auto pb-1">
                  {foldersData.folders
                    .filter((folder) => folder.pinned)
                    .map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onNavigate={navigateToFolder}
                        onMove={(folder) => {
                          setFolderToMove(folder);
                          setIsMovingFolder(true);
                        }}
                        onPin={(folderId) => void pinFolder({ folderId })}
                        onUnpin={(folderId) => void unpinFolder({ folderId })}
                        onSettings={(folder) => {
                          setFolderToSettings(folder);
                          setIsSettingsFolderOpen(true);
                        }}
                        onDelete={(folder) => {
                          setFolderToDelete(folder);
                          setIsDeletingFolder(true);
                        }}
                      />
                    ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <div className="scrollbar-hide flex gap-2.5 overflow-x-auto pb-1">
                {foldersData?.folders
                  ?.filter((folder) => !folder.pinned)
                  .slice(0, 12)
                  .map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      onNavigate={navigateToFolder}
                      onMove={(folder) => {
                        setFolderToMove(folder);
                        setIsMovingFolder(true);
                      }}
                      onPin={(folderId) => void pinFolder({ folderId })}
                      onUnpin={(folderId) => void unpinFolder({ folderId })}
                      onSettings={(folder) => {
                        setFolderToSettings(folder);
                        setIsSettingsFolderOpen(true);
                      }}
                      onDelete={(folder) => {
                        setFolderToDelete(folder);
                        setIsDeletingFolder(true);
                      }}
                    />
                  ))}
              </div>

              {/* Only when there is something to show. The row used to render
                  regardless, leaving 24px of margin and a button's worth of empty
                  space under the folders on every account with twelve or fewer —
                  a gap that was hidden behind the old mid-page heading. */}
              {foldersData && foldersData.folders?.length > 12 && (
                <div className="mt-6 flex items-center justify-center">
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void handleViewAllFolders()}
                  >
                    View all folders
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {/*
          The Signature Inbox's filter card, so the two lists filter alike. It
          replaces a period dropdown and a bare search box: the period is a chip
          now, the status chips reach Rejected (which has no metric card, and so
          had no control at all), and the count line says how much of the queue you
          are looking at. The sender dropdown is passed in rather than rebuilt —
          a team can have more members than a chip row can hold.
        */}
        <DocumentsFilterCard
          shown={data?.data.length ?? 0}
          total={data?.count ?? 0}
          senderFilter={team ? <DocumentsTableSenderFilter teamId={team.id} /> : undefined}
        />

        <div className="overflow-hidden rounded-[var(--r)] border border-border bg-card">
          {data &&
          data.count === 0 &&
          (!foldersData?.folders.length || foldersData.folders.length === 0) ? (
            <DocumentsTableEmptyState
              status={findDocumentSearchParams.status || ExtendedDocumentStatus.ALL}
            />
          ) : (
            <DocumentsTable
              data={data}
              isLoading={isLoading}
              isLoadingError={isLoadingError}
              onMoveDocument={(documentId) => {
                setDocumentToMove(documentId);
                setIsMovingDocument(true);
              }}
            />
          )}
        </div>

        {documentToMove && (
          <DocumentMoveToFolderDialog
            documentId={documentToMove}
            open={isMovingDocument}
            onOpenChange={(open) => {
              setIsMovingDocument(open);

              if (!open) {
                setDocumentToMove(null);
              }
            }}
          />
        )}

        <FolderMoveDialog
          foldersData={foldersData?.folders}
          folder={folderToMove}
          isOpen={isMovingFolder}
          onOpenChange={(open) => {
            setIsMovingFolder(open);

            if (!open) {
              setFolderToMove(null);
            }
          }}
        />

        <FolderSettingsDialog
          folder={folderToSettings}
          isOpen={isSettingsFolderOpen}
          onOpenChange={(open) => {
            setIsSettingsFolderOpen(open);

            if (!open) {
              setFolderToSettings(null);
            }
          }}
        />

        <FolderDeleteDialog
          folder={folderToDelete}
          isOpen={isDeletingFolder}
          onOpenChange={(open) => {
            setIsDeletingFolder(open);

            if (!open) {
              setFolderToDelete(null);
            }
          }}
        />
      </div>
    </DocumentDropZoneWrapper>
  );
}
