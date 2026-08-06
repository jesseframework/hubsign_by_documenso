import { prisma } from '@documenso/prisma';

/**
 * The single account that owns every document arriving through an org's
 * signature inbox: the org's first ORG_ADMIN by join date.
 *
 * WHY OWNERSHIP IS NOT THE SENDER
 *
 * Both ingestion paths used to attribute the document to the emailing user when
 * that user happened to be an org member. The signature inbox is a *shared*
 * queue, but document access is owner-scoped — `getDocumentWhereInput` reduces
 * to `OR: [{ userId }]` for a document with no team. So a document emailed in by
 * a member became invisible to whoever was actually operating the inbox: it
 * never appeared in their E-Sign list and "Open in editor" failed, even though
 * the inbox row rendered fine (that path is org-scoped). Ownership scattered
 * across as many accounts as there were senders.
 *
 * A single owner makes the shared queue behave like one. Nothing is lost —
 * `SignatureInboxItem.senderEmail` records who sent it and `receivedById`
 * records the member it was attributed to, which is what the UI displays.
 *
 * Enum columns sort by declaration order in Postgres and `ORG_ADMIN` is declared
 * first, so `role: 'asc'` puts admins ahead of members.
 */
export const resolveInboxOwnerUserId = async (
  organizationId: number,
): Promise<number | null> => {
  const owner = await prisma.organizationMember.findFirst({
    where: { organizationId },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    select: { userId: true },
  });

  return owner?.userId ?? null;
};
