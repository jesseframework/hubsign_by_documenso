import { z } from 'zod';

import { ZWorkflowEventKeySchema } from '../../../types/workflow';
import { type JobDefinition } from '../../client/_internal/job';

const DELIVER_MS_TEAMS_JOB_DEFINITION_ID = 'internal.deliver-ms-teams';

const DELIVER_MS_TEAMS_JOB_DEFINITION_SCHEMA = z.object({
  event: ZWorkflowEventKeySchema,
  organizationId: z.number().int().positive(),
  /** The raw event payload. Shape varies per event — see ms-teams/event-payload.ts. */
  data: z.unknown(),
});

export type TDeliverMsTeamsJobDefinition = z.infer<typeof DELIVER_MS_TEAMS_JOB_DEFINITION_SCHEMA>;

/**
 * Fan an organization event out to its Microsoft Teams channels.
 *
 * A job rather than an inline call so a slow or failing Teams endpoint never
 * blocks the request that signed a document, and so failures retry — the same
 * reasoning as `internal.execute-webhook`.
 */
export const DELIVER_MS_TEAMS_JOB_DEFINITION = {
  id: DELIVER_MS_TEAMS_JOB_DEFINITION_ID,
  name: 'Deliver Microsoft Teams Notification',
  version: '1.0.0',
  trigger: {
    name: DELIVER_MS_TEAMS_JOB_DEFINITION_ID,
    schema: DELIVER_MS_TEAMS_JOB_DEFINITION_SCHEMA,
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./deliver-ms-teams.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<
  typeof DELIVER_MS_TEAMS_JOB_DEFINITION_ID,
  TDeliverMsTeamsJobDefinition
>;
