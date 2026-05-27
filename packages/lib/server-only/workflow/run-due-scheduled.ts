/**
 * Scheduled-workflow scanner.
 *
 * `runDueScheduledWorkflows` finds enabled SCHEDULE workflows whose `nextRunAt`
 * has passed, enqueues a run for each (subject to its optional JSONLogic gate),
 * and advances `nextRunAt` to the next cron occurrence. It is driven by the
 * `/api/cron/workflows` endpoint — wire that to your cron service on a 1-minute
 * cadence.
 */

import { prisma } from '@documenso/prisma';

import type { TWorkflowRunContext } from '../../types/workflow';
import { ZWorkflowDefinitionSchema } from '../../types/workflow';
import { getNextCronRun } from './cron';
import { evaluateCondition } from './logic';
import { enqueueWorkflowRun } from './trigger-workflows';

/** Compute the next fire time for a schedule, or null if the cron is invalid. */
export const computeNextRunAt = (
  cron: string | null | undefined,
  timezone: string | null | undefined,
  from: Date = new Date(),
): Date | null => {
  if (!cron) return null;
  try {
    return getNextCronRun(cron, from, timezone || 'UTC');
  } catch {
    return null;
  }
};

export const runDueScheduledWorkflows = async (): Promise<{
  scanned: number;
  triggered: number;
}> => {
  const now = new Date();

  const due = await prisma.workflow.findMany({
    where: {
      enabled: true,
      triggerType: 'SCHEDULE',
      cron: { not: null },
      nextRunAt: { not: null, lte: now },
    },
  });

  let triggered = 0;

  for (const workflow of due) {
    // Advance the schedule first so a slow/failed run can't cause a tight loop.
    const next = computeNextRunAt(workflow.cron, workflow.timezone, now);
    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { nextRunAt: next },
    });

    const parsed = ZWorkflowDefinitionSchema.safeParse(workflow.definition);
    if (!parsed.success) {
      continue;
    }

    const context: TWorkflowRunContext = {
      event: 'SCHEDULE',
      trigger: parsed.data.trigger,
      organization: { id: workflow.organizationId },
      scheduledAt: now.toISOString(),
      now: now.toISOString(),
    };

    const gate = parsed.data.trigger.type === 'SCHEDULE' ? parsed.data.trigger.condition : undefined;
    if (!evaluateCondition(gate, context)) {
      continue;
    }

    await enqueueWorkflowRun({ workflowId: workflow.id, trigger: 'SCHEDULE', context });
    triggered += 1;
  }

  return { scanned: due.length, triggered };
};
