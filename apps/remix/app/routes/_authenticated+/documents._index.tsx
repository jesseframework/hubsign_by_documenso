import { useEffect, useMemo, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import {
  CheckCircle2Icon,
  ClockIcon,
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
import { Tabs, TabsList, TabsTrigger } from '@documenso/ui/primitives/tabs';

import { CardMetric } from '~/components/general/metric-card';
import { DocumentMoveToFolderDialog } from '~/components/dialogs/document-move-to-folder-dialog';
import { CreateFolderDialog } from '~/components/dialogs/folder-create-dialog';
import { FolderDeleteDialog } from '~/components/dialogs/folder-delete-dialog';
import { FolderMoveDialog } from '~/components/dialogs/folder-move-dialog';
import { FolderSettingsDialog } from '~/components/dialogs/folder-settings-dialog';
import { DocumentDropZoneWrapper } from '~/components/general/document/document-drop-zone-wrapper';
import { DocumentSearch } from '~/components/general/document/document-search';
import { DocumentStatus } from '~/components/general/document/document-status';
import { DocumentUploadDropzone } from '~/components/general/document/document-upload';
import { FolderCard } from '~/components/general/folder/folder-card';
import { PeriodSelector } from '~/components/general/period-selector';
import { DocumentsTable } from '~/components/tables/documents-table';
import { DocumentsTableEmptyState } from '~/components/tables/documents-table-empty-state';
import { DocumentsTableSenderFilter } from '~/components/tables/documents-table-sender-filter';
import { useOptionalCurrentTeam } from '~/providers/team';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Documents');
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

  const getTabHref = (value: keyof typeof ExtendedDocumentStatus) => {
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

  useEffect(() => {
    if (data?.stats) {
      setStats(data.stats);
    }
  }, [data?.stats]);

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
        {/* Actions bar */}
        <div className="flex items-center justify-end gap-3">
          <DocumentUploadDropzone />
          <CreateFolderDialog />
        </div>

        {/* Stats grid */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:grid-cols-4">
          <CardMetric
            icon={FileTextIcon}
            title="Total"
            value={stats[ExtendedDocumentStatus.ALL]}
            subtitle="All time"
            accentColor="#7c5cfc"
            iconBg="bg-primary/10"
          />
          <CardMetric
            icon={MailIcon}
            title="Inbox"
            value={stats[ExtendedDocumentStatus.INBOX]}
            subtitle="Needs action"
            accentColor="#3b5bdb"
            iconBg="bg-status-inbox-bg"
          />
          <CardMetric
            icon={ClockIcon}
            title="Pending"
            value={stats[ExtendedDocumentStatus.PENDING]}
            subtitle="Awaiting others"
            accentColor="#c07a00"
            iconBg="bg-status-pending-bg"
          />
          <CardMetric
            icon={CheckCircle2Icon}
            title="Completed"
            value={stats[ExtendedDocumentStatus.COMPLETED]}
            subtitle="Fully signed"
            accentColor="#1a9b6e"
            iconBg="bg-status-complete-bg"
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

              <div className="mt-6 flex items-center justify-center">
                {foldersData && foldersData.folders?.length > 12 && (
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void handleViewAllFolders()}
                  >
                    View all folders
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Documents section title */}
        <div className="mt-8 mb-3">
          <h2 className="font-display text-[22px] font-semibold tracking-tight">
            <Trans>Documents</Trans>
          </h2>
        </div>

        {/* Table card with filters inside */}
        <div className="overflow-hidden rounded-[var(--r)] border border-border bg-card">
          {/* Filter bar inside card */}
          <div className="flex items-center gap-2 border-b border-border p-2 sm:p-3">
            {/* Tab pills - scrollable */}
            <div className="scrollbar-hide min-w-0 flex-1 overflow-x-auto">
              <Tabs value={findDocumentSearchParams.status || 'ALL'}>
                <TabsList className="inline-flex w-auto gap-0.5 rounded-md border border-border bg-background p-[3px]">
                  {[
                    ExtendedDocumentStatus.ALL,
                    ExtendedDocumentStatus.INBOX,
                    ExtendedDocumentStatus.PENDING,
                    ExtendedDocumentStatus.COMPLETED,
                    ExtendedDocumentStatus.DRAFT,
                  ].map((value) => (
                    <TabsTrigger
                      key={value}
                      className="gap-1 whitespace-nowrap rounded px-2 py-1 text-[12px] font-medium data-[state=active]:bg-card data-[state=active]:font-semibold sm:gap-1.5 sm:px-3 sm:py-1.5"
                      value={value}
                      asChild
                    >
                      <Link to={getTabHref(value)} preventScrollReset>
                        <DocumentStatus status={value} />
                        <span className={`text-[10px] font-semibold rounded-full px-1.5 py-px ${
                          findDocumentSearchParams.status === value || (!findDocumentSearchParams.status && value === 'ALL')
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {stats[value]}
                        </span>
                      </Link>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {/* Right side filters */}
            <div className="ml-auto hidden flex-shrink-0 items-center gap-2 sm:flex">
              {team && <DocumentsTableSenderFilter teamId={team.id} />}
              <PeriodSelector />
              <DocumentSearch initialValue={findDocumentSearchParams.query} />
            </div>
          </div>
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
