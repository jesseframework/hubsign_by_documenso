import { Trans } from '@lingui/react/macro';
import { ClipboardListIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Retrieval Requests');
}

export default function DmsRetrievalsPage() {
  const { data: requests, isLoading } = trpc.dms.getRetrievalRequests.useQuery();

  const statusColors: Record<string, string> = {
    PENDING: 'bg-status-pending-bg text-status-pending-text',
    APPROVED: 'bg-status-inbox-bg text-status-inbox-text',
    REJECTED: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
    RETRIEVED: 'bg-primary/10 text-primary',
    RETURNED: 'bg-status-complete-bg text-status-complete-text',
    OVERDUE: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        <Trans>Retrieval Requests</Trans>
      </h2>

      <div className="rounded-[var(--r)] border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Document
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Requested By
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Due Date
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Requested
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-[13px] text-muted-foreground">
                  <Trans>Loading...</Trans>
                </td>
              </tr>
            ) : requests && requests.length > 0 ? (
              requests.map((req) => (
                <tr
                  key={req.id}
                  className="border-b border-border last:border-0 hover:bg-[#faf9fe] dark:hover:bg-muted/30"
                >
                  <td className="px-4 py-3 text-[13px] font-medium">{req.document.title}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {req.requestedBy.name || req.requestedBy.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        statusColors[req.status] || 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <span className="h-[5px] w-[5px] rounded-full bg-current opacity-80" />
                      {req.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {req.dueDate ? new Date(req.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <ClipboardListIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-[13px] text-muted-foreground">
                    <Trans>No retrieval requests yet</Trans>
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
