/**
 * Event-site wiring for Microsoft Teams.
 *
 * Mirrors `triggerWorkflowEvent`: fully non-fatal, never throws into the request
 * path that signed a document. The actual HTTP call happens in the
 * `internal.deliver-ms-teams` job.
 */
import { prisma } from '@documenso/prisma';

import { jobs } from '../../jobs/client';
import { WORKFLOW_EVENT_KEYS, type WorkflowEventKey } from '../../types/workflow';

const DELIVER_MS_TEAMS_JOB_NAME = 'internal.deliver-ms-teams';

const isWorkflowEvent = (event: string): event is WorkflowEventKey =>
  (WORKFLOW_EVENT_KEYS as readonly string[]).includes(event);

/**
 * Enqueue Teams delivery for an organization event.
 *
 * Checks for an enabled connection first: the overwhelming majority of orgs have
 * no Teams connection, and enqueuing a job for each of their document events
 * would fill BackgroundJob with rows that immediately no-op. The lookup is a
 * single hit on MsTeamsConnection's unique organizationId index.
 */
export const dispatchMsTeamsEvent = async ({
  event,
  organizationId,
  data,
}: {
  event: string;
  organizationId: number;
  data: Record<string, unknown>;
}): Promise<void> => {
  try {
    if (!isWorkflowEvent(event)) {
      return;
    }

    const connection = await prisma.msTeamsConnection.findUnique({
      where: { organizationId },
      select: { enabled: true },
    });

    if (!connection?.enabled) {
      return;
    }

    await jobs.triggerJob({
      name: DELIVER_MS_TEAMS_JOB_NAME,
      payload: { event, organizationId, data },
    });
  } catch (err) {
    console.error('[dispatchMsTeamsEvent] failed (non-fatal):', err);
  }
};
