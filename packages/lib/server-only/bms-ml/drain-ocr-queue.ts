/**
 * Smart OCR (BMS ML) queue drain — re-attempts `OrgOcrUsage` rows that were
 * `QUEUED` because the org was over its page quota when they were ready to
 * process.
 *
 * Deliberately level-triggered ("is there room right now"), not
 * edge-triggered ("did the period just roll over") — a daily scan of every
 * org with queued items, each re-checked against its *current* quota. This
 * is what makes it correctly handle both monthly plans (room reappears at
 * the calendar-month boundary) and annual plans (room only reappears at the
 * pool's own `periodStart` anniversary, advanced only by a real Stripe
 * renewal) with one code path — no special-casing either cadence. It also
 * transparently covers a future page-block purchase: that flow can just
 * call this same function afterward.
 *
 * Driven by `/api/cron/ocr-queue-drain` — wire that to a cron service on a
 * daily cadence, same convention as `/api/cron/subscription-renewals`.
 */

import { getOrgOcrQuota } from '@documenso/ee/server-only/limits/ocr-quota';
import { prisma } from '@documenso/prisma';

import { runDmsOcr } from '../dms/run-dms-ocr';
import { runAttachmentOcr } from '../inbox/run-attachment-ocr';
import { runInboxOcr } from '../inbox/run-inbox-ocr';

export const drainOcrQueue = async (): Promise<{
  organizationsScanned: number;
  itemsDrained: number;
}> => {
  const queuedByOrg = await prisma.orgOcrUsage.groupBy({
    by: ['organizationId'],
    where: { status: 'QUEUED' },
  });

  let itemsDrained = 0;

  for (const { organizationId } of queuedByOrg) {
    const drainedForOrg = await drainOrgQueue(organizationId);
    itemsDrained += drainedForOrg;
  }

  return { organizationsScanned: queuedByOrg.length, itemsDrained };
};

const drainOrgQueue = async (organizationId: number): Promise<number> => {
  let drained = 0;

  // Re-fetch and re-check quota after every single item — a previous item
  // draining in this same pass changes how much room is left for the next
  // one; recomputing from OrgOcrUsage (the source of truth) rather than
  // decrementing a local counter avoids drifting from it.
  for (;;) {
    const next = await prisma.orgOcrUsage.findFirst({
      where: { organizationId, status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });

    if (!next) break;

    const { remaining } = await getOrgOcrQuota({ organizationId });

    if (Number.isFinite(remaining) && remaining < next.pageCount) {
      // Oldest queued item still doesn't fit — nothing else in this org's
      // queue will either (they're all competing for the same pool), so
      // stop rather than skip ahead and starve it further.
      break;
    }

    await drainOne(next);
    drained += 1;
  }

  return drained;
};

const drainOne = async (usage: {
  id: string;
  source: 'INBOX' | 'ATTACHMENT' | 'DMS';
  sourceId: string;
  organizationId: number;
}): Promise<void> => {
  switch (usage.source) {
    case 'INBOX':
      await runInboxOcr({ inboxItemId: usage.sourceId, existingUsageId: usage.id });
      return;

    case 'ATTACHMENT': {
      const file = await prisma.documentSupportingFile.findUnique({
        where: { id: usage.sourceId },
        select: { document: { select: { organizationId: true } } },
      });

      if (!file?.document.organizationId) return;

      await runAttachmentOcr({
        supportingFileId: usage.sourceId,
        organizationId: file.document.organizationId,
        existingUsageId: usage.id,
      });
      return;
    }

    case 'DMS': {
      const org = await prisma.organization.findUnique({ where: { id: usage.organizationId } });

      if (!org) return;

      await runDmsOcr({
        documentId: usage.sourceId,
        organizationId: usage.organizationId,
        orgConfig: {
          apiUrl: org.ocrApiUrl,
          apiKey: org.ocrApiKey,
          apiUsername: org.ocrApiUsername,
          apiPassword: org.ocrApiPassword,
          defaultTemplateId: org.ocrDefaultTemplateId,
          defaultEngine: org.ocrDefaultEngine,
        },
        existingUsageId: usage.id,
      });
      return;
    }
  }
};
