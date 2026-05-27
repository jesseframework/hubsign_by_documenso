/**
 * Token-driven approval actions (used by the anonymous /approve/<token> page) and
 * a read-only view builder for rendering that page.
 *
 * Tokens are single-use entropy (no auth); never log them in full.
 */

import { ApprovalFlowStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { processFlowDecision } from './approval-execution';

const ACTIONABLE: ApprovalFlowStatus[] = [
  ApprovalFlowStatus.PENDING,
  ApprovalFlowStatus.EMAIL_SENT,
  ApprovalFlowStatus.EMAIL_READ,
];

export type ApprovalFlowView = {
  flowId: string;
  requestId: string;
  status: ApprovalFlowStatus;
  actionable: boolean;
  entityTitle: string;
  stepName: string | null;
  approverName: string | null;
  decision: string | null;
  comments: string | null;
};

/** Build the view for the approve page; marks the email as read (best-effort). */
export const getApprovalFlowView = async (token: string): Promise<ApprovalFlowView | null> => {
  const flow = await prisma.approvalFlowRecord.findUnique({
    where: { token },
    include: { request: true },
  });

  if (!flow) return null;

  if (flow.status === ApprovalFlowStatus.EMAIL_SENT) {
    await prisma.approvalFlowRecord
      .update({ where: { id: flow.id }, data: { status: ApprovalFlowStatus.EMAIL_READ } })
      .catch(() => null);
  }

  let entityTitle = `${flow.request.entityType} ${flow.request.entityId}`;
  if (flow.request.entityType === 'Document') {
    const documentId = Number(flow.request.entityId);
    if (!Number.isNaN(documentId)) {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: { title: true },
      });
      if (document) entityTitle = document.title;
    }
  }

  return {
    flowId: flow.id,
    requestId: flow.requestId,
    status: flow.status,
    actionable: ACTIONABLE.includes(flow.status),
    entityTitle,
    stepName: flow.stepName,
    approverName: flow.approverName,
    decision: flow.decision,
    comments: flow.comments,
  };
};

/** Approve or reject by token. */
export const actOnApprovalByToken = async (
  token: string,
  approved: boolean,
  comments?: string | null,
) => {
  const flow = await prisma.approvalFlowRecord.findUnique({ where: { token } });
  if (!flow) return { ok: false as const, reason: 'not-found' as const };

  return processFlowDecision(flow.id, approved, comments);
};
