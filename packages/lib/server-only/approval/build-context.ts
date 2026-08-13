/**
 * Builds the evaluation context for an approval request: the data tree that
 * rules, validations and email templates read from (via dotted field paths like
 * "document.status" or "document.user.email").
 *
 * First-class support for entityType "Document"; any other entity type gets a
 * minimal generic context.
 */

import { prisma } from '@documenso/prisma';

import { RULE_OVERRIDE_ENTITY_TYPE } from '../../constants/rule-overrides';

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

  /*
    A signing exception. The entity is the override row, so the generic fallback
    below would title it "RuleOverride cmsp8un8q000bywol7f0i4i8x" — which is what
    the approver's email said before this, and no approver can act on a cuid.

    Resolving it here also gives the chain the document's owner, so the outcome
    notification reaches the person who sent the document rather than nobody.
  */
  if (entityType === RULE_OVERRIDE_ENTITY_TYPE) {
    const override = await prisma.businessRuleOverride.findUnique({
      where: { id: entityId },
      select: {
        blockedReason: true,
        reason: true,
        rules: { select: { ruleName: true } },
        recipient: { select: { name: true, email: true } },
        document: {
          select: {
            id: true,
            title: true,
            status: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (override?.document) {
      const { document } = override;

      return {
        context: {
          entityType,
          entityId,
          organization: { id: organizationId },
          now,
          // Named `override` rather than merged into `document` so a rule set can
          // branch on what is being waived — e.g. route large exceptions higher.
          override: {
            blockedReason: override.blockedReason,
            reason: override.reason,
            rules: override.rules.map((r) => r.ruleName),
            requestedBy: override.recipient?.email ?? null,
          },
          document: {
            id: document.id,
            title: document.title,
            status: document.status,
            user: document.user,
          },
        },
        entityTitle: `Signing exception — ${document.title}`,
        entityStatus: document.status,
        ownerUserId: document.user.id,
        ownerName: document.user.name,
        ownerEmail: document.user.email,
      };
    }
  }

  return {
    context: { entityType, entityId, organization: { id: organizationId }, now },
    entityTitle: `${entityType} ${entityId}`,
  };
};
