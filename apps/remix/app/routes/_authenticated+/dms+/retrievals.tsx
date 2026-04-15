import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  CheckCircleIcon,
  ClipboardListIcon,
  PackageCheckIcon,
  RotateCcwIcon,
  XCircleIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Retrieval Requests');
}

export default function DmsRetrievalsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: requests, isLoading } = trpc.dms.getRetrievalRequests.useQuery();

  const updateRequest = trpc.dms.updateRetrievalRequest.useMutation({
    onSuccess: (_, vars) => {
      void utils.dms.getRetrievalRequests.invalidate();
      toast({ title: `Request ${vars.status.toLowerCase().replace(/_/g, ' ')}` });
    },
  });

  const statusColors: Record<string, string> = {
    PENDING: 'bg-status-pending-bg text-status-pending-text',
    APPROVED: 'bg-status-inbox-bg text-status-inbox-text',
    REJECTED: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
    RETRIEVED: 'bg-primary/10 text-primary',
    RETURNED: 'bg-status-complete-bg text-status-complete-text',
    OVERDUE: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  };

  const pendingCount = requests?.filter((r) => r.status === 'PENDING').length ?? 0;
  const activeCount = requests?.filter((r) => ['APPROVED', 'RETRIEVED'].includes(r.status)).length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Retrieval Requests</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Track requests for physical document retrieval from filing locations.</Trans>
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[var(--r)] border border-border bg-card p-3">
          <span className="text-[11px] font-semibold uppercase text-amber-600">Pending Approval</span>
          <p className="mt-1 text-xl font-semibold">{pendingCount}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-3">
          <span className="text-[11px] font-semibold uppercase text-primary">Active (Out)</span>
          <p className="mt-1 text-xl font-semibold">{activeCount}</p>
        </div>
      </div>

      <div className="rounded-[var(--r)] border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Document</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Requested By</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Reason</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Due Date</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="py-12 text-center text-[13px] text-muted-foreground">Loading...</td></tr>
            ) : requests && requests.length > 0 ? (
              requests.map((req) => (
                <tr key={req.id} className="border-b border-border last:border-0 hover:bg-[#faf9fe] dark:hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link to={`/dms/doc/${req.document.id}`} className="text-[13px] font-medium hover:underline">
                      {req.document.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {req.requestedBy.name || req.requestedBy.email}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {req.reason || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusColors[req.status] || 'bg-muted text-muted-foreground'}`}>
                      <span className="h-[5px] w-[5px] rounded-full bg-current opacity-80" />
                      {req.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {req.dueDate ? new Date(req.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {req.status === 'PENDING' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-[11px] text-green-600 hover:bg-green-50"
                            onClick={() => void updateRequest.mutateAsync({ id: req.id, status: 'APPROVED' })}
                          >
                            <CheckCircleIcon className="h-3 w-3" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-[11px] text-red-600 hover:bg-red-50"
                            onClick={() => void updateRequest.mutateAsync({ id: req.id, status: 'REJECTED' })}
                          >
                            <XCircleIcon className="h-3 w-3" />
                            Reject
                          </Button>
                        </>
                      )}
                      {req.status === 'APPROVED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-[11px] text-primary"
                          onClick={() => void updateRequest.mutateAsync({ id: req.id, status: 'RETRIEVED' })}
                        >
                          <PackageCheckIcon className="h-3 w-3" />
                          Mark Retrieved
                        </Button>
                      )}
                      {req.status === 'RETRIEVED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-[11px] text-green-600"
                          onClick={() => void updateRequest.mutateAsync({ id: req.id, status: 'RETURNED', returnDate: new Date().toISOString() })}
                        >
                          <RotateCcwIcon className="h-3 w-3" />
                          Mark Returned
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <ClipboardListIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-[13px] text-muted-foreground"><Trans>No retrieval requests yet</Trans></p>
                  <p className="mt-1 text-[11px] text-muted-foreground"><Trans>Requests are created from the document detail page for physical documents.</Trans></p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
