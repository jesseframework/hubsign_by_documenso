import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { evaluateGate } from '@documenso/lib/server-only/rules/evaluate-gate';
import { buildRuleContext, ruleFieldCatalogue } from '@documenso/lib/server-only/rules/registry';
import { RULE_GATES, RULE_GATE_LABELS, RULE_OUTCOMES } from '@documenso/lib/server-only/rules/types';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

const requireOrgAdmin = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
  });

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of an organization.' });
  }

  if (membership.role !== 'ORG_ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization administrators can manage business rules.',
    });
  }

  return membership;
};

const ZRuleInput = z.object({
  gate: z.enum(RULE_GATES),
  entityType: z.string().min(1).max(64).default('Document'),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
  /** JSONLogic. Validated by evaluation against a probe context, not by shape. */
  conditionConfig: z.unknown(),
  outcome: z.enum(RULE_OUTCOMES).default('BLOCK'),
  message: z.string().min(1).max(500),
  priority: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const businessRuleRouter = router({
  /**
   * Everything a rule can reference, generated from the provider registry.
   *
   * The builder UI reads this rather than carrying its own copy of the field
   * list, so adding a provider surfaces new fields with no front-end change —
   * that is what "application aware" means here in practice.
   */
  fieldCatalogue: authenticatedProcedure.query(async () => ({
    namespaces: ruleFieldCatalogue(),
    gates: RULE_GATES.map((gate) => ({ gate, label: RULE_GATE_LABELS[gate] })),
    outcomes: RULE_OUTCOMES,
  })),

  list: authenticatedProcedure
    .input(z.object({ gate: z.enum(RULE_GATES).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
        orderBy: { joinedAt: 'asc' },
      });

      if (!membership) return [];

      return prisma.businessRule.findMany({
        where: {
          organizationId: membership.organizationId,
          ...(input?.gate ? { gate: input.gate } : {}),
        },
        orderBy: [{ gate: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      });
    }),

  create: authenticatedProcedure.input(ZRuleInput).mutation(async ({ ctx, input }) => {
    const membership = await requireOrgAdmin(ctx.user.id);

    return prisma.businessRule.create({
      data: {
        ...input,
        description: input.description ?? null,
        conditionConfig: input.conditionConfig as never,
        organizationId: membership.organizationId,
        createdById: ctx.user.id,
      },
    });
  }),

  update: authenticatedProcedure
    .input(ZRuleInput.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgAdmin(ctx.user.id);
      const { id, ...data } = input;

      // Scoped by org as well as id so a rule from another tenant can't be
      // edited by guessing its id.
      const existing = await prisma.businessRule.findFirst({
        where: { id, organizationId: membership.organizationId },
        select: { id: true },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found.' });
      }

      return prisma.businessRule.update({
        where: { id },
        data: {
          ...data,
          ...(data.conditionConfig !== undefined && {
            conditionConfig: data.conditionConfig as never,
          }),
        },
      });
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgAdmin(ctx.user.id);

      const deleted = await prisma.businessRule.deleteMany({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (deleted.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found.' });
      }

      return { success: true };
    }),

  /**
   * Dry-run every rule at a gate against a real document, without enforcing.
   *
   * The important half of authoring: a rule written blind against OCR data is a
   * guess. This shows the resolved context and which rules would fire, so an
   * admin can confirm a rule does what they meant before switching it on.
   */
  test: authenticatedProcedure
    .input(z.object({ gate: z.enum(RULE_GATES), documentId: z.number() }))
    .query(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
        orderBy: { joinedAt: 'asc' },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not in an organization.' });
      }

      // Restricted to the caller's own org so this can't be used to read another
      // tenant's document data through the context dump below.
      const document = await prisma.document.findFirst({
        where: { id: input.documentId, organizationId: membership.organizationId },
        select: { id: true, title: true },
      });

      if (!document) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found.' });
      }

      const subject = {
        organizationId: membership.organizationId,
        entityType: 'Document',
        entityId: String(document.id),
        actorUserId: ctx.user.id,
        recipientId: null,
      };

      const context = await buildRuleContext(subject);
      const verdict = await evaluateGate({ gate: input.gate, subject, context });

      return { document, context, verdict };
    }),
});
