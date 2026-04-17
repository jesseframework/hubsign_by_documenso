import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  CheckCircleIcon,
  ClockIcon,
  CpuIcon,
  Loader,
  RefreshCwIcon,
  SettingsIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('OCR Queue');
}

export default function DmsOcrQueuePage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: allDocs, isLoading } = trpc.dms.searchDocuments.useQuery({
    page: 1,
    perPage: 100,
  });

  const { data: ocrStatus } = trpc.dms.getOcrStatus.useQuery();
  const { data: orgMembership } = trpc.org.getMyOrganization.useQuery();

  const triggerOcr = trpc.dms.triggerOcr.useMutation({
    onSuccess: (result) => {
      void utils.dms.searchDocuments.invalidate();
      if (result.status === 'completed' || result.status === 'needs_review') {
        toast({ title: `OCR complete — ${result.fieldsExtracted} fields extracted` });
      } else if (result.status === 'not_configured') {
        toast({ title: 'OCR not configured', description: result.message, variant: 'destructive' });
      } else if (result.status === 'error') {
        toast({ title: 'OCR failed', description: result.message, variant: 'destructive' });
      }
    },
  });

  const pendingOcr = allDocs?.data?.filter((d) => !d.ocrProcessed) ?? [];
  const completedOcr = allDocs?.data?.filter((d) => d.ocrProcessed) ?? [];

  const orgOcrConfigured = !!orgMembership?.organization?.ocrApiUrl;
  const isConnected = ocrStatus?.available || orgOcrConfigured;

  const processAll = async () => {
    for (const doc of pendingOcr) {
      await triggerOcr.mutateAsync({ id: doc.id });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold"><Trans>OCR Processing Queue</Trans></h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>Track OCR processing status for uploaded documents.</Trans>
          </p>
        </div>
        <div className="flex gap-2">
          {pendingOcr.length > 0 && isConnected && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void processAll()}
              disabled={triggerOcr.isPending}
            >
              {triggerOcr.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CpuIcon className="h-3.5 w-3.5" />}
              Process All ({pendingOcr.length})
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={() => void utils.dms.searchDocuments.invalidate()}
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
            <Trans>Refresh</Trans>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-amber-600">
            <ClockIcon className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase">Pending OCR</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{pendingOcr.length}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircleIcon className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase">Completed</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{completedOcr.length}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-primary">
            <CpuIcon className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase">Total Documents</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{allDocs?.count ?? 0}</p>
        </div>
      </div>

      {/* AI Service Status */}
      <div className={`rounded-[var(--r)] border p-4 ${isConnected ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30' : 'border-dashed border-border bg-card'}`}>
        <div className="flex items-center gap-3">
          <CpuIcon className={`h-6 w-6 ${isConnected ? 'text-green-600' : 'text-muted-foreground/40'}`} />
          <div className="flex-1">
            <p className="text-[13px] font-medium">BMS ML — OCR & AI Service</p>
            {orgOcrConfigured ? (
              <p className="text-[11px] text-muted-foreground">
                Connected to: <code className="rounded bg-muted px-1">{orgMembership?.organization?.ocrApiUrl}</code>
                {orgMembership?.organization?.ocrDefaultEngine && ` · Engine: ${orgMembership.organization.ocrDefaultEngine}`}
                {orgMembership?.organization?.ocrAutoProcess && ' · Auto-process enabled'}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                <Trans>Configure your BMS ML service in</Trans>{' '}
                <Link to="/org/settings" className="text-primary hover:underline">Organization Settings</Link>
                {' '}<Trans>to enable automatic OCR processing.</Trans>
              </p>
            )}
          </div>
          {isConnected ? (
            <span className="rounded-full bg-green-100 px-3 py-1 text-[11px] font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
              Connected
            </span>
          ) : (
            <Link to="/org/settings" className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              <SettingsIcon className="h-3 w-3" />
              Configure
            </Link>
          )}
        </div>
      </div>

      {/* Pending OCR */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold"><Trans>Pending OCR Processing</Trans></h3>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">Loading...</div>
        ) : pendingOcr.length > 0 ? (
          <div className="divide-y divide-border">
            {pendingOcr.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950">
                  <ClockIcon className="h-4 w-4 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/dms/doc/${doc.id}`} className="text-[13px] font-medium hover:underline">
                    {doc.title}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    {doc.referenceNumber} · {doc.fileName} · {(doc.fileSize / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <ClockIcon className="h-3 w-3" />
                  Pending
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-[11px]"
                  disabled={!isConnected || triggerOcr.isPending}
                  onClick={() => void triggerOcr.mutateAsync({ id: doc.id })}
                >
                  {triggerOcr.isPending ? <Loader className="h-3 w-3 animate-spin" /> : <CpuIcon className="h-3 w-3" />}
                  Process
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <CheckCircleIcon className="mb-3 h-8 w-8 text-green-500/40" />
            <p className="text-[13px]"><Trans>All documents have been processed</Trans></p>
          </div>
        )}
      </div>

      {/* Recently Completed */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold"><Trans>Recently Processed</Trans></h3>
        </div>

        {completedOcr.length > 0 ? (
          <div className="divide-y divide-border">
            {completedOcr.slice(0, 20).map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950">
                  <CheckCircleIcon className="h-4 w-4 text-green-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/dms/doc/${doc.id}`} className="text-[13px] font-medium hover:underline">
                    {doc.title}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    {doc.referenceNumber} · {doc.documentType?.name || 'Uncategorized'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                  <CheckCircleIcon className="h-3 w-3" />
                  Processed
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-[13px] text-muted-foreground">
            <Trans>No documents processed yet</Trans>
          </div>
        )}
      </div>
    </div>
  );
}
