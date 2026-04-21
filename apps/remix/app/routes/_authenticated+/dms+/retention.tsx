import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Retention Management');
}

export default function DmsRetentionPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: dueDocs, isLoading } = trpc.dms.getRetentionDue.useQuery();

  const updateDisposal = trpc.dms.updateDisposal.useMutation({
    onSuccess: (_, vars) => {
      void utils.dms.getRetentionDue.invalidate();
      toast({ title: `Document ${vars.disposalStatus.toLowerCase().replace(/_/g, ' ')}` });
    },
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case 'DUE_FOR_REVIEW': return <ClockIcon className="h-4 w-4 text-amber-500" />;
      case 'APPROVED_FOR_DISPOSAL': return <AlertTriangleIcon className="h-4 w-4 text-red-500" />;
      case 'RETAINED': return <ShieldCheckIcon className="h-4 w-4 text-green-500" />;
      default: return <ClockIcon className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Retention & Disposal</Trans>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>Documents that have reached their retention period and require action.</Trans>
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-amber-600">
            <ClockIcon className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase">Due for Review</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {dueDocs?.filter((d) => d.disposalStatus === 'NOT_DUE' || d.disposalStatus === 'DUE_FOR_REVIEW').length ?? 0}
          </p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangleIcon className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase">Approved for Disposal</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {dueDocs?.filter((d) => d.disposalStatus === 'APPROVED_FOR_DISPOSAL').length ?? 0}
          </p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-green-600">
            <ShieldCheckIcon className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase">Retained</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {dueDocs?.filter((d) => d.disposalStatus === 'RETAINED').length ?? 0}
          </p>
        </div>
      </div>

      {/* Documents table */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold">
            <Trans>Documents Past Retention Date</Trans>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Document</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Type</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Retention Date</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Overdue By</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Recommendation</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="py-12 text-center text-[13px] text-muted-foreground">Loading...</td></tr>
              ) : dueDocs && dueDocs.length > 0 ? (
                dueDocs.map((doc) => {
                  const overdueDays = Math.floor((Date.now() - new Date(doc.retentionDate!).getTime()) / (1000 * 60 * 60 * 24));
                  const recommendation = overdueDays > 365 ? 'Dispose' : overdueDays > 180 ? 'Review & Decide' : 'Review Soon';
                  const recColor = overdueDays > 365 ? 'text-red-600' : overdueDays > 180 ? 'text-amber-600' : 'text-blue-600';

                  return (
                    <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-[#faf9fe] dark:hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link to={`/dms/doc/${doc.id}`} className="text-[13px] font-medium hover:underline">
                          {doc.title}
                        </Link>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{doc.referenceNumber}</p>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{doc.documentType?.name || '—'}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {new Date(doc.retentionDate!).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[12px] font-semibold ${overdueDays > 365 ? 'text-red-600' : 'text-amber-600'}`}>
                          {overdueDays} days
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          doc.disposalStatus === 'APPROVED_FOR_DISPOSAL' ? 'bg-red-50 text-red-600'
                          : doc.disposalStatus === 'RETAINED' ? 'bg-green-50 text-green-600'
                          : 'bg-amber-50 text-amber-600'
                        }`}>
                          {statusIcon(doc.disposalStatus)}
                          {doc.disposalStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[12px] font-medium ${recColor}`}>{recommendation}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {(doc.disposalStatus === 'NOT_DUE' || doc.disposalStatus === 'DUE_FOR_REVIEW') && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-[11px] text-green-600"
                                onClick={() => void updateDisposal.mutateAsync({ id: doc.id, disposalStatus: 'RETAINED' })}
                              >
                                <ShieldCheckIcon className="h-3 w-3" />
                                Retain
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-[11px] text-red-600"
                                onClick={() => void updateDisposal.mutateAsync({ id: doc.id, disposalStatus: 'APPROVED_FOR_DISPOSAL' })}
                              >
                                <Trash2Icon className="h-3 w-3" />
                                Approve Disposal
                              </Button>
                            </>
                          )}
                          {doc.disposalStatus === 'APPROVED_FOR_DISPOSAL' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-[11px] text-red-600"
                              onClick={() => void updateDisposal.mutateAsync({ id: doc.id, disposalStatus: 'DISPOSED' })}
                            >
                              <Trash2Icon className="h-3 w-3" />
                              Confirm Disposed
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <CheckCircleIcon className="mx-auto mb-3 h-10 w-10 text-green-500/30" />
                    <p className="text-[13px] font-medium text-muted-foreground">
                      <Trans>No documents due for retention review</Trans>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      <Trans>All documents are within their retention period.</Trans>
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
