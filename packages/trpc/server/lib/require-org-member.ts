import { TRPCError } from '@trpc/server';

import { resolveOrgMembership } from '@documenso/lib/server-only/organization/resolve-org-membership';

/**
 * Resolve the organization a request acts on.
 *
 * The ordering is not cosmetic. Several routers each grew their own
 * `findFirst({ where: { userId } })`, and an unordered `findFirst` lets
 * Postgres return whichever row it likes — so for a user in more than one
 * organization, two routers serving the same screen could legitimately answer
 * with different organizations. The Signature Inbox grid and its spreadsheet
 * export are exactly that pair: an export that quietly described a different
 * organization than the grid above it would be very hard to notice and very
 * bad to act on.
 *
 * `joinedAt asc` is the ordering the org router already mandates, so this
 * agrees with the dashboard rather than inventing a third answer.
 */
export const requireOrgMember = async (userId: number) => {
  const membership = await resolveOrgMembership(userId);

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of an organization.',
    });
  }

  return membership;
};
