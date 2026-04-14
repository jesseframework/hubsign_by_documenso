import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CheckCircleIcon, CheckSquareIcon, XCircleIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Pending Approvals');
}

export default function DmsApprovalsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: pendingSteps, isLoading } = trpc.dms.getMyPendingApprovals.useQuery();

  const respond = trpc.dms.respondToWorkflowStep.useMutation({
    onSuccess: (_, vars) => {
      void utils.dms.getMyPendingApprovals.invalidate();
      toast({ title: `Step ${vars.status.toLowerCase()}` });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Pending Approvals</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Documents waiting for your review and approval.</Trans>
        </p>
      </div>

      <div className="rounded-[var(--r)] border border-border bg-card">
        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">Loading...</div>
        ) : pendingSteps && pendingSteps.length > 0 ? (
          <div className="divide-y divide-border">
            {pendingSteps.map((step) => (
              <div key={step.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link to={`/dms/doc/${step.workflow.document.id}`} className="text-[14px] font-medium hover:underline">
                      {step.workflow.document.title}
                    </Link>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Workflow: {step.workflow.name} · Step {step.step} · Requested by {step.workflow.initiatedBy.name || step.workflow.initiatedBy.email}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {step.workflow.document.referenceNumber}
                    </p>
                    {step.dueDate && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        Due: {new Date(step.dueDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-[12px] text-green-600 hover:bg-green-50"
                      onClick={() => void respond.mutateAsync({ stepId: step.id, status: 'APPROVED' })}
                      disabled={respond.isPending}
                    >
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-[12px] text-red-600 hover:bg-red-50"
                      onClick={() => void respond.mutateAsync({ stepId: step.id, status: 'REJECTED' })}
                      disabled={respond.isPending}
                    >
                      <XCircleIcon className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckSquareIcon className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-[13px] font-medium"><Trans>No pending approvals</Trans></p>
            <p className="mt-1 text-[11px]"><Trans>You're all caught up!</Trans></p>
          </div>
        )}
      </div>
    </div>
  );
}
