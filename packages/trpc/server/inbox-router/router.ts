import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { jobs } from '@documenso/lib/jobs/client';
import { bmsMlGetTemplates } from '@documenso/lib/server-only/bms-ml/client';
import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { publishInboxEvent } from '@documenso/lib/server-only/inbox/inbox-events';
import { pollWorkHubInboxForOrg } from '@documenso/lib/server-only/inbox/poll-workhub-inbox';
import { rememberTemplateForSender } from '@documenso/lib/server-only/inbox/resolve-ocr-template';
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

      // Mirrors Outlook: opening an item marks it read automatically. Shared
      // across the org (this is a shared queue, not a per-user mailbox), so
      // whoever opens it first marks it read for everyone.
      if (!item.viewedAt) {
        item.viewedAt = (
          await prisma.signatureInboxItem.update({
            where: { id: item.id },
            data: { viewedAt: new Date() },
            select: { viewedAt: true },
          })
        ).viewedAt;

        // The org's unread count just dropped — push it to everyone else's
        // sidebar. Only on the transition, so this can't loop with the
        // refetch the event itself triggers.
        publishInboxEvent(membership.organizationId, { type: 'viewed', inboxItemId: item.id });
      }

      return item;
    }),

  /** Count of unread items for the sidebar badge. */
  unreadCount: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return prisma.signatureInboxItem.count({
      where: { organizationId: membership.organizationId, viewedAt: null },
    });
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

      const sent = await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'SENT_FOR_SIGNATURE' },
      });

      publishInboxEvent(membership.organizationId, {
        type: 'update',
        inboxItemId: sent.id,
        status: sent.status,
      });

      return sent;
    }),

  /**
   * BMS ML extraction templates available to this org, for the item's template
   * picker. Returns [] when OCR isn't configured rather than erroring.
   */
  ocrTemplates: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    const org = await prisma.organization.findUnique({
      where: { id: membership.organizationId },
      select: {
        ocrApiUrl: true,
        ocrApiKey: true,
        ocrApiUsername: true,
        ocrApiPassword: true,
        ocrDefaultTemplateId: true,
      },
    });

    if (!org?.ocrApiUrl) {
      return { templates: [], defaultTemplateId: null };
    }

    // A slow or down ML service must not break the page it's rendered on.
    const templates = await bmsMlGetTemplates({
      apiUrl: org.ocrApiUrl,
      apiKey: org.ocrApiKey,
      apiUsername: org.ocrApiUsername,
      apiPassword: org.ocrApiPassword,
    }).catch(() => []);

    return {
      templates: templates
        .filter((template) => template.is_active !== false)
        .map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          isDefault: template.is_default,
        })),
      defaultTemplateId: org.ocrDefaultTemplateId,
    };
  }),

  /** Re-run OCR for an item, optionally forcing a specific template. */
  reprocessOcr: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        templateId: z.number().int().positive().nullable().optional(),
        /**
         * Save the chosen template onto the sender's Metadata vendor record so
         * their next invoice routes to it automatically.
         */
        rememberForSender: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });

      let remembered: string | null = null;

      if (input.rememberForSender && input.templateId && item.senderEmail) {
        remembered = await rememberTemplateForSender({
          organizationId: membership.organizationId,
          senderEmail: item.senderEmail,
          templateId: input.templateId,
        }).catch(() => null);
      }

      await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'OCR_PROCESSING', error: null },
      });

      // Push the "processing" state now; `runInboxOcr` publishes again when it
      // lands on READY / OCR_FAILED.
      publishInboxEvent(membership.organizationId, {
        type: 'update',
        inboxItemId: item.id,
        status: 'OCR_PROCESSING',
      });

      await jobs.triggerJob({
        name: 'internal.process-inbox-ocr',
        payload: { inboxItemId: item.id, templateId: input.templateId ?? undefined },
      });

      return { success: true, remembered };
    }),

  archive: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });

      const archived = await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'ARCHIVED' },
      });

      publishInboxEvent(membership.organizationId, {
        type: 'update',
        inboxItemId: archived.id,
        status: archived.status,
      });

      return archived;
    }),

  /** Pull new messages from this org's WorkHub inbox now (also runs on the cron). */
  fetchNow: authenticatedProcedure.mutation(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return pollWorkHubInboxForOrg(membership.organizationId);
  }),
});
