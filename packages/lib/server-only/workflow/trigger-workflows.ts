/**
 * Workflow trigger dispatch.
 *
 * `triggerWorkflows` finds enabled EVENT-triggered workflows for an organization,
 * applies each one's optional JSONLogic trigger gate, creates a WorkflowRun and
 * enqueues the execute-workflow job. `triggerWorkflowEvent` is the wiring helper
 * called from event sites (it mirrors `triggerWebhook`'s signature, resolves the
 * org, and is fully non-fatal). `enqueueWorkflowRun` is the shared low-level path
 * used by event, manual and scheduled triggers.
 */

import { prisma } from '@documenso/prisma';

import { jobs } from '../../jobs/client';
import type { TWorkflowRunContext } from '../../types/workflow';
import { WORKFLOW_EVENT_KEYS, ZWorkflowDefinitionSchema } from '../../types/workflow';
import { dispatchMsTeamsEvent } from '../ms-teams/dispatch';
import { evaluateCondition } from './logic';
import { resolveOrganizationId } from './resolve-organization-id';

const EXECUTE_WORKFLOW_JOB_NAME = 'internal.execute-workflow';

const isWorkflowEvent = (event: string): boolean =>
  (WORKFLOW_EVENT_KEYS as readonly string[]).includes(event);

/**
 * Create a PENDING run and enqueue it for execution. Returns the run id.
 */
export const enqueueWorkflowRun = async ({
  workflowId,
  trigger,
  context,
}: {
  workflowId: string;
  trigger: string;
  context: TWorkflowRunContext;
}): Promise<string> => {
  const run = await prisma.workflowRun.create({
    data: {
      workflowId,
      trigger,
      status: 'PENDING',
      context: context as PrismaJson.WorkflowRunContext,
    },
  });

  await jobs.triggerJob({
    name: EXECUTE_WORKFLOW_JOB_NAME,
    payload: { runId: run.id },
  });

  return run.id;
};

/**
 * Dispatch all matching EVENT workflows for an organization, and fan the event
 * out to any other org-scoped subscribers.
 *
 * Despite the name, this is the organization event bus: every dispatch site
 * (eSign via `triggerWorkflowEvent`, the two DMS sites, the two inbox sites)
 * funnels through here, so subscribers other than the workflow engine hook in at
 * this one point rather than at five.
 */
export const triggerWorkflows = async ({
  event,
  organizationId,
  data,
}: {
  event: string;
  organizationId: number;
  data: Record<string, unknown>;
}): Promise<void> => {
  // MUST stay above the early return below: an organization can have Teams
  // channels and zero workflows, and its notifications would silently never fire.
  // Non-fatal by contract — dispatchMsTeamsEvent swallows its own errors.
  await dispatchMsTeamsEvent({ event, organizationId, data });

  const workflows = await prisma.workflow.findMany({
    where: {
      organizationId,
      enabled: true,
      triggerType: 'EVENT',
      triggerEvent: event,
    },
  });

  if (workflows.length === 0) {
    return;
  }

  const now = new Date().toISOString();

  // Email templates routinely sign off with `{{organization.name}}`; without it
  // the placeholder renders empty and the mail goes out reading "Sent
  // automatically by ." Fetched once per dispatch, and only after the
  // no-workflows early return above.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });

  for (const workflow of workflows) {
    const parsed = ZWorkflowDefinitionSchema.safeParse(workflow.definition);

    if (!parsed.success) {
      // Skip invalid definitions rather than throwing inside an event path.
      continue;
    }

    const context: TWorkflowRunContext = {
      event,
      trigger: parsed.data.trigger,
      payload: data,
      document: data,
      organization: organization ?? { id: organizationId },
      now,
    };

    const gate = parsed.data.trigger.type === 'EVENT' ? parsed.data.trigger.condition : undefined;
    if (!evaluateCondition(gate, context)) {
      continue;
    }

    await enqueueWorkflowRun({ workflowId: workflow.id, trigger: event, context });
  }
};

/**
 * Event-site wiring helper. Resolves the organization from the document's
 * team/owner and dispatches matching workflows. Non-fatal: never throws into the
 * caller's request path.
 */
export const triggerWorkflowEvent = async ({
  event,
  data,
  userId,
  teamId,
}: {
  event: string;
  data: Record<string, unknown>;
  userId?: number | null;
  teamId?: number | null;
}): Promise<void> => {
  try {
    if (!isWorkflowEvent(event)) {
      return;
    }

    const organizationId = await resolveOrganizationId({ teamId, userId });
    if (!organizationId) {
      return;
    }

    await triggerWorkflows({ event, organizationId, data });
  } catch (err) {
    console.error('[triggerWorkflowEvent] failed (non-fatal):', err);
  }
};
