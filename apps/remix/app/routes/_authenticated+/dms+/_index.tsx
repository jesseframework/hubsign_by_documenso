import { Trans } from '@lingui/react/macro';
import {
  ArchiveIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  FileTextIcon,
  MapPinIcon,
} from 'lucide-react';

import { trpc } from '@documenso/trpc/react';

import { CardMetric } from '~/components/general/metric-card';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Document Manager');
}

export default function DmsDashboard() {
  const { data: stats, isLoading } = trpc.dms.getDashboardStats.useQuery();

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardMetric
          icon={FileTextIcon}
          title="Total Documents"
          value={stats?.totalDocuments ?? 0}
          subtitle="All time"
          accentColor="#7c5cfc"
          iconBg="bg-primary/10"
        />
        <CardMetric
          icon={ArchiveIcon}
          title="Active"
          value={stats?.activeDocuments ?? 0}
          subtitle="Current"
          accentColor="#1a9b6e"
          iconBg="bg-status-complete-bg"
        />
        <CardMetric
          icon={CheckCircle2Icon}
          title="Archived"
          value={stats?.archivedDocuments ?? 0}
          subtitle="Filed away"
          accentColor="#6b6780"
          iconBg="bg-muted"
        />
        <CardMetric
          icon={ClipboardListIcon}
          title="Pending Retrievals"
          value={stats?.pendingRetrievals ?? 0}
          subtitle="Awaiting action"
          accentColor="#c07a00"
          iconBg="bg-status-pending-bg"
        />
      </div>

      {/* Recent Documents */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">
            <Trans>Recent Documents</Trans>
          </h2>
        </div>
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Trans>Loading...</Trans>
            </div>
          ) : stats?.recentDocuments && stats.recentDocuments.length > 0 ? (
            stats.recentDocuments.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/30"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <FileTextIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{doc.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {doc.referenceNumber} · {doc.documentType?.name || 'Uncategorized'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      doc.status === 'ACTIVE'
                        ? 'bg-status-complete-bg text-status-complete-text'
                        : doc.status === 'ARCHIVED'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-status-pending-bg text-status-pending-text'
                    }`}
                  >
                    <span className="h-[5px] w-[5px] rounded-full bg-current opacity-80" />
                    {doc.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ArchiveIcon className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-[13px]">
                <Trans>No documents yet. Upload your first document to get started.</Trans>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filing Locations */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">
            <Trans>Filing Locations</Trans>
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {stats?.totalLocations ?? 0} locations
          </span>
        </div>
        <div className="p-4">
          {stats?.totalLocations === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MapPinIcon className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-[13px]">
                <Trans>No filing locations configured. Set up your first location in Filing Structure.</Trans>
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              <Trans>
                {stats?.totalLocations} locations configured. Go to Filing Structure to manage.
              </Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
