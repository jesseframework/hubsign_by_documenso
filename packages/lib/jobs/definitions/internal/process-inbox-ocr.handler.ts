import { runInboxOcr } from '../../../server-only/inbox/run-inbox-ocr';
import type { TProcessInboxOcrJobDefinition } from './process-inbox-ocr';

export const run = async ({ payload }: { payload: TProcessInboxOcrJobDefinition }) => {
  await runInboxOcr({ inboxItemId: payload.inboxItemId, templateId: payload.templateId });
};
