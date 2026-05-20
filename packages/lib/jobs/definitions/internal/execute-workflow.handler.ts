import { executeWorkflowRun } from '../../../server-only/workflow/run-workflow';
import type { JobRunIO } from '../../client/_internal/job';
import type { TExecuteWorkflowJobDefinition } from './execute-workflow';

export const run = async ({
  payload,
  io,
}: {
  payload: TExecuteWorkflowJobDefinition;
  io: JobRunIO;
}) => {
  await executeWorkflowRun({ runId: payload.runId, io });
};
