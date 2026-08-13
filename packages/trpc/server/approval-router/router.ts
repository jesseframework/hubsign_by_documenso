import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  processFlowDecision,
  startApprovalRequest,
} from '@documenso/lib/server-only/approval/approval-execution';
import {
  ZApprovalSeveritySchema,
  ZApprovalTemplateInputSchema,
  ZApprovalValidationTypeSchema,
  ZOrganizationRoleSchema,
} from '@documenso/lib/types/approval';
import { RULE_OVERRIDE_ENTITY_TYPE } from '@documenso/lib/constants/rule-overrides';
import { cancelRuleOverride } from '@documenso/lib/server-only/rules/overrides';
import type { Prisma } from '@documenso/prisma/client';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

const WRITE_ROLES = ['ORG_ADMIN', 'MANAGER'] as const;

const requireOrgMember = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({ where: { userId } });
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of an organization.' });
  }
  return membership;
};

const requireOrgWriteAccess = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: { in: [...WRITE_ROLES] } },
  });
  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization admins or managers can manage approvals.',
    });
  }
  return membership;
};

const stepCreateData = (
  step: z.infer<typeof ZApprovalTemplateInputSchema>['steps'][number],
): Prisma.ApprovalStepCreateWithoutTemplateInput => ({
  stepNumber: step.stepNumber,
  name: step.name,
  determination: step.determination,
  approverRole: step.approverRole,
  fixedUserId: step.fixedUserId,
  roleMappingKey: step.roleMappingKey,
  department: step.department,
  isParallel: step.isParallel,
  isOptional: step.isOptional,
  isEnd: step.isEnd,
  enableReminders: step.enableReminders,
  firstReminderAfterHours: step.firstReminderAfterHours,
  secondReminderAfterHours: step.secondReminderAfterHours,
  escalationAfterHours: step.escalationAfterHours,
  reminderIntervalHours: step.reminderIntervalHours,
  escalationRecipients: step.escalationRecipients,
  config: (step.config ?? undefined) as Prisma.InputJsonValue | undefined,
  validations: { create: step.validationRuleIds.map((validationRuleId) => ({ validationRuleId })) },
});

export const approvalRouter = router({
  // ─── Templates ──────────────────────────────────────────────────────────────
  listTemplates: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return prisma.approvalTemplate.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { steps: true, requests: true } } },
    });
  }),

  getTemplate: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const template = await prisma.approvalTemplate.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        include: {
          steps: { orderBy: { stepNumber: 'asc' }, include: { validations: true } },
        },
      });
      if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
      return template;
    }),

  createTemplate: authenticatedProcedure
    .input(ZApprovalTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      return prisma.approvalTemplate.create({
        data: {
          organizationId: membership.organizationId,
          name: input.name,
          description: input.description,
          entityType: input.entityType,
          isActive: input.isActive,
          isDefault: input.isDefault,
          triggerStatus: input.triggerStatus,
          onApproveAction: input.onApproveAction,
          nextTemplateId: input.nextTemplateId,
          nextRuleSetId: input.nextRuleSetId,
          rejectionTemplateId: input.rejectionTemplateId,
          createdById: ctx.user.id,
          steps: { create: input.steps.map(stepCreateData) },
        },
      });
    }),

  updateTemplate: authenticatedProcedure
    .input(z.object({ id: z.string(), data: ZApprovalTemplateInputSchema }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalTemplate.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });

      // Replace steps wholesale (cascade removes their validation links).
      await prisma.approvalStep.deleteMany({ where: { templateId: existing.id } });

      return prisma.approvalTemplate.update({
        where: { id: existing.id },
        data: {
          name: input.data.name,
          description: input.data.description,
          entityType: input.data.entityType,
          isActive: input.data.isActive,
          isDefault: input.data.isDefault,
          triggerStatus: input.data.triggerStatus,
          onApproveAction: input.data.onApproveAction,
          nextTemplateId: input.data.nextTemplateId,
          nextRuleSetId: input.data.nextRuleSetId,
          rejectionTemplateId: input.data.rejectionTemplateId,
          steps: { create: input.data.steps.map(stepCreateData) },
        },
      });
    }),

  setTemplateActive: authenticatedProcedure
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalTemplate.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
      return prisma.approvalTemplate.update({
        where: { id: existing.id },
        data: { isActive: input.isActive },
      });
    }),

  deleteTemplate: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalTemplate.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
      await prisma.approvalTemplate.delete({ where: { id: existing.id } });
      return { success: true };
    }),

  // ─── Rule sets & rules ───────────────────────────────────────────────────────
  listRuleSets: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return prisma.approvalRuleSet.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { priority: 'desc' },
      include: { rules: { orderBy: { priority: 'desc' } } },
    });
  }),

  createRuleSet: authenticatedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        entityType: z.string().min(1).default('Document'),
        priority: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      return prisma.approvalRuleSet.create({
        data: { organizationId: membership.organizationId, ...input },
      });
    }),

  deleteRuleSet: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalRuleSet.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await prisma.approvalRuleSet.delete({ where: { id: existing.id } });
      return { success: true };
    }),

  upsertRule: authenticatedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        ruleSetId: z.string(),
        name: z.string().min(1),
        conditionConfig: z.unknown(),
        templateId: z.string().optional(),
        priority: z.number().int().default(0),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const ruleSet = await prisma.approvalRuleSet.findFirst({
        where: { id: input.ruleSetId, organizationId: membership.organizationId },
      });
      if (!ruleSet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule set not found.' });

      const data = {
        ruleSetId: input.ruleSetId,
        name: input.name,
        conditionConfig: (input.conditionConfig ?? {}) as Prisma.InputJsonValue,
        templateId: input.templateId,
        priority: input.priority,
        isActive: input.isActive,
      };

      return input.id
        ? prisma.approvalRule.update({ where: { id: input.id }, data })
        : prisma.approvalRule.create({ data });
    }),

  deleteRule: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgWriteAccess(ctx.user.id);
      await prisma.approvalRule.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // ─── Validation rules ────────────────────────────────────────────────────────
  listValidationRules: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return prisma.approvalValidationRule.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { updatedAt: 'desc' },
    });
  }),

  upsertValidationRule: authenticatedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        validationType: ZApprovalValidationTypeSchema,
        conditionConfig: z.unknown(),
        errorMessage: z.string().min(1),
        severity: ZApprovalSeveritySchema.default('ERROR'),
        entityType: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const data = {
        organizationId: membership.organizationId,
        name: input.name,
        validationType: input.validationType,
        conditionConfig: (input.conditionConfig ?? {}) as Prisma.InputJsonValue,
        errorMessage: input.errorMessage,
        severity: input.severity,
        entityType: input.entityType,
        description: input.description,
        isActive: input.isActive,
      };
      if (input.id) {
        const existing = await prisma.approvalValidationRule.findFirst({
          where: { id: input.id, organizationId: membership.organizationId },
        });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
        return prisma.approvalValidationRule.update({ where: { id: input.id }, data });
      }
      return prisma.approvalValidationRule.create({ data });
    }),

  deleteValidationRule: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalValidationRule.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await prisma.approvalValidationRule.delete({ where: { id: existing.id } });
      return { success: true };
    }),

  // ─── Role mappings ───────────────────────────────────────────────────────────
  listRoleMappings: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return prisma.approvalRoleMapping.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: [{ roleType: 'asc' }, { roleKey: 'asc' }, { approvalLevel: 'asc' }],
    });
  }),

  upsertRoleMapping: authenticatedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        roleType: z.string().min(1),
        roleKey: z.string().min(1),
        approvalLevel: z.number().int().default(1),
        primaryApproverId: z.number().int(),
        backupApproverId: z.number().int().optional(),
        reminderHours: z.number().int().optional(),
        expiryHours: z.number().int().optional(),
        isParallel: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const { id, ...rest } = input;
      const data = { organizationId: membership.organizationId, ...rest };
      if (id) {
        const existing = await prisma.approvalRoleMapping.findFirst({
          where: { id, organizationId: membership.organizationId },
        });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
        return prisma.approvalRoleMapping.update({ where: { id }, data });
      }
      return prisma.approvalRoleMapping.create({ data });
    }),

  deleteRoleMapping: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalRoleMapping.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await prisma.approvalRoleMapping.delete({ where: { id: existing.id } });
      return { success: true };
    }),

  // ─── Member manager hierarchy ────────────────────────────────────────────────
  setMemberHierarchy: authenticatedProcedure
    .input(
      z.object({
        memberId: z.string(),
        managerId: z.string().nullable().optional(),
        department: z.string().nullable().optional(),
        isDepartmentHead: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const member = await prisma.organizationMember.findFirst({
        where: { id: input.memberId, organizationId: membership.organizationId },
      });
      if (!member) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found.' });
      return prisma.organizationMember.update({
        where: { id: member.id },
        data: {
          managerId: input.managerId === undefined ? undefined : input.managerId,
          department: input.department === undefined ? undefined : input.department,
          isDepartmentHead: input.isDepartmentHead,
        },
      });
    }),

  // ─── Requests ────────────────────────────────────────────────────────────────
  listRequests: authenticatedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          entityType: z.string().optional(),
          limit: z.number().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      return prisma.approvalRequest.findMany({
        where: {
          organizationId: membership.organizationId,
          status: input?.status as never,
          entityType: input?.entityType,
        },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 50,
        include: {
          template: { select: { name: true } },
          _count: { select: { flows: true } },
        },
      });
    }),

  getRequest: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const request = await prisma.approvalRequest.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        include: {
          template: { select: { id: true, name: true, onApproveAction: true } },
          flows: { orderBy: [{ stepOrder: 'asc' }, { assignedAt: 'asc' }] },
        },
      });
      if (!request) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });

      let entityTitle = `${request.entityType} ${request.entityId}`;
      if (request.entityType === 'Document') {
        const documentId = Number(request.entityId);
        if (!Number.isNaN(documentId)) {
          const document = await prisma.document.findUnique({
            where: { id: documentId },
            select: { title: true },
          });
          if (document) entityTitle = document.title;
        }
      }

      return { ...request, entityTitle };
    }),

  startRequest: authenticatedProcedure
    .input(
      z.object({
        entityType: z.string().min(1).default('Document'),
        entityId: z.string().min(1),
        specificTemplateId: z.string().optional(),
        cancelExisting: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const result = await startApprovalRequest({
        organizationId: membership.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        requesterUserId: ctx.user.id,
        specificTemplateId: input.specificTemplateId,
        cancelExisting: input.cancelExisting,
        throwIfNoTemplate: true,
      });
      return result;
    }),

  cancelRequest: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.approvalRequest.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      const cancelled = await prisma.approvalRequest.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });

      /*
        Release whatever this chain was gating.

        A cancelled request used to leave a signing exception PENDING with nothing
        able to decide it, and that PENDING then blocked the signer from raising
        another — a dead end produced by one click here. Only PENDING overrides are
        touched, so cancelling the request behind an already-granted waiver cannot
        retroactively revoke it.
      */
      if (existing.entityType === RULE_OVERRIDE_ENTITY_TYPE) {
        await cancelRuleOverride({
          overrideId: existing.entityId,
          note: 'The approval request handling this was cancelled, so it was not decided.',
        }).catch((err) => console.error('[approval] could not release the rule override:', err));
      }

      return cancelled;
    }),

  // ─── In-app actions ──────────────────────────────────────────────────────────
  myPendingApprovals: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    const flows = await prisma.approvalFlowRecord.findMany({
      where: {
        approverId: ctx.user.id,
        status: { in: ['PENDING', 'EMAIL_SENT', 'EMAIL_READ'] },
        request: { organizationId: membership.organizationId, status: 'IN_PROGRESS' },
      },
      orderBy: { assignedAt: 'desc' },
      include: { request: { select: { id: true, entityType: true, entityId: true } } },
    });

    // Enrich Document entities with their titles.
    const docIds = flows
      .filter((f) => f.request.entityType === 'Document')
      .map((f) => Number(f.request.entityId))
      .filter((n) => !Number.isNaN(n));
    const titles = new Map<number, string>();
    if (docIds.length > 0) {
      const docs = await prisma.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, title: true },
      });
      docs.forEach((d) => titles.set(d.id, d.title));
    }

    return flows.map((f) => ({
      flowId: f.id,
      requestId: f.requestId,
      stepName: f.stepName,
      assignedAt: f.assignedAt,
      status: f.status,
      entityTitle:
        f.request.entityType === 'Document'
          ? titles.get(Number(f.request.entityId)) ?? `Document ${f.request.entityId}`
          : `${f.request.entityType} ${f.request.entityId}`,
    }));
  }),

  act: authenticatedProcedure
    .input(
      z.object({
        flowRecordId: z.string(),
        approved: z.boolean(),
        comments: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const flow = await prisma.approvalFlowRecord.findUnique({
        where: { id: input.flowRecordId },
        include: { request: { select: { organizationId: true } } },
      });
      if (!flow || flow.request.organizationId !== membership.organizationId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval not found.' });
      }
      const isApprover = flow.approverId === ctx.user.id;
      const isAdmin = membership.role === 'ORG_ADMIN';
      if (!isApprover && !isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not the assigned approver.' });
      }
      return processFlowDecision(input.flowRecordId, input.approved, input.comments);
    }),
});
