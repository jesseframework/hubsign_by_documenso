import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { jobs } from '@documenso/lib/jobs/client';
import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { pollWorkHubInboxForOrg } from '@documenso/lib/server-only/inbox/poll-workhub-inbox';
import { nanoid } from '@documenso/lib/universal/id';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

const requireOrgMember = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({ where: { userId } });
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of an organization.' });
  }
  return membership;
};

export const inboxRouter = router({
  /** The signature inbox queue for the organization. */
  list: authenticatedProcedure
    .input(z.object({ status: z.string().optional(), limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const items = await prisma.signatureInboxItem.findMany({
        where: { organizationId: membership.organizationId, status: input?.status as never },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 100,
        include: {
          document: {
            select: {
              id: true,
              title: true,
              status: true,
              _count: { select: { recipients: true } },
            },
          },
        },
      });

      // Attach a per-item workflow-activity summary (correlated via run context).
      const runs = await prisma.workflowRun.findMany({
        where: { workflow: { organizationId: membership.organizationId }, trigger: 'INBOX_OCR_COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { status: true, context: true },
      });
      const statusesByItem = new Map<string, string[]>();
      for (const run of runs) {
        const itemId = (run.context as { payload?: { inboxItemId?: unknown } })?.payload?.inboxItemId;
        if (typeof itemId === 'string') {
          const arr = statusesByItem.get(itemId) ?? [];
          arr.push(run.status); // runs are desc, so [0] is the latest
          statusesByItem.set(itemId, arr);
        }
      }

      return items.map((item) => {
        const statuses = statusesByItem.get(item.id) ?? [];
        return { ...item, workflow: { status: statuses[0] ?? null, runs: statuses.length } };
      });
    }),

  /** Workflow runs (with steps) triggered by this inbox item — for the row indicator. */
  workflowActivity: authenticatedProcedure
    .input(z.object({ inboxItemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.inboxItemId, organizationId: membership.organizationId },
        select: { id: true },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox item not found.' });

      return prisma.workflowRun.findMany({
        where: {
          trigger: 'INBOX_OCR_COMPLETED',
          workflow: { organizationId: membership.organizationId },
          context: { path: ['payload', 'inboxItemId'], equals: input.inboxItemId },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          createdAt: true,
          error: true,
          workflow: { select: { name: true } },
          steps: {
            orderBy: { createdAt: 'asc' },
            select: { stepId: true, type: true, status: true, error: true },
          },
        },
      });
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        include: {
          document: {
            include: {
              recipients: {
                select: { id: true, email: true, name: true, role: true, signingStatus: true },
              },
              documentMeta: { select: { subject: true } },
            },
          },
        },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox item not found.' });
      return item;
    }),

  /** Add signer(s) (if provided) then send the document for signature. */
  sendForSignature: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        recipients: z
          .array(z.object({ name: z.string().optional(), email: z.string().email() }))
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        include: { document: { include: { recipients: true } } },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox item not found.' });

      // Create any new signers (deduped by email).
      const existingEmails = new Set(item.document.recipients.map((r) => r.email.toLowerCase()));
      for (const r of input.recipients) {
        if (existingEmails.has(r.email.toLowerCase())) continue;
        await prisma.recipient.create({
          data: {
            documentId: item.documentId,
            email: r.email,
            name: r.name ?? '',
            token: nanoid(),
            role: 'SIGNER',
          },
        });
        existingEmails.add(r.email.toLowerCase());
      }

      if (existingEmails.size === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add at least one signer before sending.',
        });
      }

      // Send as the document owner so ownership checks pass (shared queue).
      await sendDocument({
        documentId: item.documentId,
        userId: item.document.userId,
        teamId: item.document.teamId ?? undefined,
        requestMetadata: { requestMetadata: {}, source: 'app', auth: null },
      });

      return prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'SENT_FOR_SIGNATURE' },
      });
    }),

  /** Re-run OCR for an item. */
  reprocessOcr: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });

      await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'OCR_PROCESSING', error: null },
      });
      await jobs.triggerJob({ name: 'internal.process-inbox-ocr', payload: { inboxItemId: item.id } });
      return { success: true };
    }),

  archive: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
      return prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'ARCHIVED' },
      });
    }),

  /** Pull new messages from this org's WorkHub inbox now (also runs on the cron). */
  fetchNow: authenticatedProcedure.mutation(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return pollWorkHubInboxForOrg(membership.organizationId);
  }),
});
