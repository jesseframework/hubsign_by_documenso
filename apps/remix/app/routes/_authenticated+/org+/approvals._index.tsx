import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CheckCircle2Icon, ClipboardCheckIcon, InboxIcon, XCircleIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { RuleOverrideQueue } from '~/components/general/rules/rule-override-queue';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Approvals');
}

const statusColor = (status: string): string => {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'REJECTED':
      return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'CANCELLED':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  }
};

export default function ApprovalsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const pending = trpc.approval.myPendingApprovals.useQuery();
  const requests = trpc.approval.listRequests.useQuery({ limit: 50 });

  const act = trpc.approval.act.useMutation({
    onSuccess: (r) => {
      void utils.approval.myPendingApprovals.invalidate();
      void utils.approval.listRequests.invalidate();
      if ('ok' in r && r.ok) {
        toast({ title: r.decision === 'approved' ? _(msg`Approved`) : _(msg`Rejected`) });
      } else {
        toast({ title: _(msg`Already actioned`) });
      }
    },
    onError: (err) =>
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
  });

  const reject = (flowRecordId: string) => {
    const comments = window.prompt(_(msg`Reason for rejection (optional):`)) ?? undefined;
    void act.mutateAsync({ flowRecordId, approved: false, comments });
  };

  return (
    <div className="space-y-6">
      <div>
        <RuleOverrideQueue assignedToMe />

      <h2 className="text-lg font-semibold">
          <Trans>Approvals</Trans>
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Review items waiting on you and track every approval request.</Trans>
        </p>
      </div>

      {/* My pending approvals */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
          <InboxIcon className="h-4 w-4" />
          <Trans>Waiting on you</Trans>
          {pending.data && pending.data.length > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-[11px] text-primary">
              {pending.data.length}
            </span>
          )}
        </h3>

        {!pending.data || pending.data.length === 0 ? (
          <p className="rounded-[var(--r)] border border-dashed border-border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
            <Trans>Nothing waiting on you right now.</Trans>
          </p>
        ) : (
          <div className="space-y-2">
            {pending.data.map((p) => (
              <div
                key={p.flowId}
                className="flex items-center justify-between gap-3 rounded-[var(--r)] border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    to={`/org/approvals/${p.requestId}`}
                    className="text-[13px] font-medium hover:text-primary hover:underline"
                  >
                    {p.entityTitle}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    {p.stepName ? `${p.stepName} · ` : ''}
                    {new Date(p.assignedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={act.isPending}
                    onClick={() => void act.mutateAsync({ flowRecordId: p.flowId, approved: true })}
                  >
                    <CheckCircle2Icon className="mr-1 h-3.5 w-3.5" />
                    <Trans>Approve</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] text-destructive"
                    disabled={act.isPending}
                    onClick={() => reject(p.flowId)}
                  >
                    <XCircleIcon className="mr-1 h-3.5 w-3.5" />
                    <Trans>Reject</Trans>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* All requests */}
      <section>
        <h3 className="mb-2 text-[13px] font-semibold">
          <Trans>All requests</Trans>
        </h3>
        {!requests.data || requests.data.length === 0 ? (
          <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-12 text-center">
            <ClipboardCheckIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-[13px] text-muted-foreground">
              <Trans>No approval requests yet.</Trans>
            </p>
          </div>
        ) : (
          <div className="rounded-[var(--r)] border border-border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    <Trans>Item</Trans>
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    <Trans>Template</Trans>
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    <Trans>Status</Trans>
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    <Trans>Created</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.data.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        to={`/org/approvals/${r.id}`}
                        className="text-[13px] font-medium hover:text-primary hover:underline"
                      >
                        {r.entityType} {r.entityId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {r.template?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusColor(r.status)}`}
                      >
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
