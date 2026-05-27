/**
 * Dynamic approver resolution for an approval step.
 *
 * Given a step's determination method, returns the concrete approver(s) (HubSign
 * users). Methods:
 *   • FIXED_USER         — a named user.
 *   • ORG_ROLE           — everyone in the org holding a role (e.g. all MANAGERs).
 *   • ROLE_MAPPING       — ApprovalRoleMapping lookup (primary, falling back to backup).
 *   • REPORTING_MANAGER  — the requester's manager (via OrganizationMember.managerId).
 *   • DEPARTMENT_HEAD    — the head of the step's (or requester's) department.
 */

import { prisma } from '@documenso/prisma';

import type { TApprovalDetermination } from '../../types/approval';

export type ApproverInfo = {
  id: number;
  name: string;
  email: string;
  role?: string | null;
};

export type ResolveApproversInput = {
  organizationId: number;
  determination: TApprovalDetermination;
  approverRole?: string | null;
  fixedUserId?: number | null;
  roleMappingKey?: string | null;
  department?: string | null;
  requesterUserId?: number | null;
};

const loadUser = async (userId: number, role?: string | null): Promise<ApproverInfo | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!user?.email) return null;

  return { id: user.id, name: user.name ?? '', email: user.email, role: role ?? null };
};

const dedupe = (approvers: Array<ApproverInfo | null>): ApproverInfo[] => {
  const seen = new Set<number>();
  const out: ApproverInfo[] = [];
  for (const a of approvers) {
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
};

export const resolveApprovers = async (
  input: ResolveApproversInput,
): Promise<ApproverInfo[]> => {
  const { organizationId, determination, requesterUserId } = input;

  switch (determination) {
    case 'FIXED_USER': {
      if (!input.fixedUserId) return [];
      return dedupe([await loadUser(input.fixedUserId)]);
    }

    case 'ORG_ROLE': {
      if (!input.approverRole) return [];
      const members = await prisma.organizationMember.findMany({
        where: { organizationId, role: input.approverRole as never },
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
      });
      return dedupe(
        members.map((m) =>
          m.user?.email
            ? { id: m.user.id, name: m.user.name ?? '', email: m.user.email, role: m.role }
            : null,
        ),
      );
    }

    case 'ROLE_MAPPING': {
      if (!input.roleMappingKey) return [];
      const mapping = await prisma.approvalRoleMapping.findFirst({
        where: { organizationId, roleKey: input.roleMappingKey },
        orderBy: { approvalLevel: 'asc' },
      });
      if (!mapping) return [];
      const primary = await loadUser(mapping.primaryApproverId);
      if (primary) return [primary];
      if (mapping.backupApproverId) {
        return dedupe([await loadUser(mapping.backupApproverId)]);
      }
      return [];
    }

    case 'REPORTING_MANAGER': {
      if (!requesterUserId) return [];
      const member = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: requesterUserId },
        select: { manager: { select: { userId: true } } },
      });
      const managerUserId = member?.manager?.userId;
      if (!managerUserId) return [];
      return dedupe([await loadUser(managerUserId)]);
    }

    case 'DEPARTMENT_HEAD': {
      let department = input.department ?? undefined;
      if (!department && requesterUserId) {
        const member = await prisma.organizationMember.findFirst({
          where: { organizationId, userId: requesterUserId },
          select: { department: true },
        });
        department = member?.department ?? undefined;
      }
      if (!department) return [];

      const heads = await prisma.organizationMember.findMany({
        where: { organizationId, department, isDepartmentHead: true },
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
      });
      return dedupe(
        heads.map((m) =>
          m.user?.email
            ? { id: m.user.id, name: m.user.name ?? '', email: m.user.email, role: m.role }
            : null,
        ),
      );
    }

    default:
      return [];
  }
};
