import { z } from 'zod';

import { type JobDefinition } from '../../client/_internal/job';

const EXECUTE_WORKFLOW_JOB_DEFINITION_ID = 'internal.execute-workflow';

const EXECUTE_WORKFLOW_JOB_DEFINITION_SCHEMA = z.object({
  runId: z.string(),
});

export type TExecuteWorkflowJobDefinition = z.infer<typeof EXECUTE_WORKFLOW_JOB_DEFINITION_SCHEMA>;

export const EXECUTE_WORKFLOW_JOB_DEFINITION = {
  id: EXECUTE_WORKFLOW_JOB_DEFINITION_ID,
  name: 'Execute Workflow',
  version: '1.0.0',
  trigger: {
    name: EXECUTE_WORKFLOW_JOB_DEFINITION_ID,
    schema: EXECUTE_WORKFLOW_JOB_DEFINITION_SCHEMA,
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./execute-workflow.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<
  typeof EXECUTE_WORKFLOW_JOB_DEFINITION_ID,
  TExecuteWorkflowJobDefinition
>;
