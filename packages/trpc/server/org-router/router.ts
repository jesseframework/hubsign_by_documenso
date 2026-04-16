import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

export const orgRouter = router({
  // ═══════════════════════════════════════════
  // ORGANIZATION CRUD
  // ═══════════════════════════════════════════

  create: authenticatedProcedure
    .input(z.object({
      name: z.string().min(1),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
      domain: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = await prisma.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          domain: input.domain || undefined,
          members: {
            create: {
              userId: ctx.user.id,
              role: 'ORG_ADMIN',
            },
          },
        },
      });

      return org;
    }),

  getMyOrganization: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
      include: {
        organization: {
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
            _count: { select: { teams: true, dmsDocuments: true, dmsLocations: true } },
          },
        },
      },
    });

    return membership;
  }),

  update: authenticatedProcedure
    .input(z.object({
      name: z.string().optional(),
      domain: z.string().nullable().optional(),
      logoUrl: z.string().nullable().optional(),
      defaultConfidentiality: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN'] } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can update the organization' });
      }

      return prisma.organization.update({
        where: { id: membership.organizationId },
        data: input,
      });
    }),

  // ═══════════════════════════════════════════
  // MEMBER MANAGEMENT
  // ═══════════════════════════════════════════

  inviteMember: authenticatedProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['ORG_ADMIN', 'DMS_ADMIN', 'TEAM_ADMIN', 'MANAGER', 'MEMBER']),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to invite members' });
      }

      // Find user by email
      const user = await prisma.user.findUnique({ where: { email: input.email } });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found. They must have a HubSign account first.' });
      }

      // Check if already a member
      const existing = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: membership.organizationId, userId: user.id } },
      });

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User is already a member of this organization' });
      }

      return prisma.organizationMember.create({
        data: {
          organizationId: membership.organizationId,
          userId: user.id,
          role: input.role,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
    }),

  updateMemberRole: authenticatedProcedure
    .input(z.object({
      memberId: z.string(),
      role: z.enum(['ORG_ADMIN', 'DMS_ADMIN', 'TEAM_ADMIN', 'MANAGER', 'MEMBER']),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can change roles' });
      }

      return prisma.organizationMember.update({
        where: { id: input.memberId },
        data: { role: input.role },
      });
    }),

  removeMember: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can remove members' });
      }

      // Prevent removing yourself if you're the last admin
      const target = await prisma.organizationMember.findUnique({ where: { id: input.memberId } });
      if (target?.userId === ctx.user.id) {
        const adminCount = await prisma.organizationMember.count({
          where: { organizationId: myMembership.organizationId, role: 'ORG_ADMIN' },
        });
        if (adminCount <= 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remove the last Org Admin' });
        }
      }

      return prisma.organizationMember.delete({ where: { id: input.memberId } });
    }),

  // ═══════════════════════════════════════════
  // DMS PERMISSIONS (for DMS_ADMIN to manage)
  // ═══════════════════════════════════════════

  getMemberPermissions: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .query(async ({ input }) => {
      return prisma.dmsOrgPermission.findMany({
        where: { memberId: input.memberId },
        orderBy: { action: 'asc' },
      });
    }),

  grantPermission: authenticatedProcedure
    .input(z.object({
      memberId: z.string(),
      action: z.enum([
        'DMS_VIEW', 'DMS_UPLOAD', 'DMS_DOWNLOAD', 'DMS_EDIT', 'DMS_DELETE',
        'DMS_MANAGE_FILING', 'DMS_MANAGE_TYPES', 'DMS_APPROVE_WORKFLOWS',
        'DMS_APPROVE_RETRIEVALS', 'DMS_MANAGE_RETENTION', 'DMS_EXPORT', 'DMS_VIEW_AUDIT_TRAIL',
      ]),
      locationId: z.string().optional(),
      classificationId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org/DMS Admins can manage permissions' });
      }

      return prisma.dmsOrgPermission.create({
        data: {
          memberId: input.memberId,
          action: input.action,
          locationId: input.locationId,
          classificationId: input.classificationId,
          grantedById: ctx.user.id,
        },
      });
    }),

  revokePermission: authenticatedProcedure
    .input(z.object({ permissionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return prisma.dmsOrgPermission.delete({ where: { id: input.permissionId } });
    }),

  // ═══════════════════════════════════════════
  // SAVED SEARCHES
  // ═══════════════════════════════════════════

  getSavedSearches: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
    });

    return prisma.dmsSavedSearch.findMany({
      where: {
        OR: [
          { userId: ctx.user.id },
          ...(membership ? [{ organizationId: membership.organizationId, isShared: true }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }),

  saveSearch: authenticatedProcedure
    .input(z.object({
      name: z.string().min(1),
      criteria: z.any(),
      isShared: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
      });

      return prisma.dmsSavedSearch.create({
        data: {
          name: input.name,
          criteria: input.criteria,
          isShared: input.isShared ?? false,
          userId: ctx.user.id,
          organizationId: membership?.organizationId,
        },
      });
    }),

  deleteSavedSearch: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return prisma.dmsSavedSearch.delete({
        where: { id: input.id, userId: ctx.user.id },
      });
    }),

  // ═══════════════════════════════════════════
  // RECYCLE BIN
  // ═══════════════════════════════════════════

  getRecycleBin: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
    });

    return prisma.dmsRecycleBinItem.findMany({
      where: membership
        ? { organizationId: membership.organizationId }
        : { deletedById: ctx.user.id },
      include: {
        document: { select: { id: true, title: true, referenceNumber: true, fileName: true, fileType: true } },
        deletedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  moveToRecycleBin: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
      });

      // Create recycle bin item (expires in 30 days)
      await prisma.dmsRecycleBinItem.create({
        data: {
          documentId: input.documentId,
          deletedById: ctx.user.id,
          organizationId: membership?.organizationId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Update document status
      await prisma.dmsDocument.update({
        where: { id: input.documentId },
        data: { status: 'DESTROYED' },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'MOVED_TO_RECYCLE_BIN',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: 'Document moved to recycle bin (30-day retention)',
        },
      });

      return { success: true };
    }),

  restoreFromRecycleBin: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.dmsRecycleBinItem.delete({
        where: { documentId: input.documentId },
      });

      await prisma.dmsDocument.update({
        where: { id: input.documentId },
        data: { status: 'ACTIVE' },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'RESTORED_FROM_RECYCLE_BIN',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: 'Document restored from recycle bin',
        },
      });

      return { success: true };
    }),

  permanentlyDelete: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can permanently delete documents' });
      }

      await prisma.dmsRecycleBinItem.delete({
        where: { documentId: input.documentId },
      }).catch(() => {});

      await prisma.dmsDocument.delete({
        where: { id: input.documentId },
      });

      return { success: true };
    }),
});
