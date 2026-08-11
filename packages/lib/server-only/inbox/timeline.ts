import { prisma } from '@documenso/prisma';

import { slaClockStart } from './sla';

/**
 * One ordered history for an inbox document, merged from the four places its
 * life is actually recorded: the inbox item's own timestamps, the document
 * audit log, the reminder log, and the workflow runs.
 *
 * Events are returned structured rather than as prose. Wording belongs to the
 * client, where lingui can translate it; a server that returned finished
 * English sentences would be untranslatable and would also tempt callers into
 * parsing them.
 */

export const TIMELINE_KINDS = [
  'ARRIVED',
  'OCR_COMPLETED',
  'OPENED_IN_APP',
  'MAILBOX_MARKED_READ',
  'SENT_FOR_SIGNATURE',
  'SIGNING_REQUEST_EMAILED',
  'REMINDER_SENT',
  'RECIPIENT_OPENED',
  'RECIPIENT_SIGNED',
  'RECIPIENT_REJECTED',
  'COMPLETED',
  'COPY_EMAILED',
  'WORKFLOW_RUN',
  'FIELD_CORRECTED',
  'FIELD_FROM_ATTACHMENT',
  'ATTACHMENT_READ',
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = {
  id: string;
  at: Date;
  kind: TimelineKind;
  /** The person the event is about, where there is one. */
  actor: string | null;
  /**
   * Kind-specific qualifier the client turns into words:
   * ARRIVED        → 'mail-server' | 'ingest'
   * REMINDER_SENT   → 'AUTOMATIC' | 'MANUAL'
   * WORKFLOW_RUN    → the run status
   * FIELD_CORRECTED → the field name
   * ATTACHMENT_READ → 'ok' | 'failed'
   */
  detail: string | null;
  /** Free text that is already a proper noun — a workflow name, a reason. */
  note: string | null;
};

/** Cap on how far back the audit log is read for one document. */
const AUDIT_LIMIT = 200;

type AuditData = {
  emailType?: string;
  isResending?: boolean;
  recipientName?: string;
  recipientEmail?: string;
  reason?: string;
};

export const getInboxItemTimeline = async ({
  inboxItemId,
  organizationId,
}: {
  inboxItemId: string;
  organizationId: number;
}): Promise<TimelineEvent[]> => {
  const item = await prisma.signatureInboxItem.findFirst({
    where: { id: inboxItemId, organizationId },
    select: {
      id: true,
      documentId: true,
      createdAt: true,
      receivedAt: true,
      viewedAt: true,
      emailReadAt: true,
      ocrProcessed: true,
    },
  });

  if (!item) {
    return [];
  }

  const [auditLogs, reminders, runs, fieldEdits, attachments] = await Promise.all([
    prisma.documentAuditLog.findMany({
      where: { documentId: item.documentId },
      orderBy: { createdAt: 'asc' },
      take: AUDIT_LIMIT,
      select: { id: true, type: true, createdAt: true, name: true, email: true, data: true },
    }),
    prisma.recipientReminder.findMany({
      where: { documentId: item.documentId },
      orderBy: { sentAt: 'asc' },
      select: {
        id: true,
        sentAt: true,
        kind: true,
        recipient: { select: { name: true, email: true } },
        sentBy: { select: { name: true, email: true } },
      },
    }),
    prisma.workflowRun.findMany({
      where: {
        workflow: { organizationId },
        context: { path: ['payload', 'inboxItemId'], equals: inboxItemId },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, status: true, createdAt: true, workflow: { select: { name: true } } },
    }),
    prisma.inboxFieldEdit.findMany({
      where: { inboxItemId },
      orderBy: { editedAt: 'asc' },
      select: {
        id: true,
        field: true,
        previousValue: true,
        newValue: true,
        editedAt: true,
        source: true,
        sourceDetail: true,
        editedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.documentSupportingFile.findMany({
      where: { documentId: item.documentId, ocrRanAt: { not: null } },
      orderBy: { ocrRanAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        ocrRanAt: true,
        ocrError: true,
        ocrRanBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  const events: TimelineEvent[] = [];

  // ---- The inbox item's own life ------------------------------------------
  events.push({
    id: `${item.id}-arrived`,
    at: slaClockStart(item),
    kind: 'ARRIVED',
    actor: null,
    // Whether this is the real mail-server time or the moment we polled is the
    // difference between an accurate history and a plausible one, so the
    // timeline states which it is rather than presenting both alike.
    detail: item.receivedAt ? 'mail-server' : 'ingest',
    note: null,
  });

  // OCR has no completion timestamp of its own, so it is inferred from the run
  // that the completion triggered. No run, no event — better a gap than a
  // guessed time.
  const ocrRun = runs.at(0);
  if (item.ocrProcessed && ocrRun) {
    events.push({
      id: `${item.id}-ocr`,
      at: ocrRun.createdAt,
      kind: 'OCR_COMPLETED',
      actor: null,
      detail: null,
      note: null,
    });
  }

  if (item.viewedAt) {
    events.push({
      id: `${item.id}-viewed`,
      at: item.viewedAt,
      kind: 'OPENED_IN_APP',
      actor: null,
      detail: null,
      note: null,
    });
  }

  if (item.emailReadAt) {
    events.push({
      id: `${item.id}-mailread`,
      at: item.emailReadAt,
      kind: 'MAILBOX_MARKED_READ',
      actor: null,
      detail: null,
      note: null,
    });
  }

  // ---- The document audit log ---------------------------------------------
  for (const log of auditLogs) {
    const data = (log.data ?? {}) as AuditData;
    const who = data.recipientName || data.recipientEmail || log.name || log.email || null;

    switch (log.type) {
      case 'DOCUMENT_SENT':
        events.push({ id: log.id, at: log.createdAt, kind: 'SENT_FOR_SIGNATURE', actor: log.name ?? null, detail: null, note: null });
        break;

      case 'EMAIL_SENT': {
        // A manual resend writes here AND to the reminder log. Taking it from
        // both would show every hand-sent nudge twice.
        if (data.isResending) break;

        events.push({
          id: log.id,
          at: log.createdAt,
          kind: data.emailType === 'DOCUMENT_COMPLETED' ? 'COPY_EMAILED' : 'SIGNING_REQUEST_EMAILED',
          actor: who,
          detail: data.emailType ?? null,
          note: null,
        });
        break;
      }

      case 'DOCUMENT_OPENED':
        events.push({ id: log.id, at: log.createdAt, kind: 'RECIPIENT_OPENED', actor: who, detail: null, note: null });
        break;

      case 'DOCUMENT_RECIPIENT_COMPLETED':
        events.push({ id: log.id, at: log.createdAt, kind: 'RECIPIENT_SIGNED', actor: who, detail: null, note: null });
        break;

      case 'DOCUMENT_RECIPIENT_REJECTED':
        events.push({
          id: log.id,
          at: log.createdAt,
          kind: 'RECIPIENT_REJECTED',
          actor: who,
          detail: null,
          note: data.reason ?? null,
        });
        break;

      case 'DOCUMENT_COMPLETED':
        events.push({ id: log.id, at: log.createdAt, kind: 'COMPLETED', actor: null, detail: null, note: null });
        break;

      // FIELD_CREATED, RECIPIENT_CREATED and DOCUMENT_FIELD_INSERTED are
      // preparation mechanics. They belong in the audit certificate, not in a
      // history someone reads to find out where an invoice got stuck.
      default:
        break;
    }
  }

  // ---- Reminders ----------------------------------------------------------
  for (const reminder of reminders) {
    events.push({
      id: reminder.id,
      at: reminder.sentAt,
      kind: 'REMINDER_SENT',
      actor: reminder.recipient?.name || reminder.recipient?.email || null,
      detail: reminder.kind,
      note: reminder.sentBy?.name || reminder.sentBy?.email || null,
    });
  }

  // ---- Human corrections --------------------------------------------------
  for (const edit of fieldEdits) {
    events.push({
      id: edit.id,
      at: edit.editedAt,
      kind: edit.source === 'ATTACHMENT_OCR' ? 'FIELD_FROM_ATTACHMENT' : 'FIELD_CORRECTED',
      actor: edit.editedBy?.name || edit.editedBy?.email || edit.sourceDetail || null,
      detail: edit.field,
      // Both sides, so the trail shows what the extractor had read as well as
      // what it was changed to.
      note:
        edit.previousValue === null
          ? (edit.newValue ?? null)
          : `${edit.previousValue} → ${edit.newValue ?? '(cleared)'}`,
    });
  }

  // ---- Attachment OCR -----------------------------------------------------
  for (const attachment of attachments) {
    if (!attachment.ocrRanAt) continue;

    events.push({
      id: `${attachment.id}-ocr`,
      at: attachment.ocrRanAt,
      kind: 'ATTACHMENT_READ',
      actor: attachment.ocrRanBy?.name || attachment.ocrRanBy?.email || null,
      detail: attachment.ocrError ? 'failed' : 'ok',
      note: attachment.fileName,
    });
  }

  // ---- Workflow runs ------------------------------------------------------
  for (const run of runs) {
    events.push({
      id: run.id,
      at: run.createdAt,
      kind: 'WORKFLOW_RUN',
      actor: null,
      detail: run.status,
      note: run.workflow?.name ?? null,
    });
  }

  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
};
