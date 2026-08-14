/**
 * Resolve the access scope Aubrey is allowed to reason over for a given user.
 *
 * Aubrey is decoupled from the DMS add-on, so it spans the whole app — but every
 * tool it can call must return only what THIS user is allowed to see. That means
 * two things, resolved here once and threaded into every tool:
 *   • eSign documents: owner/recipient always, plus team documents filtered by
 *     the document-visibility rules the app already enforces elsewhere.
 *   • DMS documents: org-scoped, further narrowed by confidentiality according
 *     to the member's org role (net-new enforcement — the DMS UI is org-wide,
 *     but the assistant must not surface RESTRICTED/CONFIDENTIAL docs to a plain
 *     member).
 */
import { DmsConfidentiality, DocumentVisibility, OrganizationRole } from '@prisma/client';

import { prisma } from '@documenso/prisma';

export type AubreyScope = {
  userId: number;
  email: string;
  name: string | null;
  organizationId: number | null;
  organizationName: string | null;
  orgRole: OrganizationRole | null;
  teamIds: number[];
  /** Highest eSign document visibility this user may see in team documents. */
  visibilities: DocumentVisibility[];
  /** DMS confidentiality levels this user may see. */
  confidentialities: DmsConfidentiality[];
};

/** DMS confidentiality a member may see, by org role. Admins see everything. */
function confidentialityFor(role: OrganizationRole | null): DmsConfidentiality[] {
  switch (role) {
    case OrganizationRole.ORG_ADMIN:
    case OrganizationRole.DMS_ADMIN:
      return [
        DmsConfidentiality.PUBLIC,
        DmsConfidentiality.INTERNAL,
        DmsConfidentiality.CONFIDENTIAL,
        DmsConfidentiality.RESTRICTED,
      ];
    case OrganizationRole.TEAM_ADMIN:
    case OrganizationRole.MANAGER:
      return [
        DmsConfidentiality.PUBLIC,
        DmsConfidentiality.INTERNAL,
        DmsConfidentiality.CONFIDENTIAL,
      ];
    default:
      return [DmsConfidentiality.PUBLIC, DmsConfidentiality.INTERNAL];
  }
}

/** eSign team-document visibility a user may see, by org + team role. */
function visibilityFor(
  orgRole: OrganizationRole | null,
  teamRoles: string[],
): DocumentVisibility[] {
  const isAdmin = orgRole === OrganizationRole.ORG_ADMIN || teamRoles.includes('ADMIN');
  const isManager =
    orgRole === OrganizationRole.MANAGER ||
    orgRole === OrganizationRole.TEAM_ADMIN ||
    teamRoles.includes('MANAGER');

  if (isAdmin) {
    return [
      DocumentVisibility.EVERYONE,
      DocumentVisibility.MANAGER_AND_ABOVE,
      DocumentVisibility.ADMIN,
    ];
  }
  if (isManager) {
    return [DocumentVisibility.EVERYONE, DocumentVisibility.MANAGER_AND_ABOVE];
  }
  return [DocumentVisibility.EVERYONE];
}

export async function resolveAubreyScope(userId: number): Promise<AubreyScope> {
  const [user, membership, teamMembers] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
    // Earliest-joined org is the canonical "acting" org — the same convention
    // the rest of the app uses when the context carries no org (resolveOrgMembership).
    prisma.organizationMember.findFirst({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      select: { organizationId: true, role: true, organization: { select: { name: true } } },
    }),
    prisma.teamMember.findMany({ where: { userId }, select: { teamId: true, role: true } }),
  ]);

  if (!user) {
    throw new Error('User not found.');
  }

  const orgRole = membership?.role ?? null;
  const teamRoles = teamMembers.map((t) => String(t.role));

  return {
    userId,
    email: user.email,
    name: user.name,
    organizationId: membership?.organizationId ?? null,
    organizationName: membership?.organization?.name ?? null,
    orgRole,
    teamIds: teamMembers.map((t) => t.teamId),
    visibilities: visibilityFor(orgRole, teamRoles),
    confidentialities: confidentialityFor(orgRole),
  };
}
