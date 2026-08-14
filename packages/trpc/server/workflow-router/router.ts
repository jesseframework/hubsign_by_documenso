import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { generateWorkflowFromPrompt } from '@documenso/lib/server-only/workflow/ai-generate-workflow';
import { computeNextRunAt } from '@documenso/lib/server-only/workflow/run-due-scheduled';
import { enqueueWorkflowRun } from '@documenso/lib/server-only/workflow/trigger-workflows';
import { isValidCron } from '@documenso/lib/server-only/workflow/cron';
import type { TWorkflowDefinition, TWorkflowRunContext } from '@documenso/lib/types/workflow';
import { ZWorkflowDefinitionSchema } from '@documenso/lib/types/workflow';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

// ─── Org access helpers ──────────────────────────────────────────────────────

const WRITE_ROLES = ['ORG_ADMIN', 'MANAGER'] as const;

/** Read access: any member of an organization. Throws if the user has none. */
const requireOrgMember = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({ where: { userId } });

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of an organization.',
    });
  }

  return membership;
};

/** Write access: ORG_ADMIN or MANAGER. */
const requireOrgWriteAccess = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: { in: [...WRITE_ROLES] } },
  });

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization admins or managers can manage workflows.',
    });
  }

  return membership;
};

/**
 * Project the (denormalised) trigger columns from the authoritative definition.
 * `nextRunAt` is only set for enabled SCHEDULE workflows.
 */
const deriveTriggerColumns = (definition: TWorkflowDefinition, enabled: boolean) => {
  const trigger = definition.trigger;

  const triggerType = trigger.type;
  const triggerEvent = trigger.type === 'EVENT' ? trigger.event : null;
  const cron = trigger.type === 'SCHEDULE' ? trigger.cron : null;
  const timezone = trigger.type === 'SCHEDULE' ? trigger.timezone ?? 'UTC' : null;
  const nextRunAt = enabled && cron ? computeNextRunAt(cron, timezone) : null;

  return { triggerType, triggerEvent, cron, timezone, nextRunAt };
};

const assertValidDefinition = (definition: TWorkflowDefinition) => {
  if (definition.trigger.type === 'SCHEDULE' && !isValidCron(definition.trigger.cron)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid cron expression: "${definition.trigger.cron}"`,
    });
  }
};

// ─── Router ──────────────────────────────────────────────────────────────────

export const workflowRouter = router({
  /** List the organization's workflows with lightweight run stats. */
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);

    const workflows = await prisma.workflow.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { runs: true } } },
    });

    return workflows;
  }),

  /** Fetch a single workflow (org-scoped). */
  get: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      const workflow = await prisma.workflow.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!workflow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found.' });
      }

      return workflow;
    }),

  /** Generate a workflow definition from a natural-language prompt (AI). */
  generate: authenticatedProcedure
    .input(z.object({ prompt: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const organization = await prisma.organization.findUnique({
        where: { id: membership.organizationId },
        select: { name: true },
      });

      // Summarize the org's metadata directory so the AI targets real
      // categories/keywords in LOOKUP_METADATA (exact + keyword modes).
      const records = await prisma.metadataRecord.findMany({
        where: { organizationId: membership.organizationId },
        orderBy: [{ category: 'asc' }, { label: 'asc' }],
        take: 200,
        select: { category: true, label: true, email: true, data: true },
      });
      let metadataContext: string | undefined;
      if (records.length > 0) {
        const byCategory = new Map<string, string[]>();
        for (const r of records) {
          const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
          const kw = Array.isArray(d.keywords)
            ? (d.keywords as unknown[]).map(String)
            : typeof d.keywords === 'string'
              ? d.keywords.split(',').map((k) => k.trim()).filter(Boolean)
              : [];
          const role = typeof d.role === 'string' ? d.role : '';
          const parts = [
            `"${r.label ?? ''}"`,
            r.email ? `<${r.email}>` : '',
            role ? `role=${role}` : '',
            kw.length ? `keywords=[${kw.join(', ')}]` : '',
          ].filter(Boolean);
          const arr = byCategory.get(r.category) ?? [];
          if (arr.length < 8) arr.push(parts.join(' '));
          byCategory.set(r.category, arr);
        }
        const lines = [...byCategory.entries()].map(
          ([cat, items]) => `- category "${cat}": ${items.join('; ')}`,
        );
        metadataContext =
          `This organization's metadata directory (use these exact category names in LOOKUP_METADATA; ` +
          `prefer keyword mode — omit "key" — when records have keywords):\n${lines.join('\n')}`;
      }

      // Give the model the org's real template keys. Without this it would
      // either inline HTML it invented or guess a key, and a key that resolves
      // to nothing makes the step skip instead of send.
      const emailTemplates = await prisma.emailTemplate.findMany({
        where: { organizationId: membership.organizationId },
        select: { key: true, name: true, description: true, subject: true },
        orderBy: { name: 'asc' },
        take: 40,
      });

      const emailTemplateContext =
        emailTemplates.length > 0
          ? `AVAILABLE EMAIL TEMPLATES (use one of these exact keys as "templateKey" on a SEND_EMAIL step when it fits; otherwise write the body inline):\n` +
            emailTemplates
              .map(
                (t) =>
                  `- "${t.key}" — ${t.name}${t.description ? `: ${t.description}` : ''} (subject: ${t.subject})`,
              )
              .join('\n')
          : undefined;

      const generated = await generateWorkflowFromPrompt({
        organizationId: membership.organizationId,
        prompt: input.prompt,
        organizationName: organization?.name ?? undefined,
        metadataContext,
        emailTemplateContext,
      });

      // Defensive: ensure the generated trigger is still well-formed (e.g. cron).
      assertValidDefinition(generated.definition);

      return generated;
    }),

  create: authenticatedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        enabled: z.boolean().default(false),
        definition: ZWorkflowDefinitionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      assertValidDefinition(input.definition);

      const columns = deriveTriggerColumns(input.definition, input.enabled);

      return prisma.workflow.create({
        data: {
          organizationId: membership.organizationId,
          name: input.name,
          description: input.description,
          enabled: input.enabled,
          definition: input.definition,
          createdById: ctx.user.id,
          ...columns,
        },
      });
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        enabled: z.boolean().optional(),
        definition: ZWorkflowDefinitionSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);

      const existing = await prisma.workflow.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found.' });
      }

      const definition = input.definition ?? (existing.definition as TWorkflowDefinition);
      const enabled = input.enabled ?? existing.enabled;

      if (input.definition) {
        assertValidDefinition(input.definition);
      }

      const columns = deriveTriggerColumns(definition, enabled);

      return prisma.workflow.update({
        where: { id: existing.id },
        data: {
          name: input.name ?? undefined,
          description: input.description === undefined ? undefined : input.description,
          enabled,
          ...(input.definition ? { definition: input.definition, version: { increment: 1 } } : {}),
          ...columns,
        },
      });
    }),

  setEnabled: authenticatedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);

      const existing = await prisma.workflow.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found.' });
      }

      const columns = deriveTriggerColumns(
        existing.definition as TWorkflowDefinition,
        input.enabled,
      );

      return prisma.workflow.update({
        where: { id: existing.id },
        data: { enabled: input.enabled, nextRunAt: columns.nextRunAt },
      });
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);

      const existing = await prisma.workflow.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found.' });
      }

      await prisma.workflow.delete({ where: { id: existing.id } });

      return { success: true };
    }),

  /** Manually run a workflow now with an optional ad-hoc payload. */
  run: authenticatedProcedure
    .input(z.object({ id: z.string(), payload: z.record(z.unknown()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);

      const workflow = await prisma.workflow.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!workflow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found.' });
      }

      const definition = ZWorkflowDefinitionSchema.parse(workflow.definition);

      const context: TWorkflowRunContext = {
        event: 'MANUAL',
        trigger: definition.trigger,
        payload: input.payload ?? {},
        organization: { id: membership.organizationId },
        triggeredBy: { id: ctx.user.id },
        now: new Date().toISOString(),
      };

      const runId = await enqueueWorkflowRun({
        workflowId: workflow.id,
        trigger: 'MANUAL',
        context,
      });

      return { runId };
    }),

  /** Recent runs for a workflow (org-scoped). */
  listRuns: authenticatedProcedure
    .input(z.object({ workflowId: z.string(), limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      return prisma.workflowRun.findMany({
        where: {
          workflowId: input.workflowId,
          workflow: { organizationId: membership.organizationId },
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),

  /** A single run with its step timeline. */
  getRun: authenticatedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      const run = await prisma.workflowRun.findFirst({
        where: {
          id: input.runId,
          workflow: { organizationId: membership.organizationId },
        },
        include: {
          steps: { orderBy: { createdAt: 'asc' } },
          workflow: { select: { id: true, name: true } },
        },
      });

      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow run not found.' });
      }

      return run;
    }),
});
