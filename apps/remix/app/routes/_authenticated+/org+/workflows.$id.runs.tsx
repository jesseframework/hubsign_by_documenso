import { Fragment, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Workflow Runs');
}

const statusColor = (status: string): string => {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'FAILED':
      return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'RUNNING':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'CANCELLED':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  }
};

const fmt = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString() : '—';

function RunDetail({ runId }: { runId: string }) {
  const { data: run, isLoading } = trpc.workflow.getRun.useQuery({ runId });

  if (isLoading) {
    return <div className="px-4 py-3 text-[12px] text-muted-foreground">Loading…</div>;
  }
  if (!run) return null;

  return (
    <div className="space-y-2 bg-muted/30 px-4 py-3">
      {run.error && (
        <p className="rounded-md bg-red-50 px-2 py-1 text-[12px] text-red-700 dark:bg-red-950 dark:text-red-300">
          {run.error}
        </p>
      )}
      {run.steps.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          <Trans>No steps recorded.</Trans>
        </p>
      ) : (
        <ol className="space-y-1.5">
          {run.steps.map((step) => (
            <li
              key={step.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              <span
                className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(step.status)}`}
              >
                {step.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium">
                  {step.stepId} <span className="text-muted-foreground">· {step.type}</span>
                </p>
                {step.error && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">{step.error}</p>
                )}
                {step.output ? (
                  <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(step.output, null, 2)}
                  </pre>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function WorkflowRunsPage() {
  const params = useParams();
  const id = params.id ?? '';
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const { data: workflow } = trpc.workflow.get.useQuery({ id }, { enabled: !!id });
  const { data: runs, isLoading } = trpc.workflow.listRuns.useQuery(
    { workflowId: id },
    { enabled: !!id },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/org/workflows" className="text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="h-4 w-4" />
        </Link>
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Run history</Trans>
          </h2>
          {workflow && <p className="text-[12px] text-muted-foreground">{workflow.name}</p>}
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !runs || runs.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-12 text-center text-[13px] text-muted-foreground">
          <Trans>No runs yet.</Trans>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="w-8 px-2 py-2.5" />
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Status</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Trigger</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Started</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Finished</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const open = openRunId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                      onClick={() => setOpenRunId(open ? null : r.id)}
                    >
                      <td className="px-2 py-3 text-muted-foreground">
                        {open ? (
                          <ChevronDownIcon className="h-4 w-4" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusColor(r.status)}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{r.trigger}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {fmt(r.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {fmt(r.finishedAt)}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <RunDetail runId={r.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
