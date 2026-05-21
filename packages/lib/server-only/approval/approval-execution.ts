/**
 * Approval chain orchestrator — the single entry point for running approvals.
 *
 * Pipeline (startApprovalRequest):
 *   1. Duplicate guard (one active request per entity).
 *   2. Build context + pick a template (find-template precedence).
 *   3. Create the ApprovalRequest and execute step 1.
 *
 * Per step (executeStep): run validations (severity gating), resolve approvers,
 * create flow records, email them (parallel = all now, sequential = one at a time).
 *
 * On action (processFlowDecision): record the decision; on full step approval
 * advance to the next step (or finalize + chain); on rejection stop + notify +
 * optional rejection template.
 *
 * Functions are declared (hoisted) so mutual recursion (chaining) is fine.
 */

import { ApprovalFlowStatus, ApprovalRequestStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { nanoid } from '../../universal/id';
import { sendApprovalOutcomeEmail, sendApprovalRequestEmail } from './approval-email';
import { resolveApprovers } from './approver-resolver';
import { buildApprovalContext } from './build-context';
import { evaluateRuleSet, findApprovalTemplate } from './find-template';
import { runStepValidations } from './validation-evaluator';

const ACTIVE: ApprovalRequestStatus[] = [
  ApprovalRequestStatus.PENDING,
  ApprovalRequestStatus.IN_PROGRESS,
];
const ACTIONABLE: ApprovalFlowStatus[] = [
  ApprovalFlowStatus.PENDING,
  ApprovalFlowStatus.EMAIL_SENT,
  ApprovalFlowStatus.EMAIL_READ,
];
const MAX_CHAIN_DEPTH = 10;

const safe = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    console.error(`[approval] ${label} (non-fatal):`, err);
  }
};

const newToken = () => `${nanoid()}${nanoid()}`;

// ─── Public: start ────────────────────────────────────────────────────────────

export type StartApprovalInput = {
  organizationId: number;
  entityType: string;
  entityId: string;
  requesterUserId?: number | null;
  specificTemplateId?: string | null;
  cancelExisting?: boolean;
  amount?: number | null;
  priority?: string | null;
  documentFileId?: string | null;
  throwIfNoTemplate?: boolean;
};

export type StartApprovalResult =
  | { skipped: true; reason: string }
  | { requestId: string; status: ApprovalRequestStatus };

export async function startApprovalRequest(
  input: StartApprovalInput,
  _depth = 0,
): Promise<StartApprovalResult> {
  const { organizationId, entityType, entityId } = input;

  const existing = await prisma.approvalRequest.findFirst({
    where: { organizationId, entityType, entityId, status: { in: ACTIVE } },
  });

  if (existing) {
    if (!input.cancelExisting) {
      throw new AppError('ALREADY_EXISTS', {
        message: 'An approval request is already in progress for this item.',
      });
    }
    await prisma.approvalRequest.update({
      where: { id: existing.id },
      data: { status: ApprovalRequestStatus.CANCELLED, completedAt: new Date() },
    });
  }

  const built = await buildApprovalContext({ organizationId, entityType, entityId });

  const template = await findApprovalTemplate({
    organizationId,
    entityType,
    context: built.context,
    specificTemplateId: input.specificTemplateId,
    entityStatus: built.entityStatus,
  });

  if (!template) {
    if (input.throwIfNoTemplate) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: 'No matching approval template for this item.',
      });
    }
    return { skipped: true, reason: 'no-template' };
  }

  const request = await prisma.approvalRequest.create({
    data: {
      organizationId,
      templateId: template.id,
      entityType,
      entityId,
      status: ApprovalRequestStatus.PENDING,
      requestedById: input.requesterUserId ?? built.ownerUserId ?? null,
      amount: input.amount ?? null,
      priority: input.priority ?? null,
      documentFileId: input.documentFileId ?? null,
      currentStep: 1,
      startedAt: new Date(),
    },
  });

  const status = await executeStep(request.id, 1, _depth);
  return { requestId: request.id, status };
}

// ─── Internal: execute a step ────────────────────────────────────────────────

async function executeStep(
  requestId: string,
  stepNumber: number,
  depth = 0,
): Promise<ApprovalRequestStatus> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { template: { include: { steps: { orderBy: { stepNumber: 'asc' } } } } },
  });

  if (!request || !request.template) {
    return request?.status ?? ApprovalRequestStatus.CANCELLED;
  }

  const step = request.template.steps.find((s) => s.stepNumber === stepNumber);
  if (!step) {
    return finalizeApproved(requestId, depth);
  }

  const built = await buildApprovalContext({
    organizationId: request.organizationId,
    entityType: request.entityType,
    entityId: request.entityId,
  });

  // Validations (severity gating).
  const validation = await runStepValidations(step.id, built.context);
  if (!validation.isValid) {
    const message = `Validation Failed (${validation.blockedBySeverity}): ${validation.errors
      .map((e) => e.message)
      .join('; ')}`;
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: ApprovalRequestStatus.PENDING, currentStep: stepNumber, error: message },
    });
    return ApprovalRequestStatus.PENDING;
  }

  const approvers = await resolveApprovers({
    organizationId: request.organizationId,
    determination: step.determination,
    approverRole: step.approverRole,
    fixedUserId: step.fixedUserId,
    roleMappingKey: step.roleMappingKey,
    department: step.department,
    requesterUserId: request.requestedById,
  });

  if (approvers.length === 0) {
    if (step.isOptional) {
      return executeStep(requestId, stepNumber + 1, depth);
    }
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: ApprovalRequestStatus.PENDING,
        currentStep: stepNumber,
        error: `No approver could be resolved for step "${step.name}".`,
      },
    });
    return ApprovalRequestStatus.PENDING;
  }

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: ApprovalRequestStatus.IN_PROGRESS, currentStep: stepNumber, error: null },
  });

  // Sequential steps notify one approver at a time; parallel notify everyone.
  for (let i = 0; i < approvers.length; i += 1) {
    const approver = approvers[i];
    const notifyNow = step.isParallel || i === 0;

    const flow = await prisma.approvalFlowRecord.create({
      data: {
        requestId,
        stepOrder: stepNumber,
        stepName: step.name,
        approverId: approver.id,
        approverName: approver.name,
        approverEmail: approver.email,
        approverRole: approver.role ?? null,
        isParallel: step.isParallel,
        isOptional: step.isOptional,
        status: ApprovalFlowStatus.PENDING,
        token: newToken(),
      },
    });

    if (notifyNow) {
      await emailFlowRecord(flow.id, requestId, built.entityTitle, built.ownerName, step.name);
    }
  }

  return ApprovalRequestStatus.IN_PROGRESS;
}

async function emailFlowRecord(
  flowRecordId: string,
  requestId: string,
  entityTitle: string,
  requesterName: string | null | undefined,
  stepName: string,
): Promise<void> {
  const flow = await prisma.approvalFlowRecord.findUnique({ where: { id: flowRecordId } });
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!flow || !request) return;

  await safe('send request email', async () => {
    await sendApprovalRequestEmail({
      to: { name: flow.approverName, email: flow.approverEmail },
      entityTitle,
      requestId,
      token: flow.token,
      stepName,
      requesterName,
      amount: request.amount,
      priority: request.priority,
    });
    await prisma.approvalFlowRecord.update({
      where: { id: flow.id },
      data: { status: ApprovalFlowStatus.EMAIL_SENT },
    });
  });
}

// ─── Public: act on a flow record ────────────────────────────────────────────

export type FlowDecisionResult =
  | { ok: false; reason: 'not-found' | 'already-actioned' }
  | { ok: true; decision: 'approved' | 'rejected'; requestId: string; entityTitle: string };

export async function processFlowDecision(
  flowRecordId: string,
  approved: boolean,
  comments?: string | null,
): Promise<FlowDecisionResult> {
  const flow = await prisma.approvalFlowRecord.findUnique({ where: { id: flowRecordId } });
  if (!flow) return { ok: false, reason: 'not-found' };

  if (!ACTIONABLE.includes(flow.status)) {
    return { ok: false, reason: 'already-actioned' };
  }

  if (!approved && !comments) {
    // Rejections should carry a reason; default a placeholder rather than blocking.
    comments = 'Rejected';
  }

  await prisma.approvalFlowRecord.update({
    where: { id: flow.id },
    data: {
      status: approved ? ApprovalFlowStatus.APPROVED : ApprovalFlowStatus.REJECTED,
      decision: approved ? 'Approved' : 'Rejected',
      comments: comments ?? null,
      actionedAt: new Date(),
    },
  });

  // Backfill reminder KPI response (best-effort).
  await safe('backfill reminder response', async () => {
    const reminders = await prisma.approvalReminderHistory.findMany({
      where: { flowRecordId: flow.id, respondedAt: null },
    });
    for (const r of reminders) {
      await prisma.approvalReminderHistory.update({
        where: { id: r.id },
        data: {
          respondedAt: new Date(),
          responseAction: approved ? 'Approved' : 'Rejected',
          responseTimeHours: (Date.now() - r.sentAt.getTime()) / 3_600_000,
        },
      });
    }
  });

  const request = await prisma.approvalRequest.findUnique({ where: { id: flow.requestId } });
  const built = request
    ? await buildApprovalContext({
        organizationId: request.organizationId,
        entityType: request.entityType,
        entityId: request.entityId,
      })
    : null;
  const entityTitle = built?.entityTitle ?? 'document';

  if (!approved) {
    await handleRejection(flow.requestId, comments ?? null);
    return { ok: true, decision: 'rejected', requestId: flow.requestId, entityTitle };
  }

  // Approved — check the rest of this step.
  const siblings = await prisma.approvalFlowRecord.findMany({
    where: { requestId: flow.requestId, stepOrder: flow.stepOrder },
  });

  const required = siblings.filter((s) => !s.isOptional);
  const allApproved = required.every((s) => s.status === ApprovalFlowStatus.APPROVED);

  if (allApproved) {
    await completeStepAndProcessNext(flow.requestId);
  } else {
    // Sequential: notify the next not-yet-emailed approver in this step.
    const next = siblings
      .filter((s) => s.status === ApprovalFlowStatus.PENDING)
      .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())[0];
    if (next) {
      await emailFlowRecord(
        next.id,
        flow.requestId,
        entityTitle,
        built?.ownerName ?? null,
        next.stepName ?? '',
      );
    }
  }

  return { ok: true, decision: 'approved', requestId: flow.requestId, entityTitle };
}

// ─── Internal: step completion / chaining / finalize / rejection ─────────────

async function completeStepAndProcessNext(requestId: string, depth = 0): Promise<void> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { template: { include: { steps: { orderBy: { stepNumber: 'asc' } } } } },
  });
  if (!request || !request.template) return;

  const current = request.template.steps.find((s) => s.stepNumber === request.currentStep);
  const next = request.template.steps.find((s) => s.stepNumber === request.currentStep + 1);

  if (next && !current?.isEnd) {
    await executeStep(requestId, request.currentStep + 1, depth);
    return;
  }

  await finalizeApproved(requestId, depth);
}

async function finalizeApproved(requestId: string, depth = 0): Promise<ApprovalRequestStatus> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { template: true },
  });
  if (!request) return ApprovalRequestStatus.CANCELLED;

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: ApprovalRequestStatus.APPROVED, completedAt: new Date(), error: null },
  });

  const built = await buildApprovalContext({
    organizationId: request.organizationId,
    entityType: request.entityType,
    entityId: request.entityId,
  });

  // Post-approval action.
  await safe('on-approve action', () =>
    runOnApproveAction(request.entityType, request.entityId, request.template?.onApproveAction, built),
  );

  // Notify the originator.
  if (built.ownerEmail) {
    await safe('approved outcome email', () =>
      sendApprovalOutcomeEmail({
        to: { name: built.ownerName, email: built.ownerEmail! },
        entityTitle: built.entityTitle,
        requestId,
        approved: true,
      }),
    );
  }

  // Chaining: nextTemplateId > nextRuleSetId > triggerStatus.
  if (request.template && depth < MAX_CHAIN_DEPTH) {
    const tpl = request.template;
    let nextTemplateId: string | null = tpl.nextTemplateId ?? null;

    if (!nextTemplateId && tpl.nextRuleSetId) {
      nextTemplateId = await evaluateRuleSet(tpl.nextRuleSetId, built.context);
    }

    if (nextTemplateId) {
      await safe('chain next template', () =>
        startApprovalRequest(
          {
            organizationId: request.organizationId,
            entityType: request.entityType,
            entityId: request.entityId,
            requesterUserId: request.requestedById,
            specificTemplateId: nextTemplateId!,
            cancelExisting: false,
          },
          depth + 1,
        ),
      );
    }
  }

  return ApprovalRequestStatus.APPROVED;
}

async function handleRejection(
  requestId: string,
  comments: string | null,
  depth = 0,
): Promise<void> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { template: true },
  });
  if (!request) return;

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: ApprovalRequestStatus.REJECTED, completedAt: new Date() },
  });

  const built = await buildApprovalContext({
    organizationId: request.organizationId,
    entityType: request.entityType,
    entityId: request.entityId,
  });

  if (built.ownerEmail) {
    await safe('rejected outcome email', () =>
      sendApprovalOutcomeEmail({
        to: { name: built.ownerName, email: built.ownerEmail! },
        entityTitle: built.entityTitle,
        requestId,
        approved: false,
        comments,
      }),
    );
  }

  if (request.template?.rejectionTemplateId && depth < MAX_CHAIN_DEPTH) {
    await safe('rejection template', () =>
      startApprovalRequest(
        {
          organizationId: request.organizationId,
          entityType: request.entityType,
          entityId: request.entityId,
          requesterUserId: request.requestedById,
          specificTemplateId: request.template!.rejectionTemplateId!,
          cancelExisting: false,
        },
        depth + 1,
      ),
    );
  }
}

async function runOnApproveAction(
  entityType: string,
  entityId: string,
  action: string | null | undefined,
  built: Awaited<ReturnType<typeof buildApprovalContext>>,
): Promise<void> {
  if (action !== 'SEND_FOR_SIGNATURE' || entityType !== 'Document') {
    return;
  }

  const documentId = Number(entityId);
  if (Number.isNaN(documentId)) return;

  if ((built.recipientCount ?? 0) === 0) {
    // Can't send without recipients — leave for the owner to add them.
    return;
  }

  const { sendDocument } = await import('../document/send-document');
  await sendDocument({
    documentId,
    userId: built.ownerUserId ?? 0,
    teamId: built.teamId ?? undefined,
    requestMetadata: { requestMetadata: {}, source: 'app', auth: null },
  });
}
