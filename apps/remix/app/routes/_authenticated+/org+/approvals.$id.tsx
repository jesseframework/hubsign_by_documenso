import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Approval Request');
}

const reqColor = (s: string) =>
  s === 'APPROVED'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : s === 'REJECTED'
      ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
      : s === 'IN_PROGRESS'
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
        : s === 'CANCELLED'
          ? 'bg-muted text-muted-foreground'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';

const flowColor = (s: string) =>
  s === 'APPROVED'
    ? 'text-emerald-600 dark:text-emerald-400'
    : s === 'REJECTED'
      ? 'text-red-600 dark:text-red-400'
      : 'text-muted-foreground';

export default function ApprovalRequestPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const id = params.id ?? '';
  const utils = trpc.useUtils();

  const { data: request, isLoading, error } = trpc.approval.getRequest.useQuery({ id }, { enabled: !!id });

  const invalidate = () => {
    void utils.approval.getRequest.invalidate({ id });
    void utils.approval.listRequests.invalidate();
    void utils.approval.myPendingApprovals.invalidate();
  };

  const act = trpc.approval.act.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: _(msg`Decision recorded`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  const cancel = trpc.approval.cancelRequest.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: _(msg`Request cancelled`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (error || !request) {
    return (
      <div className="py-12 text-center text-muted-foreground">{error?.message ?? 'Not found'}</div>
    );
  }

  const isActive = request.status === 'PENDING' || request.status === 'IN_PROGRESS';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/org/approvals" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-lg font-semibold">{request.entityTitle}</h2>
            <p className="text-[12px] text-muted-foreground">
              {request.template?.name ?? '—'} · {request.entityType} {request.entityId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${reqColor(request.status)}`}
          >
            {request.status.replace(/_/g, ' ')}
          </span>
          {isActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-destructive"
              onClick={() => cancel.mutate({ id })}
            >
              <Trans>Cancel</Trans>
            </Button>
          )}
        </div>
      </div>

      {request.error && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {request.error}
        </p>
      )}

      {/* Flow timeline */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          <Trans>Approval steps</Trans>
        </div>
        <ul>
          {request.flows.map((f) => {
            const actionable =
              f.status === 'PENDING' || f.status === 'EMAIL_SENT' || f.status === 'EMAIL_READ';
            return (
              <li
                key={f.id}
                className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {f.stepName ?? `Step ${f.stepOrder}`}
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {f.isParallel ? 'parallel' : 'sequential'}
                    </span>
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {f.approverName || f.approverEmail}{' '}
                    <span className={`font-medium ${flowColor(f.status)}`}>
                      · {f.status.replace(/_/g, ' ')}
                    </span>
                  </p>
                  {f.comments && (
                    <p className="mt-0.5 text-[11px] italic text-muted-foreground">“{f.comments}”</p>
                  )}
                </div>

                {actionable && isActive && (
                  <div className="flex flex-shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ flowRecordId: f.id, approved: true })}
                    >
                      <CheckCircle2Icon className="mr-1 h-3.5 w-3.5" />
                      <Trans>Approve</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] text-destructive"
                      disabled={act.isPending}
                      onClick={() => {
                        const comments = window.prompt(_(msg`Reason (optional):`)) ?? undefined;
                        act.mutate({ flowRecordId: f.id, approved: false, comments });
                      }}
                    >
                      <XCircleIcon className="mr-1 h-3.5 w-3.5" />
                      <Trans>Reject</Trans>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
