import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ClockIcon, PlayIcon, PlusIcon, Trash2Icon, WorkflowIcon, ZapIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Workflows');
}

const triggerSummary = (wf: {
  triggerType: string;
  triggerEvent: string | null;
  cron: string | null;
}): string => {
  if (wf.triggerType === 'EVENT') return `Event · ${wf.triggerEvent ?? '—'}`;
  if (wf.triggerType === 'SCHEDULE') return `Schedule · ${wf.cron ?? '—'}`;
  return 'Manual';
};

export default function OrgWorkflowsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const { data: workflows, isLoading, error } = trpc.workflow.list.useQuery();

  const onError = (err: { message: string }) =>
    toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });

  const setEnabled = trpc.workflow.setEnabled.useMutation({
    onSuccess: () => void utils.workflow.list.invalidate(),
    onError,
  });

  const remove = trpc.workflow.delete.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      toast({ title: _(msg`Workflow deleted`) });
    },
    onError,
  });

  const run = trpc.workflow.run.useMutation({
    onSuccess: () => toast({ title: _(msg`Workflow run started`) }),
    onError,
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  if (error) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <WorkflowIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p>{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Workflows</Trans>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Automate actions when documents move through their lifecycle, on a schedule, or on
              demand.
            </Trans>
          </p>
        </div>
        <Button size="sm" onClick={() => navigate('/org/workflows/new')}>
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>New workflow</Trans>
        </Button>
      </div>

      {!workflows || workflows.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <WorkflowIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>No workflows yet</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
            <Trans>
              Create a workflow to react to events like "document completed", run on a cron schedule,
              or trigger manually.
            </Trans>
          </p>
          <Button size="sm" className="mt-4" onClick={() => navigate('/org/workflows/new')}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>New workflow</Trans>
          </Button>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Name</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Trigger</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Status</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Runs</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Actions</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr key={wf.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to={`/org/workflows/${wf.id}`}
                      className="text-[13px] font-medium hover:text-primary hover:underline"
                    >
                      {wf.name}
                    </Link>
                    {wf.description && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {wf.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      {wf.triggerType === 'SCHEDULE' ? (
                        <ClockIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ZapIcon className="h-3.5 w-3.5" />
                      )}
                      {triggerSummary(wf)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        void setEnabled.mutateAsync({ id: wf.id, enabled: !wf.enabled })
                      }
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                        wf.enabled
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {wf.enabled ? _(msg`Enabled`) : _(msg`Disabled`)}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    <Link to={`/org/workflows/${wf.id}/runs`} className="hover:text-primary hover:underline">
                      {wf._count.runs}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-[11px]"
                        disabled={run.isPending}
                        onClick={() => void run.mutateAsync({ id: wf.id })}
                      >
                        <PlayIcon className="h-3 w-3" />
                        <Trans>Run</Trans>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-[11px] text-destructive"
                        onClick={() => {
                          if (window.confirm(_(msg`Delete "${wf.name}"? This cannot be undone.`))) {
                            void remove.mutateAsync({ id: wf.id });
                          }
                        }}
                      >
                        <Trash2Icon className="h-3 w-3" />
                        <Trans>Delete</Trans>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
