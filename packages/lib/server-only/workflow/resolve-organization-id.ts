import { prisma } from '@documenso/prisma';

/**
 * Resolve the owning organization for a document/eSign event.
 *
 * Documents carry `userId` (owner) and an optional `teamId`. A team may belong to
 * an organization; otherwise we fall back to the owner's organization membership.
 * Returns null when no organization can be resolved (e.g. a personal account not
 * part of any org) — in which case there are no org workflows to run.
 */
export const resolveOrganizationId = async ({
  teamId,
  userId,
}: {
  teamId?: number | null;
  userId?: number | null;
}): Promise<number | null> => {
  if (teamId) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });

    if (team?.organizationId) {
      return team.organizationId;
    }
  }

  if (userId) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId },
      select: { organizationId: true },
      orderBy: { joinedAt: 'asc' },
    });

    if (membership) {
      return membership.organizationId;
    }
  }

  return null;
};
