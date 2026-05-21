import { z } from 'zod';

import { type JobDefinition } from '../../client/_internal/job';

const PROCESS_INBOX_OCR_JOB_DEFINITION_ID = 'internal.process-inbox-ocr';

const PROCESS_INBOX_OCR_JOB_DEFINITION_SCHEMA = z.object({
  inboxItemId: z.string(),
});

export type TProcessInboxOcrJobDefinition = z.infer<
  typeof PROCESS_INBOX_OCR_JOB_DEFINITION_SCHEMA
>;

export const PROCESS_INBOX_OCR_JOB_DEFINITION = {
  id: PROCESS_INBOX_OCR_JOB_DEFINITION_ID,
  name: 'Process Signature Inbox OCR',
  version: '1.0.0',
  trigger: {
    name: PROCESS_INBOX_OCR_JOB_DEFINITION_ID,
    schema: PROCESS_INBOX_OCR_JOB_DEFINITION_SCHEMA,
  },
  handler: async ({ payload }) => {
    const handler = await import('./process-inbox-ocr.handler');
    await handler.run({ payload });
  },
} as const satisfies JobDefinition<
  typeof PROCESS_INBOX_OCR_JOB_DEFINITION_ID,
  TProcessInboxOcrJobDefinition
>;
