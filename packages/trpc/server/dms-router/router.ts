import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';
import {
  ZCreateBinSchema,
  ZCreateCabinetSchema,
  ZCreateClassificationSchema,
  ZCreateCommentSchema,
  ZCreateDmsDocumentSchema,
  ZCreateDocumentTypeSchema,
  ZCreateFilingRuleSchema,
  ZCreateLocationSchema,
  ZCreateRetrievalRequestSchema,
  ZCreateShelfSchema,
  ZCreateTagSchema,
  ZCreateVersionSchema,
  ZSearchDmsDocumentsSchema,
  ZUpdateBinSchema,
  ZUpdateCabinetSchema,
  ZUpdateDmsDocumentSchema,
  ZUpdateLocationSchema,
  ZUpdateRetrievalRequestSchema,
  ZUpdateShelfSchema,
} from './schema';

// Helper to generate reference numbers
const generateRefNumber = () => {
  const prefix = 'DMS';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

export const dmsRouter = router({
  // ═══════════════════════════════════════════
  // LOCATIONS
  // ═══════════════════════════════════════════

  getLocations: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.dmsLocation.findMany({
      where: { userId: ctx.user.id },
      include: {
        cabinets: {
          include: {
            shelves: {
              include: {
                bins: {
                  include: { _count: { select: { documents: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }),

  createLocation: authenticatedProcedure
    .input(ZCreateLocationSchema)
    .mutation(async ({ ctx, input }) => {
      return prisma.dmsLocation.create({
        data: { ...input, userId: ctx.user.id },
      });
    }),

  updateLocation: authenticatedProcedure
    .input(ZUpdateLocationSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return prisma.dmsLocation.update({
        where: { id, userId: ctx.user.id },
        data,
      });
    }),

  deleteLocation: authenticatedProcedure
    .input(ZUpdateLocationSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      return prisma.dmsLocation.delete({
        where: { id: input.id, userId: ctx.user.id },
      });
    }),

  // ═══════════════════════════════════════════
  // CABINETS
  // ═══════════════════════════════════════════

  createCabinet: authenticatedProcedure
    .input(ZCreateCabinetSchema)
    .mutation(async ({ input }) => {
      return prisma.dmsCabinet.create({ data: input });
    }),

  updateCabinet: authenticatedProcedure
    .input(ZUpdateCabinetSchema)
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.dmsCabinet.update({ where: { id }, data });
    }),

  deleteCabinet: authenticatedProcedure
    .input(ZUpdateCabinetSchema.pick({ id: true }))
    .mutation(async ({ input }) => {
      return prisma.dmsCabinet.delete({ where: { id: input.id } });
    }),

  // ═══════════════════════════════════════════
  // SHELVES
  // ═══════════════════════════════════════════

  createShelf: authenticatedProcedure
    .input(ZCreateShelfSchema)
    .mutation(async ({ input }) => {
      return prisma.dmsShelf.create({ data: input });
    }),

  updateShelf: authenticatedProcedure
    .input(ZUpdateShelfSchema)
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.dmsShelf.update({ where: { id }, data });
    }),

  deleteShelf: authenticatedProcedure
    .input(ZUpdateShelfSchema.pick({ id: true }))
    .mutation(async ({ input }) => {
      return prisma.dmsShelf.delete({ where: { id: input.id } });
    }),

  // ═══════════════════════════════════════════
  // BINS
  // ═══════════════════════════════════════════

  createBin: authenticatedProcedure
    .input(ZCreateBinSchema)
    .mutation(async ({ input }) => {
      return prisma.dmsBin.create({ data: input });
    }),

  updateBin: authenticatedProcedure
    .input(ZUpdateBinSchema)
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.dmsBin.update({ where: { id }, data });
    }),

  deleteBin: authenticatedProcedure
    .input(ZUpdateBinSchema.pick({ id: true }))
    .mutation(async ({ input }) => {
      return prisma.dmsBin.delete({ where: { id: input.id } });
    }),

  // ═══════════════════════════════════════════
  // DOCUMENT TYPES
  // ═══════════════════════════════════════════

  getDocumentTypes: authenticatedProcedure.query(async () => {
    return prisma.dmsDocumentType.findMany({ orderBy: { name: 'asc' } });
  }),

  createDocumentType: authenticatedProcedure
    .input(ZCreateDocumentTypeSchema)
    .mutation(async ({ input }) => {
      return prisma.dmsDocumentType.create({ data: input });
    }),

  deleteDocumentType: authenticatedProcedure
    .input(ZCreateDocumentTypeSchema.pick({ name: true }))
    .mutation(async ({ input }) => {
      // Find by name and delete
      const docType = await prisma.dmsDocumentType.findFirst({ where: { name: input.name } });
      if (!docType) throw new TRPCError({ code: 'NOT_FOUND' });
      return prisma.dmsDocumentType.delete({ where: { id: docType.id } });
    }),

  // ═══════════════════════════════════════════
  // CLASSIFICATIONS
  // ═══════════════════════════════════════════

  getClassifications: authenticatedProcedure.query(async () => {
    return prisma.dmsClassification.findMany({
      include: { children: true },
      where: { parentId: null },
      orderBy: { name: 'asc' },
    });
  }),

  createClassification: authenticatedProcedure
    .input(ZCreateClassificationSchema)
    .mutation(async ({ input }) => {
      return prisma.dmsClassification.create({ data: input });
    }),

  // ═══════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════

  getTags: authenticatedProcedure.query(async () => {
    return prisma.dmsTag.findMany({ orderBy: { name: 'asc' } });
  }),

  createTag: authenticatedProcedure
    .input(ZCreateTagSchema)
    .mutation(async ({ input }) => {
      return prisma.dmsTag.create({
        data: input,
      });
    }),

  // ═══════════════════════════════════════════
  // DOCUMENTS (Core CRUD)
  // ═══════════════════════════════════════════

  createDocument: authenticatedProcedure
    .input(ZCreateDmsDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      const { tagIds, ...data } = input;

      const document = await prisma.dmsDocument.create({
        data: {
          ...data,
          referenceNumber: generateRefNumber(),
          uploadedById: ctx.user.id,
          retentionDate: data.retentionDate ? new Date(data.retentionDate) : undefined,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
          tags: tagIds
            ? { create: tagIds.map((tagId) => ({ tagId })) }
            : undefined,
        },
      });

      // Audit log
      await prisma.dmsAuditLog.create({
        data: {
          action: 'DOCUMENT_UPLOADED',
          documentId: document.id,
          userId: ctx.user.id,
          details: `Document "${document.title}" uploaded`,
        },
      });

      return document;
    }),

  getDocument: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }))
    .query(async ({ ctx, input }) => {
      return prisma.dmsDocument.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          bin: { include: { shelf: { include: { cabinet: { include: { location: true } } } } } },
          documentType: true,
          classification: true,
          tags: { include: { tag: true } },
          versions: { orderBy: { version: 'desc' } },
          uploadedBy: { select: { id: true, name: true, email: true } },
          checkedOutBy: { select: { id: true, name: true, email: true } },
          favorites: { where: { userId: ctx.user.id } },
          linksAsSource: { include: { targetDocument: { select: { id: true, title: true, referenceNumber: true, status: true } } } },
          linksAsTarget: { include: { sourceDocument: { select: { id: true, title: true, referenceNumber: true, status: true } } } },
          shareLinks: { orderBy: { createdAt: 'desc' } },
          workflows: {
            include: {
              steps: { include: { assignedTo: { select: { id: true, name: true, email: true } } }, orderBy: { step: 'asc' } },
              initiatedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          comments: {
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    }),

  updateDocument: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, tagIds, ...data } = input;

      const updateData: Record<string, unknown> = { ...data };

      if (data.retentionDate !== undefined) {
        updateData.retentionDate = data.retentionDate ? new Date(data.retentionDate) : null;
      }
      if (data.expiryDate !== undefined) {
        updateData.expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
      }

      // Update tags if provided
      if (tagIds) {
        await prisma.dmsDocumentTag.deleteMany({ where: { documentId: id } });
        await prisma.dmsDocumentTag.createMany({
          data: tagIds.map((tagId) => ({ documentId: id, tagId })),
        });
      }

      const document = await prisma.dmsDocument.update({
        where: { id },
        data: updateData,
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'DOCUMENT_UPDATED',
          documentId: id,
          userId: ctx.user.id,
          details: `Document "${document.title}" updated`,
        },
      });

      return document;
    }),

  deleteDocument: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const doc = await prisma.dmsDocument.findUniqueOrThrow({ where: { id: input.id } });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'DOCUMENT_DELETED',
          documentId: input.id,
          userId: ctx.user.id,
          details: `Document "${doc.title}" deleted`,
        },
      });

      return prisma.dmsDocument.delete({ where: { id: input.id } });
    }),

  searchDocuments: authenticatedProcedure
    .input(ZSearchDmsDocumentsSchema)
    .query(async ({ ctx, input }) => {
      const {
        query,
        status,
        confidentiality,
        documentTypeId,
        classificationId,
        binId,
        tagIds,
        dateFrom,
        dateTo,
        page,
        perPage,
        teamId,
      } = input;

      const where: Record<string, unknown> = {
        uploadedById: ctx.user.id,
      };

      if (teamId) where.teamId = teamId;
      if (status) where.status = status;
      if (confidentiality) where.confidentiality = confidentiality;
      if (documentTypeId) where.documentTypeId = documentTypeId;
      if (classificationId) where.classificationId = classificationId;
      if (binId) where.binId = binId;

      if (query) {
        where.OR = [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { ocrText: { contains: query, mode: 'insensitive' } },
          { referenceNumber: { contains: query, mode: 'insensitive' } },
          { fileName: { contains: query, mode: 'insensitive' } },
        ];
      }

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
        if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
      }

      if (tagIds && tagIds.length > 0) {
        where.tags = { some: { tagId: { in: tagIds } } };
      }

      const [data, count] = await Promise.all([
        prisma.dmsDocument.findMany({
          where: where as never,
          include: {
            documentType: true,
            classification: true,
            tags: { include: { tag: true } },
            bin: { include: { shelf: { include: { cabinet: { include: { location: true } } } } } },
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        prisma.dmsDocument.count({ where: where as never }),
      ]);

      return {
        data,
        count,
        page,
        perPage,
        totalPages: Math.ceil(count / perPage),
      };
    }),

  // ═══════════════════════════════════════════
  // RETRIEVAL REQUESTS
  // ═══════════════════════════════════════════

  getRetrievalRequests: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.dmsRetrievalRequest.findMany({
      where: {
        OR: [{ requestedById: ctx.user.id }, { approvedById: ctx.user.id }],
      },
      include: {
        document: true,
        requestedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  createRetrievalRequest: authenticatedProcedure
    .input(ZCreateRetrievalRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const request = await prisma.dmsRetrievalRequest.create({
        data: {
          ...input,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          requestedById: ctx.user.id,
        },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'RETRIEVAL_REQUESTED',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: `Retrieval request created: ${input.reason || 'No reason specified'}`,
        },
      });

      return request;
    }),

  updateRetrievalRequest: authenticatedProcedure
    .input(ZUpdateRetrievalRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const request = await prisma.dmsRetrievalRequest.update({
        where: { id },
        data: {
          ...data,
          returnDate: data.returnDate ? new Date(data.returnDate) : undefined,
          approvedById: data.status === 'APPROVED' ? ctx.user.id : undefined,
        },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: `RETRIEVAL_${data.status}`,
          documentId: request.documentId,
          userId: ctx.user.id,
          details: `Retrieval request ${data.status.toLowerCase()}`,
        },
      });

      return request;
    }),

  // ═══════════════════════════════════════════
  // FILING RULES
  // ═══════════════════════════════════════════

  getFilingRules: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.dmsFilingRule.findMany({
      where: { createdBy: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    });
  }),

  createFilingRule: authenticatedProcedure
    .input(ZCreateFilingRuleSchema)
    .mutation(async ({ ctx, input }) => {
      const { teamId, ...rest } = input;
      return prisma.dmsFilingRule.create({
        data: {
          ...rest,
          condition: rest.condition ?? {},
          creator: { connect: { id: ctx.user.id } },
          ...(teamId ? { team: { connect: { id: teamId } } } : {}),
        },
      });
    }),

  // ═══════════════════════════════════════════
  // VERSIONS
  // ═══════════════════════════════════════════

  createVersion: authenticatedProcedure
    .input(ZCreateVersionSchema)
    .mutation(async ({ ctx, input }) => {
      const latestVersion = await prisma.dmsVersion.findFirst({
        where: { documentId: input.documentId },
        orderBy: { version: 'desc' },
      });

      const version = await prisma.dmsVersion.create({
        data: {
          ...input,
          version: (latestVersion?.version ?? 0) + 1,
          uploadedById: ctx.user.id,
        },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'VERSION_CREATED',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: `Version ${version.version} uploaded`,
        },
      });

      return version;
    }),

  // ═══════════════════════════════════════════
  // COMMENTS
  // ═══════════════════════════════════════════

  createComment: authenticatedProcedure
    .input(ZCreateCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const comment = await prisma.dmsComment.create({
        data: { ...input, userId: ctx.user.id },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'COMMENT_ADDED',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: `Comment added`,
        },
      });

      return comment;
    }),

  // ═══════════════════════════════════════════
  // CHECK-OUT / CHECK-IN
  // ═══════════════════════════════════════════

  checkoutDocument: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }).extend({
      notes: ZCreateCommentSchema.shape.text.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const doc = await prisma.dmsDocument.findUniqueOrThrow({ where: { id: input.id } });

      if (doc.checkedOut) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Document is already checked out',
        });
      }

      const updated = await prisma.dmsDocument.update({
        where: { id: input.id },
        data: {
          checkedOut: true,
          checkedOutById: ctx.user.id,
          checkedOutAt: new Date(),
          checkoutNotes: input.notes,
        },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'DOCUMENT_CHECKED_OUT',
          documentId: input.id,
          userId: ctx.user.id,
          details: `Document checked out${input.notes ? `: ${input.notes}` : ''}`,
        },
      });

      return updated;
    }),

  checkinDocument: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }).extend({
      notes: ZCreateCommentSchema.shape.text.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const doc = await prisma.dmsDocument.findUniqueOrThrow({ where: { id: input.id } });

      if (!doc.checkedOut) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Document is not checked out',
        });
      }

      const updated = await prisma.dmsDocument.update({
        where: { id: input.id },
        data: {
          checkedOut: false,
          checkedOutById: null,
          checkedOutAt: null,
          checkoutNotes: null,
        },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'DOCUMENT_CHECKED_IN',
          documentId: input.id,
          userId: ctx.user.id,
          details: `Document checked in${input.notes ? `: ${input.notes}` : ''}`,
        },
      });

      return updated;
    }),

  // ═══════════════════════════════════════════
  // RETENTION & DISPOSAL
  // ═══════════════════════════════════════════

  getRetentionDue: authenticatedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    return prisma.dmsDocument.findMany({
      where: {
        uploadedById: ctx.user.id,
        retentionDate: { lte: now },
        disposalStatus: { in: ['NOT_DUE', 'DUE_FOR_REVIEW'] },
        status: { not: 'DESTROYED' },
      },
      include: {
        documentType: true,
        classification: true,
        bin: { include: { shelf: { include: { cabinet: { include: { location: true } } } } } },
      },
      orderBy: { retentionDate: 'asc' },
    });
  }),

  updateDisposal: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }).extend({
      disposalStatus: z.enum(['NOT_DUE', 'DUE_FOR_REVIEW', 'APPROVED_FOR_DISPOSAL', 'DISPOSED', 'RETAINED']),
      disposalNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, disposalStatus, disposalNotes } = input;

      const data: Record<string, unknown> = {
        disposalStatus,
        disposalNotes,
      };

      if (disposalStatus === 'APPROVED_FOR_DISPOSAL') {
        data.disposalApprovedById = ctx.user.id;
      }

      if (disposalStatus === 'DISPOSED') {
        data.disposalDate = new Date();
        data.status = 'DESTROYED';
      }

      if (disposalStatus === 'RETAINED') {
        // Extend retention by 1 year
        data.retentionDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }

      const doc = await prisma.dmsDocument.update({
        where: { id },
        data: data as never,
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: `DISPOSAL_${disposalStatus}`,
          documentId: id,
          userId: ctx.user.id,
          details: `Disposal status changed to ${disposalStatus}${disposalNotes ? `: ${disposalNotes}` : ''}`,
        },
      });

      return doc;
    }),

  markLabelPrinted: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      await prisma.dmsAuditLog.create({
        data: {
          action: 'LABEL_PRINTED',
          documentId: input.id,
          userId: ctx.user.id,
          details: 'Physical label printed',
        },
      });

      return prisma.dmsDocument.update({
        where: { id: input.id },
        data: { labelPrinted: true },
      });
    }),

  // ═══════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════

  getAuditLog: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }))
    .query(async ({ input }) => {
      return prisma.dmsAuditLog.findMany({
        where: { documentId: input.id },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }),

  // ═══════════════════════════════════════════
  // DASHBOARD STATS
  // ═══════════════════════════════════════════

  getDashboardStats: authenticatedProcedure.query(async ({ ctx }) => {
    const where = { uploadedById: ctx.user.id };

    const [
      totalDocuments,
      activeDocuments,
      archivedDocuments,
      pendingRetrievals,
      totalLocations,
      recentDocuments,
      byType,
      byClassification,
    ] = await Promise.all([
      prisma.dmsDocument.count({ where }),
      prisma.dmsDocument.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.dmsDocument.count({ where: { ...where, status: 'ARCHIVED' } }),
      prisma.dmsRetrievalRequest.count({
        where: { requestedById: ctx.user.id, status: 'PENDING' },
      }),
      prisma.dmsLocation.count({ where: { userId: ctx.user.id } }),
      prisma.dmsDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { documentType: true, classification: true },
      }),
      prisma.dmsDocument.groupBy({
        by: ['documentTypeId'],
        where,
        _count: true,
      }),
      prisma.dmsDocument.groupBy({
        by: ['classificationId'],
        where,
        _count: true,
      }),
    ]);

    return {
      totalDocuments,
      activeDocuments,
      archivedDocuments,
      pendingRetrievals,
      totalLocations,
      recentDocuments,
      byType,
      byClassification,
    };
  }),

  // ═══════════════════════════════════════════
  // OCR (trigger processing)
  // ═══════════════════════════════════════════

  triggerOcr: authenticatedProcedure
    .input(ZUpdateDmsDocumentSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      // Mark as processing — actual OCR will be done by external API call
      await prisma.dmsAuditLog.create({
        data: {
          action: 'OCR_REQUESTED',
          documentId: input.id,
          userId: ctx.user.id,
          details: 'OCR processing requested',
        },
      });

      return { status: 'queued', documentId: input.id };
    }),

  updateOcrText: authenticatedProcedure
    .input(
      ZUpdateDmsDocumentSchema.pick({ id: true }).extend({
        ocrText: ZCreateDmsDocumentSchema.shape.title,
      }),
    )
    .mutation(async ({ input }) => {
      return prisma.dmsDocument.update({
        where: { id: input.id },
        data: { ocrText: input.ocrText, ocrProcessed: true },
      });
    }),

  // ═══════════════════════════════════════════
  // USER LOOKUP (for workflows)
  // ═══════════════════════════════════════════

  lookupUserByEmail: authenticatedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true, name: true, email: true },
      });
      return user;
    }),

  // ═══════════════════════════════════════════
  // APPROVAL WORKFLOWS
  // ═══════════════════════════════════════════

  createWorkflow: authenticatedProcedure
    .input(z.object({
      documentId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      steps: z.array(z.object({
        assignedToId: z.number(),
        action: z.string().default('APPROVE'),
        dueDate: z.string().datetime().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await prisma.dmsWorkflow.create({
        data: {
          name: input.name,
          description: input.description,
          documentId: input.documentId,
          initiatedById: ctx.user.id,
          status: 'IN_PROGRESS',
          steps: {
            create: input.steps.map((step, i) => ({
              step: i + 1,
              action: step.action,
              assignedToId: step.assignedToId,
              dueDate: step.dueDate ? new Date(step.dueDate) : undefined,
            })),
          },
        },
        include: { steps: true },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'WORKFLOW_CREATED',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: `Workflow "${input.name}" created with ${input.steps.length} steps`,
        },
      });

      return workflow;
    }),

  getWorkflows: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input }) => {
      return prisma.dmsWorkflow.findMany({
        where: { documentId: input.documentId },
        include: {
          steps: {
            include: { assignedTo: { select: { id: true, name: true, email: true } } },
            orderBy: { step: 'asc' },
          },
          initiatedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  getMyPendingApprovals: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.dmsWorkflowStep.findMany({
      where: { assignedToId: ctx.user.id, status: 'PENDING' },
      include: {
        workflow: {
          include: {
            document: { select: { id: true, title: true, referenceNumber: true } },
            initiatedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }),

  respondToWorkflowStep: authenticatedProcedure
    .input(z.object({
      stepId: z.string(),
      status: z.enum(['APPROVED', 'REJECTED']),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const step = await prisma.dmsWorkflowStep.findUniqueOrThrow({
        where: { id: input.stepId },
        include: { workflow: true },
      });

      if (step.assignedToId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not assigned to you' });
      }

      await prisma.dmsWorkflowStep.update({
        where: { id: input.stepId },
        data: { status: input.status, notes: input.notes, completedAt: new Date() },
      });

      if (input.status === 'REJECTED') {
        await prisma.dmsWorkflow.update({
          where: { id: step.workflowId },
          data: { status: 'REJECTED', completedAt: new Date() },
        });
      } else {
        // Check if all steps are done
        const remaining = await prisma.dmsWorkflowStep.count({
          where: { workflowId: step.workflowId, status: 'PENDING' },
        });

        if (remaining === 0) {
          await prisma.dmsWorkflow.update({
            where: { id: step.workflowId },
            data: { status: 'APPROVED', completedAt: new Date() },
          });
        } else {
          await prisma.dmsWorkflow.update({
            where: { id: step.workflowId },
            data: { currentStep: step.step + 1 },
          });
        }
      }

      await prisma.dmsAuditLog.create({
        data: {
          action: `WORKFLOW_STEP_${input.status}`,
          documentId: step.workflow.documentId,
          userId: ctx.user.id,
          details: `Step ${step.step} ${input.status.toLowerCase()}${input.notes ? `: ${input.notes}` : ''}`,
        },
      });

      return { success: true };
    }),

  // ═══════════════════════════════════════════
  // FAVORITES
  // ═══════════════════════════════════════════

  toggleFavorite: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.dmsFavorite.findUnique({
        where: { userId_documentId: { userId: ctx.user.id, documentId: input.documentId } },
      });

      if (existing) {
        await prisma.dmsFavorite.delete({ where: { id: existing.id } });
        return { favorited: false };
      }

      await prisma.dmsFavorite.create({
        data: { userId: ctx.user.id, documentId: input.documentId },
      });
      return { favorited: true };
    }),

  getFavorites: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.dmsFavorite.findMany({
      where: { userId: ctx.user.id },
      include: {
        document: {
          include: { documentType: true, classification: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  // ═══════════════════════════════════════════
  // DOCUMENT LINKS
  // ═══════════════════════════════════════════

  linkDocuments: authenticatedProcedure
    .input(z.object({
      sourceDocumentId: z.string(),
      targetDocumentId: z.string(),
      linkType: z.string().default('RELATED'),
    }))
    .mutation(async ({ ctx, input }) => {
      const link = await prisma.dmsDocumentLink.create({
        data: { ...input, createdById: ctx.user.id },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'DOCUMENT_LINKED',
          documentId: input.sourceDocumentId,
          userId: ctx.user.id,
          details: `Linked to document (${input.linkType})`,
        },
      });

      return link;
    }),

  unlinkDocuments: authenticatedProcedure
    .input(z.object({ linkId: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.dmsDocumentLink.delete({ where: { id: input.linkId } });
    }),

  getDocumentLinks: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input }) => {
      const [asSource, asTarget] = await Promise.all([
        prisma.dmsDocumentLink.findMany({
          where: { sourceDocumentId: input.documentId },
          include: { targetDocument: { select: { id: true, title: true, referenceNumber: true, status: true } } },
        }),
        prisma.dmsDocumentLink.findMany({
          where: { targetDocumentId: input.documentId },
          include: { sourceDocument: { select: { id: true, title: true, referenceNumber: true, status: true } } },
        }),
      ]);
      return { asSource, asTarget };
    }),

  // ═══════════════════════════════════════════
  // SHARE LINKS
  // ═══════════════════════════════════════════

  createShareLink: authenticatedProcedure
    .input(z.object({
      documentId: z.string(),
      password: z.string().optional(),
      expiresAt: z.string().datetime().optional(),
      maxViews: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const link = await prisma.dmsShareLink.create({
        data: {
          documentId: input.documentId,
          password: input.password,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          maxViews: input.maxViews,
          createdById: ctx.user.id,
        },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'SHARE_LINK_CREATED',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: `Share link created${input.password ? ' (password protected)' : ''}`,
        },
      });

      return link;
    }),

  getShareLinks: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input }) => {
      return prisma.dmsShareLink.findMany({
        where: { documentId: input.documentId },
        orderBy: { createdAt: 'desc' },
      });
    }),

  // ═══════════════════════════════════════════
  // COMPLIANCE TEMPLATES
  // ═══════════════════════════════════════════

  getComplianceTemplates: authenticatedProcedure.query(async () => {
    return prisma.dmsComplianceTemplate.findMany({
      orderBy: { industry: 'asc' },
    });
  }),

  createComplianceTemplate: authenticatedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      industry: z.string(),
      retentionYears: z.number(),
      disposalAction: z.string().default('ARCHIVE'),
      legalBasis: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return prisma.dmsComplianceTemplate.create({ data: input });
    }),

  // ═══════════════════════════════════════════
  // ACTIVITY FEED
  // ═══════════════════════════════════════════

  getActivityFeed: authenticatedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      return prisma.dmsAuditLog.findMany({
        where: {
          document: { uploadedById: ctx.user.id },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          document: { select: { id: true, title: true, referenceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),

  // ═══════════════════════════════════════════
  // AUTO-FILING SETTINGS
  // ═══════════════════════════════════════════

  getAutoFilingSettings: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.dmsAutoFilingSettings.findUnique({
      where: { userId: ctx.user.id },
    });
  }),

  saveAutoFilingSettings: authenticatedProcedure
    .input(z.object({
      enabled: z.boolean(),
      binId: z.string().nullable().optional(),
      documentTypeId: z.string().nullable().optional(),
      classificationId: z.string().nullable().optional(),
      confidentiality: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']).optional(),
      autoOcr: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return prisma.dmsAutoFilingSettings.upsert({
        where: { userId: ctx.user.id },
        create: {
          userId: ctx.user.id,
          ...input,
          binId: input.binId ?? undefined,
          documentTypeId: input.documentTypeId ?? undefined,
          classificationId: input.classificationId ?? undefined,
        },
        update: input,
      });
    }),

  // Auto-file a completed signed document into DMS
  autoFileSignedDocument: authenticatedProcedure
    .input(z.object({ signedDocumentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Get settings
      const settings = await prisma.dmsAutoFilingSettings.findUnique({
        where: { userId: ctx.user.id },
      });

      if (!settings?.enabled) {
        return { filed: false, reason: 'Auto-filing disabled' };
      }

      // Get the signed document
      const signedDoc = await prisma.document.findUnique({
        where: { id: input.signedDocumentId },
        include: { documentData: true },
      });

      if (!signedDoc || !signedDoc.documentData) {
        return { filed: false, reason: 'Document not found' };
      }

      // Check if already filed
      const existing = await prisma.dmsDocument.findUnique({
        where: { signedDocumentId: input.signedDocumentId },
      });

      if (existing) {
        return { filed: false, reason: 'Already filed', documentId: existing.id };
      }

      // Create DMS document
      const dmsDoc = await prisma.dmsDocument.create({
        data: {
          title: signedDoc.title,
          referenceNumber: `DMS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
          fileUrl: signedDoc.documentData.id,
          fileName: `${signedDoc.title}.pdf`,
          fileType: 'application/pdf',
          fileSize: 0,
          status: 'ACTIVE',
          format: 'DIGITAL',
          confidentiality: settings.confidentiality,
          binId: settings.binId,
          documentTypeId: settings.documentTypeId,
          classificationId: settings.classificationId,
          signedDocumentId: input.signedDocumentId,
          uploadedById: ctx.user.id,
        },
      });

      // Audit log
      await prisma.dmsAuditLog.create({
        data: {
          action: 'AUTO_FILED_FROM_SIGNING',
          documentId: dmsDoc.id,
          userId: ctx.user.id,
          details: `Auto-filed from signed document: ${signedDoc.title}`,
        },
      });

      return { filed: true, documentId: dmsDoc.id };
    }),

  // ═══════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════

  exportDocuments: authenticatedProcedure
    .input(z.object({ format: z.enum(['json']).default('json') }))
    .query(async ({ ctx }) => {
      const documents = await prisma.dmsDocument.findMany({
        where: { uploadedById: ctx.user.id },
        include: {
          documentType: true,
          classification: true,
          tags: { include: { tag: true } },
          bin: { include: { shelf: { include: { cabinet: { include: { location: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return documents.map((doc) => ({
        referenceNumber: doc.referenceNumber,
        title: doc.title,
        fileName: doc.fileName,
        fileType: doc.fileType,
        format: doc.format,
        status: doc.status,
        confidentiality: doc.confidentiality,
        documentType: doc.documentType?.name,
        classification: doc.classification?.name,
        tags: doc.tags.map((t) => t.tag.name),
        location: doc.bin ? `${doc.bin.shelf.cabinet.location.name} > ${doc.bin.shelf.cabinet.name} > ${doc.bin.shelf.name} > ${doc.bin.name}` : null,
        retentionDate: doc.retentionDate,
        expiryDate: doc.expiryDate,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }));
    }),
});
