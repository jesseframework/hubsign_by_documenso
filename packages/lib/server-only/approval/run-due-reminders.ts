/**
 * Approval reminder + escalation scanner.
 *
 * For each pending flow record whose step has reminders enabled, decides whether
 * a reminder is due based on hours-pending and how many have already been sent:
 *   stage 0 → First (firstReminderAfterHours)
 *   stage 1 → Second (secondReminderAfterHours)
 *   stage ≤2 → Escalation (escalationAfterHours; CCs escalationRecipients)
 *   stage ≥3 → Interval (reminderIntervalHours since last)
 *
 * One send per flow per run. Writes ApprovalReminderHistory for KPI tracking.
 * Driven by /api/cron/approval-reminders.
 */

import { ApprovalFlowStatus, ApprovalRequestStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { sendApprovalReminderEmail } from './approval-email';

const safe = async (fn: () => Promise<unknown>): Promise<boolean> => {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error('[approval reminders] non-fatal:', err);
    return false;
  }
};

const titleFor = async (entityType: string, entityId: string): Promise<string> => {
  if (entityType === 'Document') {
    const documentId = Number(entityId);
    if (!Number.isNaN(documentId)) {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: { title: true },
      });
      if (document) return document.title;
    }
  }
  return `${entityType} ${entityId}`;
};

export const runDueApprovalReminders = async (): Promise<{ scanned: number; sent: number }> => {
  const now = Date.now();

  const flows = await prisma.approvalFlowRecord.findMany({
    where: {
      status: {
        in: [
          ApprovalFlowStatus.PENDING,
          ApprovalFlowStatus.EMAIL_SENT,
          ApprovalFlowStatus.EMAIL_READ,
        ],
      },
      request: { status: ApprovalRequestStatus.IN_PROGRESS },
    },
    include: { request: { include: { template: { include: { steps: true } } } } },
    take: 500,
  });

  let sent = 0;

  for (const flow of flows) {
    const template = flow.request.template;
    const step = template?.steps.find((s) => s.stepNumber === flow.stepOrder);
    if (!step || !step.enableReminders) continue;

    const hoursPending = (now - flow.assignedAt.getTime()) / 3_600_000;
    const stage = flow.remindersSent;
    const hoursSinceLast = flow.lastReminderAt
      ? (now - flow.lastReminderAt.getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY;

    let reminderType: string | null = null;
    if (stage === 0 && step.firstReminderAfterHours != null && hoursPending >= step.firstReminderAfterHours) {
      reminderType = 'First';
    } else if (
      stage === 1 &&
      step.secondReminderAfterHours != null &&
      hoursPending >= step.secondReminderAfterHours
    ) {
      reminderType = 'Second';
    } else if (
      stage <= 2 &&
      step.escalationAfterHours != null &&
      hoursPending >= step.escalationAfterHours
    ) {
      reminderType = 'Escalation';
    } else if (
      stage >= 3 &&
      step.reminderIntervalHours != null &&
      hoursSinceLast >= step.reminderIntervalHours
    ) {
      reminderType = 'Interval';
    }

    if (!reminderType) continue;

    const entityTitle = await titleFor(flow.request.entityType, flow.request.entityId);
    const cc =
      reminderType === 'Escalation' && step.escalationRecipients
        ? step.escalationRecipients.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

    const ok = await safe(async () => {
      await sendApprovalReminderEmail({
        to: { name: flow.approverName, email: flow.approverEmail },
        entityTitle,
        requestId: flow.requestId,
        token: flow.token,
        stepName: flow.stepName,
        reminderType,
        ccEmails: cc,
      });
      await prisma.approvalFlowRecord.update({
        where: { id: flow.id },
        data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() },
      });
      await prisma.approvalReminderHistory.create({
        data: {
          requestId: flow.requestId,
          flowRecordId: flow.id,
          recipientEmail: flow.approverEmail,
          reminderType,
          entityType: flow.request.entityType,
          entityAmount: flow.request.amount,
        },
      });
    });

    if (ok) sent += 1;
  }

  return { scanned: flows.length, sent };
};
