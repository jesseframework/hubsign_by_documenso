import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

/**
 * Org-scoped reusable email bodies for workflow SEND_EMAIL steps.
 *
 * Reads are open to any member (a workflow author needs to pick one); writes
 * require ORG_ADMIN, matching how the rest of the org configuration behaves.
 */
const requireOrgMember = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    // Must agree with every other org resolution; an unordered findFirst lets
    // Postgres heap order decide which org's templates you see.
    orderBy: { joinedAt: 'asc' },
  });

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of an organization.' });
  }

  return membership;
};

const requireOrgAdmin = async (userId: number) => {
  const membership = await requireOrgMember(userId);

  if (membership.role !== 'ORG_ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization administrators can manage email templates.',
    });
  }

  return membership;
};

/**
 * Slug used from workflow JSON. Constrained to lowercase/digits/hyphen so it
 * stays readable and unambiguous when typed into a step by hand.
 */
const ZKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and single hyphens (e.g. "invoice-received").',
  );

const ZTemplateInput = z.object({
  key: ZKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  subject: z.string().min(1).max(300),
  html: z.string().min(1).max(200_000),
  text: z.string().max(200_000).nullable().optional(),
});

export const emailTemplateRouter = router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);

    return prisma.emailTemplate.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { name: 'asc' },
    });
  }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      const template = await prisma.emailTemplate.findFirst({
        // Scoped by org as well as id so a template id from another
        // organization cannot be read by guessing it.
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email template not found.' });
      }

      return template;
    }),

  create: authenticatedProcedure.input(ZTemplateInput).mutation(async ({ ctx, input }) => {
    const membership = await requireOrgAdmin(ctx.user.id);

    const existing = await prisma.emailTemplate.findUnique({
      where: { organizationId_key: { organizationId: membership.organizationId, key: input.key } },
    });

    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `An email template with the key "${input.key}" already exists.`,
      });
    }

    return prisma.emailTemplate.create({
      data: {
        ...input,
        description: input.description ?? null,
        text: input.text ?? null,
        organizationId: membership.organizationId,
        createdById: ctx.user.id,
      },
    });
  }),

  update: authenticatedProcedure
    .input(ZTemplateInput.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgAdmin(ctx.user.id);
      const { id, ...data } = input;

      const template = await prisma.emailTemplate.findFirst({
        where: { id, organizationId: membership.organizationId },
      });

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email template not found.' });
      }

      // Renaming the key silently breaks every workflow step referencing the
      // old one, so the collision check runs on update too.
      if (data.key && data.key !== template.key) {
        const clash = await prisma.emailTemplate.findUnique({
          where: {
            organizationId_key: { organizationId: membership.organizationId, key: data.key },
          },
        });

        if (clash) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `An email template with the key "${data.key}" already exists.`,
          });
        }
      }

      return prisma.emailTemplate.update({ where: { id }, data });
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgAdmin(ctx.user.id);

      const template = await prisma.emailTemplate.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email template not found.' });
      }

      await prisma.emailTemplate.delete({ where: { id: input.id } });

      return { success: true, key: template.key };
    }),

  /**
   * Workflow steps that reference a given key, so the UI can warn before a
   * rename or delete orphans a live workflow.
   */
  usage: authenticatedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      const workflows = await prisma.workflow.findMany({
        where: { organizationId: membership.organizationId },
        select: { id: true, name: true, enabled: true, definition: true },
      });

      // The reference lives inside the step graph, which is opaque JSON — a
      // substring test on the serialised definition is the cheap way to find it
      // without walking every step shape.
      const needle = JSON.stringify(input.key);

      return workflows
        .filter((w) => JSON.stringify(w.definition ?? {}).includes(needle))
        .map(({ id, name, enabled }) => ({ id, name, enabled }));
    }),
});
