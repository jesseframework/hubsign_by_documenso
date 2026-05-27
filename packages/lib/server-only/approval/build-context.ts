/**
 * Builds the evaluation context for an approval request: the data tree that
 * rules, validations and email templates read from (via dotted field paths like
 * "document.status" or "document.user.email").
 *
 * First-class support for entityType "Document"; any other entity type gets a
 * minimal generic context.
 */

import { prisma } from '@documenso/prisma';

import type { TApprovalContext } from '../../types/approval';

export type ApprovalEntityContext = {
  context: TApprovalContext;
  entityTitle: string;
  entityStatus?: string | null;
  ownerUserId?: number | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  teamId?: number | null;
  recipientCount?: number;
};

export const buildApprovalContext = async ({
  organizationId,
  entityType,
  entityId,
}: {
  organizationId: number;
  entityType: string;
  entityId: string;
}): Promise<ApprovalEntityContext> => {
  const now = new Date().toISOString();

  if (entityType === 'Document') {
    const documentId = Number(entityId);
    const document = Number.isNaN(documentId)
      ? null
      : await prisma.document.findUnique({
          where: { id: documentId },
          include: {
            user: { select: { id: true, name: true, email: true } },
            documentMeta: true,
            _count: { select: { recipients: true } },
          },
        });

    if (document) {
      return {
        context: {
          entityType,
          entityId,
          organization: { id: organizationId },
          now,
          document: {
            id: document.id,
            title: document.title,
            status: document.status,
            source: document.source,
            recipientCount: document._count.recipients,
            createdAt: document.createdAt.toISOString(),
            subject: document.documentMeta?.subject ?? null,
            user: {
              id: document.user.id,
              name: document.user.name,
              email: document.user.email,
            },
          },
        },
        entityTitle: document.title,
        entityStatus: document.status,
        ownerUserId: document.user.id,
        ownerName: document.user.name,
        ownerEmail: document.user.email,
        teamId: document.teamId,
        recipientCount: document._count.recipients,
      };
    }
  }

  return {
    context: { entityType, entityId, organization: { id: organizationId }, now },
    entityTitle: `${entityType} ${entityId}`,
  };
};
