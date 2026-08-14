import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { jobs } from '@documenso/lib/jobs/client';
import { getDocumentResponsibility } from '@documenso/lib/server-only/document/responsibility';
import { bmsMlGetTemplates } from '@documenso/lib/server-only/bms-ml/client';
import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { ensureSignatureFields } from '@documenso/lib/server-only/field/ensure-signature-fields';
import {
  affectsDuplicateCheck,
  flagDuplicateInboxItem,
} from '@documenso/lib/server-only/inbox/flag-duplicate';
import { describeBlocks, evaluateGate } from '@documenso/lib/server-only/rules/evaluate-gate';
import { publishInboxEvent } from '@documenso/lib/server-only/inbox/inbox-events';
import { markInboxEmailRead } from '@documenso/lib/server-only/inbox/mark-email-read';
import { pollWorkHubInboxForOrg } from '@documenso/lib/server-only/inbox/poll-workhub-inbox';
import { runAttachmentOcr } from '@documenso/lib/server-only/inbox/run-attachment-ocr';
import { rememberTemplateForSender } from '@documenso/lib/server-only/inbox/resolve-ocr-template';
import {
  WorkHubWebhookError,
  registerMailWatch,
} from '@documenso/lib/server-only/inbox/workhub-mail-webhook';
import { SLA_ORG_SELECT, evaluateItemsSla, slaClockStart } from '@documenso/lib/server-only/inbox/sla';
import { getInboxItemTimeline } from '@documenso/lib/server-only/inbox/timeline';
import { reassignRecipient } from '@documenso/lib/server-only/recipient/reassign-recipient';
import { nanoid } from '@documenso/lib/universal/id';
import { vendorCoreName } from '@documenso/lib/universal/vendor-match';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';
import { OrganizationRole } from '@prisma/client';

import { requireOrgMember } from '../lib/require-org-member';
import { authenticatedProcedure, router } from '../trpc';

// Shared with the export router so the spreadsheet always describes the same
// organization as the grid it was exported from.

/** Most inbox items the SLA dashboard will evaluate in one window. */
const SLA_ITEM_LIMIT = 1000;

/** Most overdue rows listed. The count shown to the user is never this capped value. */
const OVERDUE_LIST_LIMIT = 15;

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
          // The invoice this one repeats, and any later copies of it. Both sides
          // are carried so the queue can say which row is the original rather
          // than leaving two identical-looking invoices and one red flag.
          duplicateOf: {
            select: { id: true, subject: true, createdAt: true, status: true, document: { select: { title: true } } },
          },
          _count: { select: { duplicates: true } },
          document: {
            select: {
              id: true,
              title: true,
              status: true,
              completedAt: true,
              _count: { select: { recipients: true } },
              // The real signing state. The inbox item's own status only says
              // that a send happened, not what became of it — a document can sit
              // at "sent for signature" for a week with nobody having signed.
              recipients: {
                select: { id: true, email: true, name: true, role: true, signingStatus: true },
                orderBy: { id: 'asc' },
              },
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

      // SLA state per row, so an overdue invoice is visible in the queue itself
      // rather than only on the dashboard — the queue is where someone acts.
      const org = await prisma.organization.findUnique({
        where: { id: membership.organizationId },
        select: SLA_ORG_SELECT,
      });

      const slaByItem = new Map<
        string,
        {
          state: string;
          open: boolean;
          overdueByMinutes: number;
          dueAt: Date | null;
          /** Which clock the row is reporting — they run one after the other. */
          stage: 'internal' | 'signing';
        }
      >();

      if (org?.slaEnabled) {
        const evaluated = await evaluateItemsSla({
          organizationId: membership.organizationId,
          org,
          items: items.map((item) => ({ ...item, document: item.document })),
        });

        for (const result of evaluated) {
          /*
            Whichever clock is running NOW. Before the send that is the internal
            one; after it, the signing one. Reporting only the internal clock
            left the queue silent about an invoice that went out in ten minutes
            and has been sitting unsigned for three weeks — the row went quiet at
            exactly the moment the wait began.

            A breach whose clock has stopped is history: colouring a fully-signed
            invoice as urgent would put finished work at the top of someone's
            to-do pile.
          */
          const active = !result.internal.settled
            ? { leg: result.internal, stage: 'internal' as const }
            : result.signing && !result.signing.settled
              ? { leg: result.signing, stage: 'signing' as const }
              : null;

          slaByItem.set(result.inboxItemId, {
            state: (active?.leg ?? result.internal).state,
            open: active !== null,
            overdueByMinutes: active
              ? Math.max(0, active.leg.elapsedMinutes - active.leg.targetMinutes)
              : 0,
            dueAt: (active?.leg ?? result.internal).dueAt,
            stage: active?.stage ?? 'internal',
          });
        }
      }

      // Who each document is waiting on, and how often they've been chased.
      // Two queries for the whole page rather than one per row.
      const responsibility = await getDocumentResponsibility(items.map((item) => item.documentId));

      return items.map((item) => {
        const statuses = statusesByItem.get(item.id) ?? [];
        const recipients = item.document.recipients;
        const signed = recipients.filter((r) => r.signingStatus === 'SIGNED').length;
        const rejected = recipients.filter((r) => r.signingStatus === 'REJECTED').length;

        return {
          ...item,
          workflow: { status: statuses[0] ?? null, runs: statuses.length },
          sla: slaByItem.get(item.id) ?? null,
          /** Where the signatures themselves actually stand. */
          signature: {
            documentStatus: item.document.status,
            total: recipients.length,
            signed,
            rejected,
            pending: recipients.length - signed - rejected,
            completedAt: item.document.completedAt,
            waitingOn: recipients
              .filter((r) => r.signingStatus === 'NOT_SIGNED')
              .map((r) => r.name || r.email),
          },
          /** Who owes a signature, and the reminder log behind the count. */
          responsibility: responsibility.get(item.documentId) ?? null,
        };
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

  /** Merged history for one inbox item — arrival, OCR, signing, reminders, workflows. */
  timeline: authenticatedProcedure
    .input(z.object({ inboxItemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      return getInboxItemTimeline({
        inboxItemId: input.inboxItemId,
        organizationId: membership.organizationId,
      });
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        include: {
          duplicateOf: {
            select: {
              id: true,
              subject: true,
              createdAt: true,
              status: true,
              senderEmail: true,
              document: { select: { title: true } },
            },
          },
          // Copies that arrived after this one. Shown on the original so the two
          // rows tell the same story from either end.
          duplicates: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, subject: true, createdAt: true, document: { select: { title: true } } },
          },
          document: {
            include: {
              recipients: {
                select: { id: true, email: true, name: true, role: true, signingStatus: true },
              },
              documentMeta: { select: { subject: true } },
              // Attachments, with whatever OCR has been run over them — this is
              // how an attached purchase order gets read.
              supportingFiles: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  fileName: true,
                  contentType: true,
                  sizeBytes: true,
                  createdAt: true,
                  ocrRanAt: true,
                  ocrError: true,
                  ocrDocumentType: true,
                  extractedData: true,
                  ocrRanBy: { select: { name: true, email: true } },
                  recipient: { select: { name: true, email: true } },
                },
              },
            },
          },
          // Lets the review screen mark which values a person typed, so a
          // human correction is never mistaken for an extractor reading.
          fieldEdits: {
            orderBy: { editedAt: 'desc' },
            select: {
              field: true,
              newValue: true,
              editedAt: true,
              source: true,
              sourceDetail: true,
              editedBy: { select: { name: true, email: true } },
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

        // Someone is looking at this document, so the mailbox copy no longer
        // needs anyone's attention either. Not awaited: this is a read query
        // serving a page, and a slow or unreachable mailbox cluster must not
        // hold it up. The helper is idempotent, so at most one call is ever made.
        void markInboxEmailRead({
          organizationId: membership.organizationId,
          inboxItemId: item.id,
          reason: 'opened',
        });
      }

      return item;
    }),

  /**
   * Correct or supply an extracted field.
   *
   * The only writer of `extractedData` used to be the OCR job, which made a
   * misread value unfixable by anyone — and a rule reading that value would
   * refuse signing forever with no remedy. Corrections are logged rather than
   * applied silently, because a figure a person typed is different evidence
   * from a figure the extractor read.
   */
  updateExtractedField: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        field: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[A-Za-z0-9_.-]+$/, 'Field names may contain letters, digits, dot, dash and underscore.'),
        value: z.string().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        select: { id: true, extractedData: true, document: { select: { status: true } } },
      });

      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox item not found.' });
      }

      // A completed document was signed against the data as it stood. Editing
      // it afterwards would rewrite the record the signature was given on, and
      // nothing downstream can act on the change anyway.
      if (item.document.status === 'COMPLETED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This document is complete, so its extracted data can no longer be changed.',
        });
      }

      const current =
        item.extractedData && typeof item.extractedData === 'object' && !Array.isArray(item.extractedData)
          ? { ...(item.extractedData as Record<string, unknown>) }
          : {};

      const before = current[input.field];
      const previousValue = before === null || before === undefined ? null : String(before);
      const next = input.value.trim();

      // An empty value removes the key rather than storing "". A rule written
      // as "PO number is missing" tests for absence, and an empty string is
      // present — so storing one would quietly satisfy the rule it should trip.
      if (next === '') {
        delete current[input.field];
      } else {
        current[input.field] = next;
      }

      await prisma.$transaction([
        prisma.signatureInboxItem.update({
          where: { id: item.id },
          data: { extractedData: current as never },
        }),
        prisma.inboxFieldEdit.create({
          data: {
            inboxItemId: item.id,
            field: input.field,
            previousValue,
            newValue: next === '' ? null : next,
            editedById: ctx.user.id,
          },
        }),
      ]);

      // Correcting a misread vendor or total is exactly how a duplicate becomes
      // findable — the copy that OCR read as "Northgate Consuiting" only matches
      // the original once someone fixes the spelling. Re-run outside the
      // transaction: the correction is saved either way.
      if (affectsDuplicateCheck(input.field)) {
        await flagDuplicateInboxItem(item.id);
      }

      return { field: input.field, value: next === '' ? null : next };
    }),

  /**
   * Read an attached file with OCR — the purchase order a signer attached, in
   * practice. Explicitly triggered by an org member; see `runAttachmentOcr` for
   * why this is never automatic.
   */
  readAttachment: authenticatedProcedure
    .input(
      z.object({
        supportingFileId: z.string(),
        templateId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      // Checked here so an unknown or out-of-tenant id answers 404 rather than
      // surfacing the runner's throw as an opaque 500.
      const exists = await prisma.documentSupportingFile.findFirst({
        where: { id: input.supportingFileId, document: { organizationId: membership.organizationId } },
        select: { id: true },
      });

      if (!exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attachment not found.' });
      }

      return runAttachmentOcr({
        supportingFileId: input.supportingFileId,
        organizationId: membership.organizationId,
        userId: ctx.user.id,
        templateId: input.templateId,
      });
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

      // Refuse while OCR is still reading. The UI hides the button, but that alone
      // is not a guard: this page can already be open when a re-read starts, and
      // the endpoint is reachable directly. Sending here would put an invoice in
      // front of a signer whose figures nobody could have checked, because they
      // were not extracted yet — and the extraction that lands afterwards would
      // overwrite what was sent.
      if (item.status === 'OCR_PROCESSING') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'OCR is still reading this document. Wait for it to finish before sending.',
        });
      }

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

      // Enforce the organization's DOCUMENT_SEND rules before anything is
      // written, so a refusal (a duplicate invoice, a missing PO) leaves no
      // half-sent state. Fails open — see `evaluateGate`.
      const verdict = await evaluateGate({
        gate: 'DOCUMENT_SEND',
        subject: {
          organizationId: membership.organizationId,
          entityType: 'Document',
          entityId: String(item.documentId),
          actorUserId: ctx.user.id,
        },
      });

      if (!verdict.allowed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: describeBlocks(verdict) });
      }

      // Emailed-in documents carry no field layout — without a signature field
      // the recipient opens the document and has nothing to sign.
      await ensureSignatureFields({ documentId: item.documentId });

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
   * Hand a signing request to a different person.
   *
   * Scoped to the item's organization, like everything else on this router — the
   * inbox is a shared queue, so any member who can send an invoice for signature
   * can also correct who it went to. The consequential parts (invalidating the
   * previous signer's link, clearing what they entered, emailing the new signer)
   * all live in `reassignRecipient`.
   */
  reassignRecipient: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        recipientId: z.number(),
        email: z.string().email(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const item = await prisma.signatureInboxItem.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        select: { id: true, documentId: true },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox item not found.' });

      const result = await reassignRecipient({
        documentId: item.documentId,
        recipientId: input.recipientId,
        email: input.email,
        name: input.name,
        actorUserId: ctx.user.id,
        requestMetadata: ctx.metadata.requestMetadata,
      });

      // The queue shows who each document is waiting on, so that column is now
      // stale for everyone looking at it.
      publishInboxEvent(membership.organizationId, { type: 'update', inboxItemId: item.id });

      return result;
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

  /**
   * SLA performance across the inbox, for the dashboard.
   *
   * Computed on read from the audit log rather than denormalised columns, so it
   * covers items that predate SLA being enabled. At inbox sizes far beyond a
   * hand-managed AP queue this should move to stored `slaDueAt`/`slaState`
   * columns maintained on status change.
   */
  slaStats: authenticatedProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const org = await prisma.organization.findUnique({
        where: { id: membership.organizationId },
        select: SLA_ORG_SELECT,
      });

      if (!org?.slaEnabled) {
        return { enabled: false as const };
      }

      const since = new Date(Date.now() - (input?.days ?? 30) * 24 * 60 * 60 * 1000);

      const scope = {
        organizationId: membership.organizationId,
        createdAt: { gte: since },
        status: { not: 'ARCHIVED' as const },
      };

      // Bounded so one enormous organization cannot make this query unbounded.
      // The count alongside it is what lets the page say so out loud instead of
      // quietly reporting a percentage of reality as if it were all of it.
      const [items, inRange, archived] = await Promise.all([
        prisma.signatureInboxItem.findMany({
          where: scope,
          select: {
            id: true,
            createdAt: true,
            receivedAt: true,
            senderEmail: true,
            subject: true,
            extractedData: true,
            documentId: true,
            document: { select: { status: true, completedAt: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: SLA_ITEM_LIMIT,
        }),
        prisma.signatureInboxItem.count({ where: scope }),
        // Archived items are left out of the measurement, and archiving is not
        // SLA-aware — so archiving a breach quietly raises the score for every
        // past window. Count them so the page can own that rather than hide it.
        prisma.signatureInboxItem.count({
          where: {
            organizationId: membership.organizationId,
            createdAt: { gte: since },
            status: 'ARCHIVED',
          },
        }),
      ]);

      const results = await evaluateItemsSla({
        organizationId: membership.organizationId,
        org,
        items,
      });

      /**
       * A leg that is past target AND still running.
       *
       * `state === 'breached'` on its own is not enough: it is also the state of
       * an invoice that was sent, just sent late. Those are finished work. Only
       * this predicate describes something a person can still do anything about.
       */
      const isOpenBreach = (leg: { state: string; settled: boolean }) =>
        leg.state === 'breached' && !leg.settled;

      const leg = (
        // Nullable because the signing clock does not exist until the document is
        // sent. An item with no clock is not "untracked" — it is not yet in this
        // leg at all, and counting it either way would misstate the denominator.
        pick: (r: (typeof results)[number]) => { state: string; settled: boolean } | null,
      ) => {
        const tracked = results.filter((r) => {
          const value = pick(r);
          return value !== null && value.state !== 'untracked';
        });
        const state = (r: (typeof results)[number]) => pick(r)?.state;
        const met = tracked.filter((r) => state(r) === 'met').length;
        const breached = tracked.filter((r) => state(r) === 'breached').length;
        const atRisk = tracked.filter((r) => state(r) === 'at-risk').length;
        const onTrack = tracked.filter((r) => state(r) === 'on-track').length;
        const decided = met + breached;

        return {
          tracked: tracked.length,
          met,
          breached,
          /** Of those breaches, the ones still outstanding right now. */
          breachedOpen: tracked.filter((r) => {
            const value = pick(r);
            return value !== null && isOpenBreach(value);
          }).length,
          atRisk,
          onTrack,
          // Only decided work can be scored; on-track items aren't yet pass or fail.
          onTimeRate: decided > 0 ? met / decided : null,
        };
      };

      const internal = leg((r) => r.internal);
      const endToEnd = leg((r) => r.endToEnd);
      const signing = leg((r) => r.signing);
      /** Sent, unsigned, and not yet judged either way — the population this leg can grow into. */
      const awaitingSignature = results.filter((r) => r.signing !== null && !r.signing.settled).length;

      // ── Organization health ────────────────────────────────────────────
      // Counts a currently-overdue open item as a failure, not as "pending".
      // A queue of items that are already late is not healthy just because
      // nobody has finished them yet — that framing is how a backlog hides.
      const met = internal.met + endToEnd.met;
      const failed = internal.breached + endToEnd.breached;
      const judged = met + failed;
      const score = judged > 0 ? Math.round((met / judged) * 100) : null;

      const band: 'healthy' | 'watch' | 'critical' | 'unknown' =
        score === null ? 'unknown' : score >= 90 ? 'healthy' : score >= 75 ? 'watch' : 'critical';

      // ── Trend ──────────────────────────────────────────────────────────
      // Bucketed by the day the invoice ARRIVED, so a bucket answers "how well
      // did we handle what came in that day" rather than smearing one slow item
      // across every day it stayed open.
      const days = input?.days ?? 30;
      const bucketCount = Math.max(2, Math.ceil(days / (days <= 14 ? 1 : 7)));

      // Buckets divide the window that was actually queried, rather than being
      // laid out in fixed 7-day steps. Fixed steps overshoot whenever the range
      // is not a multiple of the step — 30 days needs 5 seven-day buckets, which
      // reach back 35 days — and the extra 5 days were never fetched, so the
      // leftmost bar would be drawn from a window that is partly empty by
      // construction and read as a genuine dip.
      const windowStart = since.getTime();
      const windowEnd = Date.now();
      const msPerBucket = (windowEnd - windowStart) / bucketCount;

      const buckets = Array.from({ length: bucketCount }, (_, i) => {
        const start = windowStart + i * msPerBucket;
        return { start, end: start + msPerBucket, met: 0, breached: 0 };
      });

      const itemsById = new Map(items.map((i) => [i.id, i]));

      for (const r of results) {
        const item = itemsById.get(r.inboxItemId);
        if (!item) continue;

        const at = slaClockStart(item).getTime();
        // `>=` on the last bucket so an item arriving this instant is not dropped
        // by the exclusive upper bound.
        const bucket =
          buckets.find((b) => at >= b.start && at < b.end) ??
          (at >= buckets[buckets.length - 1].start ? buckets[buckets.length - 1] : undefined);
        if (!bucket) continue;

        for (const state of [r.internal.state, r.endToEnd.state, r.signing?.state]) {
          if (state === 'met') bucket.met += 1;
          if (state === 'breached') bucket.breached += 1;
        }
      }

      const trend = buckets.map((b) => {
        const total = b.met + b.breached;
        return {
          // Both ends, because a bucket is a span of several days — labelling it
          // with only its start date read as "this happened on the 4th".
          from: new Date(b.start).toISOString().slice(0, 10),
          to: new Date(b.end - 1).toISOString().slice(0, 10),
          onTimeRate: total > 0 ? b.met / total : null,
          met: b.met,
          breached: b.breached,
        };
      });

      // Direction from the first and last buckets that actually have data —
      // empty buckets carry no signal and would fake a slope.
      //
      // Both endpoints must clear a minimum sample. Without that floor a single
      // invoice arriving today is a whole endpoint: one item sent outside
      // working hours (0 business minutes, therefore "met") sat opposite a
      // 13-outcome bucket and announced "Improving +77 pts across the window".
      const MIN_BUCKET_SAMPLE = 3;
      const scored = trend.filter(
        (t) => t.onTimeRate !== null && t.met + t.breached >= MIN_BUCKET_SAMPLE,
      );
      const firstRate = scored.at(0)?.onTimeRate ?? null;
      const lastRate = scored.at(-1)?.onTimeRate ?? null;
      const deltaPoints =
        firstRate !== null && lastRate !== null && scored.length >= 2
          ? Math.round((lastRate - firstRate) * 100)
          : null;

      const direction: 'improving' | 'steady' | 'declining' | 'unknown' =
        deltaPoints === null ? 'unknown' : deltaPoints >= 5 ? 'improving' : deltaPoints <= -5 ? 'declining' : 'steady';

      /** The span the slope was actually measured over, for an honest caption. */
      const trendSpan =
        deltaPoints !== null ? { from: scored[0].from, to: scored[scored.length - 1].to } : null;

      // ── Forecast ───────────────────────────────────────────────────────
      // Deliberately not a model. Open items already past target WILL breach,
      // and at-risk ones are past the warning threshold with the clock running —
      // that is a countable near-certainty, not a prediction, and it is the
      // number someone can actually act on this morning.
      //
      // Every count here is restricted to work whose clock is STILL RUNNING. An
      // earlier version counted any breached leg, which swept in invoices that
      // had already been sent and even ones already fully signed, and then
      // labelled the total "will miss without action" — advertising finished
      // work as a to-do list.
      // The signing leg belongs in every count here. An invoice sitting unsigned
      // past its target is precisely "will miss without action" — the action is
      // chasing the signer rather than processing the invoice, but it is still
      // work somebody has to do today.
      const anyOpenBreach = (r: (typeof results)[number]) =>
        isOpenBreach(r.internal) || isOpenBreach(r.endToEnd) || (r.signing ? isOpenBreach(r.signing) : false);

      const openBreached = results.filter(anyOpenBreach).length;
      const openAtRisk = results.filter(
        (r) =>
          (r.internal.state === 'at-risk' ||
            r.endToEnd.state === 'at-risk' ||
            r.signing?.state === 'at-risk') &&
          !anyOpenBreach(r),
      ).length;
      /** Missed target, but the work is done — history, not something to chase. */
      const finishedLate = results.filter(
        (r) =>
          !anyOpenBreach(r) &&
          ((r.internal.state === 'breached' && r.internal.settled) ||
            (r.endToEnd.state === 'breached' && r.endToEnd.settled) ||
            (r.signing?.state === 'breached' && r.signing.settled)),
      ).length;

      // ── Per-vendor ─────────────────────────────────────────────────────
      const vendorRows = new Map<
        string,
        {
          vendor: string;
          total: number;
          met: number;
          breached: number;
          openBreached: number;
          minutes: number[];
        }
      >();

      for (const r of results) {
        // Group on the CORE name — the same identity test the directory lookup
        // uses, so a vendor is one row here exactly when it is one record there.
        // OCR spells the same company differently between reads: "FUTURE EDGE
        // TECHNOLOGY INC" and "Future Edge Technology Inc." were rendering as
        // two vendors, one at 0% and one at 100%, at opposite ends of a table
        // sorted worst-first.
        const key = r.vendorLabel ? vendorCoreName(r.vendorLabel) || 'unknown' : 'unknown';
        const row = vendorRows.get(key) ?? {
          vendor: r.vendorLabel ?? 'Unknown vendor',
          total: 0,
          met: 0,
          breached: 0,
          openBreached: 0,
          minutes: [],
        };
        row.total += 1;
        if (r.internal.state === 'met') row.met += 1;
        if (r.internal.state === 'breached') row.breached += 1;
        if (isOpenBreach(r.internal)) row.openBreached += 1;

        // Average over every leg whose clock has STOPPED, late ones included.
        // Averaging only the invoices that met target reports the fastest time a
        // vendor ever managed as its typical one: in this deployment Northgate
        // showed "0h avg turnaround" next to three breaches, because its single
        // on-time invoice arrived and went out after hours (0 business minutes)
        // while the three that took ~25h were excluded for having been late.
        // Still-running items are excluded because they have no turnaround yet.
        if (r.internal.settled && (r.internal.state === 'met' || r.internal.state === 'breached')) {
          row.minutes.push(r.internal.elapsedMinutes);
        }

        vendorRows.set(key, row);
      }

      const vendors = [...vendorRows.values()]
        .map((row) => {
          const decided = row.met + row.breached;
          return {
            vendor: row.vendor,
            total: row.total,
            met: row.met,
            breached: row.breached,
            openBreached: row.openBreached,
            onTimeRate: decided > 0 ? row.met / decided : null,
            avgInternalMinutes: row.minutes.length
              ? Math.round(row.minutes.reduce((a, b) => a + b, 0) / row.minutes.length)
              : null,
            /** How many finished invoices that average is based on. */
            avgSampleSize: row.minutes.length,
          };
        })
        .sort((a, b) => b.breached - a.breached || b.total - a.total);

      // Past the internal target and still not sent. Sorted worst-first so the
      // capped list shows the invoices that have been waiting longest, and the
      // count is reported separately from the list — reading `.length` off a
      // sliced array told the user "15 overdue" whenever there were more.
      const overdueUnsent = results
        .filter((r) => isOpenBreach(r.internal) && r.internal.dueAt !== null)
        .map((r) => ({
          inboxItemId: r.inboxItemId,
          vendor: r.vendorLabel,
          overdueByMinutes: r.internal.elapsedMinutes - r.internal.targetMinutes,
        }))
        .sort((a, b) => b.overdueByMinutes - a.overdueByMinutes);

      // The same list for the other half of the journey: sent, past the signing
      // target, still unsigned. Kept apart from `overdueUnsent` because the two
      // need different people doing different things, and one merged list of
      // "late invoices" is how that distinction gets lost.
      const overdueUnsigned = results
        .flatMap((r) => {
          const leg = r.signing;

          if (!leg || !isOpenBreach(leg) || leg.dueAt === null) {
            return [];
          }

          return [
            {
              inboxItemId: r.inboxItemId,
              vendor: r.vendorLabel,
              sentAt: r.sentAt,
              overdueByMinutes: leg.elapsedMinutes - leg.targetMinutes,
            },
          ];
        })
        .sort((a, b) => b.overdueByMinutes - a.overdueByMinutes);

      return {
        enabled: true as const,
        days,
        total: results.length,
        /** Set when the window holds more items than were evaluated. */
        truncated: inRange > items.length ? { evaluated: items.length, inRange } : null,
        health: { score, band, direction, deltaPoints, judged, trendSpan },
        /** How many items in this window fall back to the ingest instant. */
        ingestTimed: results.filter((r) => r.startedFrom === 'ingest').length,
        internal,
        endToEnd,
        signing,
        /** Sent and still unsigned, whether or not a signing target is set. */
        awaitingSignature,
        trend,
        vendors,
        forecast: {
          openBreached,
          openAtRisk,
          willMissWithoutAction: openBreached + openAtRisk,
          finishedLate,
        },
        /** Excluded from at least one clock for want of a target. */
        untracked: results.filter(
          (r) => r.internal.state === 'untracked' || r.endToEnd.state === 'untracked',
        ).length,
        archived,
        breachedOpen: {
          /** The true number outstanding — never the length of the capped list. */
          count: overdueUnsent.length,
          items: overdueUnsent.slice(0, OVERDUE_LIST_LIMIT),
        },
        unsignedOpen: {
          count: overdueUnsigned.length,
          items: overdueUnsigned.slice(0, OVERDUE_LIST_LIMIT),
        },
      };
    }),

  /** Pull new messages from this org's WorkHub inbox now (also runs on the cron). */
  fetchNow: authenticatedProcedure.mutation(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return pollWorkHubInboxForOrg(membership.organizationId);
  }),

  /**
   * Realtime-mail status.
   *
   * Three separate things have to be true before mail arrives by push, and an
   * admin needs to see which one is missing: WorkHub holds a watch, we hold the
   * Svix signing secret, and our address is reachable from the internet. Showing
   * one "enabled" boolean would hide the usual failure — a watch registered but
   * the secret never copied out of the portal, which fails closed and silently.
   */
  realtimeMailStatus: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);

    const organization = await prisma.organization.findUnique({
      where: { id: membership.organizationId },
      select: {
        workhubApiKey: true,
        workhubMailboxId: true,
        workhubWebhookId: true,
        workhubWebhookSecret: true,
      },
    });

    const appUrl = (env('NEXT_PUBLIC_WEBAPP_URL') ?? '').trim();
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)/i.test(appUrl);

    return {
      registered: Boolean(organization?.workhubWebhookId),
      hasSecret: Boolean(organization?.workhubWebhookSecret),
      canRegister: Boolean(organization?.workhubApiKey && organization?.workhubMailboxId),
      isAdmin: membership.role === OrganizationRole.ORG_ADMIN,
      /*
        Svix delivers over the public internet. On a localhost deployment
        registration succeeds and then nothing ever arrives, which is a
        miserable thing to debug — so say it up front.
      */
      deliverable: Boolean(appUrl) && !isLocal,
      endpointUrl: appUrl ? `${appUrl.replace(/\/$/, '')}/api/webhooks/workhub-mail` : null,
    };
  }),

  /** Register this org's mailbox for push notifications. Returns the Svix portal URL. */
  enableRealtimeMail: authenticatedProcedure.mutation(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);

    if (membership.role !== OrganizationRole.ORG_ADMIN) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only an organization admin can change mail delivery.',
      });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: membership.organizationId },
      select: { workhubApiKey: true, workhubApiBase: true, workhubMailboxId: true },
    });

    if (!organization?.workhubApiKey || !organization.workhubMailboxId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Set the WorkHub API key and mailbox for this organization first.',
      });
    }

    try {
      const watch = await registerMailWatch({
        apiKey: organization.workhubApiKey,
        apiBase: organization.workhubApiBase,
        mailboxId: organization.workhubMailboxId,
      });

      await prisma.organization.update({
        where: { id: membership.organizationId },
        data: { workhubWebhookId: watch.id },
      });

      // The signing secret is not in this response — it only exists inside the
      // Svix portal, so an admin has to fetch it by hand and paste it back.
      return { watchId: watch.id, portalUrl: watch.portalUrl };
    } catch (err) {
      if (err instanceof WorkHubWebhookError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }),

  /** Store the Svix signing secret copied out of the portal. */
  setRealtimeMailSecret: authenticatedProcedure
    .input(z.object({ secret: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      if (membership.role !== OrganizationRole.ORG_ADMIN) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an organization admin can change mail delivery.',
        });
      }

      const secret = input.secret?.trim() || null;

      if (secret !== null && !secret.startsWith('whsec_')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That does not look like a Svix signing secret — they begin with "whsec_".',
        });
      }

      await prisma.organization.update({
        where: { id: membership.organizationId },
        data: { workhubWebhookSecret: secret },
      });

      return { hasSecret: secret !== null };
    }),
});
