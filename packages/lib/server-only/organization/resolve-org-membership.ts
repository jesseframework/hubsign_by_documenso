import { prisma } from '@documenso/prisma';

/**
 * The organization a user acts in, resolved one way everywhere.
 *
 * There is no `organizationId` on the request context, so every caller has to
 * derive it. An unordered `findFirst` lets Postgres pick any of a multi-org
 * user's memberships, which means two call sites serving the same screen can
 * legitimately disagree. `joinedAt asc` is the ordering the org router already
 * mandates; matching it keeps the tRPC routers and the export endpoint pointed
 * at the same organization as the dashboard.
 *
 * Returns null rather than throwing, so HTTP callers can answer 403 and tRPC
 * callers can throw their own error.
 */
export const resolveOrgMembership = async (userId: number) =>
  prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
  });
