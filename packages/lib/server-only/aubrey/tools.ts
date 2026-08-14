/**
 * Aubrey's tool belt. Each tool runs a query already narrowed to the caller's
 * access scope (see resolveAubreyScope). The model never sees data the user
 * could not open in the UI: eSign documents obey owner/recipient + team
 * visibility; DMS documents obey org + role-based confidentiality; inbox,
 * workflows, approvals and templates are org/user scoped.
 *
 * executeAubreyTool is wrapped in try/catch by the agent, so a bad argument
 * (e.g. an unknown status enum) comes back to the model as { error } rather
 * than failing the whole message.
 */
import { prisma } from '@documenso/prisma';

import type { AubreyScope } from './scope';

const clampLimit = (n: unknown, dflt = 15, max = 40): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : dflt;
};

/** OpenAI function-tool definitions advertised to the model. */
export const AUBREY_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_overview',
      description:
        "High-level counts across everything the user can access: eSign documents by status, DMS documents by status and confidentiality, signature inbox, and pending approvals assigned to the user. Call this first for summary or 'how many' questions.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_esign_documents',
      description:
        'Search the eSignature documents the user can access (documents they own, are a recipient on, or team documents visible to their role). Returns titles, status and recipients.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive text to match in the document title.' },
          status: {
            type: 'string',
            enum: ['DRAFT', 'PENDING', 'COMPLETED', 'REJECTED'],
            description: 'Optional status filter.',
          },
          limit: { type: 'number', description: 'Max results (default 15, max 40).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_dms_documents',
      description:
        'Search the Document Management System (repository) documents the user can access, filtered to the confidentiality levels their role permits. Returns titles, status, confidentiality and dates.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive text to match in the document title.' },
          status: { type: 'string', description: 'Optional DMS status filter (e.g. ACTIVE, ARCHIVED).' },
          expiringSoon: {
            type: 'boolean',
            description: 'If true, only documents with an expiryDate within the next 30 days.',
          },
          limit: { type: 'number', description: 'Max results (default 15, max 40).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_inbox_summary',
      description:
        'Summarise the organization signature inbox (invoices/documents emailed in to be sent for signature): counts by status and the most recent items.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_workflows',
      description: 'List the organization automation workflows and whether each is enabled.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_pending_approvals',
      description:
        'List approvals awaiting action: DMS workflow steps assigned to the user, and pending organization approval requests.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_templates',
      description: 'List the document templates the user can access (their own plus team templates visible to their role).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

function esignScopeWhere(scope: AubreyScope) {
  return {
    OR: [
      { userId: scope.userId },
      { recipients: { some: { email: scope.email } } },
      ...(scope.teamIds.length
        ? [{ teamId: { in: scope.teamIds }, visibility: { in: scope.visibilities } }]
        : []),
    ],
  };
}

function dmsScopeWhere(scope: AubreyScope) {
  return {
    ...(scope.organizationId
      ? { organizationId: scope.organizationId }
      : { uploadedById: scope.userId }),
    confidentiality: { in: scope.confidentialities },
  };
}

async function getOverview(scope: AubreyScope) {
  const esignWhere = esignScopeWhere(scope);
  const dmsWhere = dmsScopeWhere(scope);

  const [
    esignTotal,
    esignByStatus,
    dmsTotal,
    dmsByStatus,
    dmsByConfidentiality,
    inboxTotal,
    myDmsApprovals,
    orgApprovals,
  ] = await Promise.all([
    prisma.document.count({ where: esignWhere }),
    prisma.document.groupBy({ by: ['status'], where: esignWhere, _count: true }),
    prisma.dmsDocument.count({ where: dmsWhere }),
    prisma.dmsDocument.groupBy({ by: ['status'], where: dmsWhere, _count: true }),
    prisma.dmsDocument.groupBy({ by: ['confidentiality'], where: dmsWhere, _count: true }),
    scope.organizationId
      ? prisma.signatureInboxItem.count({ where: { organizationId: scope.organizationId } })
      : Promise.resolve(0),
    prisma.dmsWorkflowStep.count({ where: { assignedToId: scope.userId, status: 'PENDING' } }),
    scope.organizationId
      ? prisma.approvalRequest.count({ where: { organizationId: scope.organizationId, status: 'PENDING' } })
      : Promise.resolve(0),
  ]);

  return {
    organization: scope.organizationName,
    yourRole: scope.orgRole,
    esign: {
      total: esignTotal,
      byStatus: esignByStatus.map((s) => ({ status: s.status, count: s._count })),
    },
    dms: {
      total: dmsTotal,
      byStatus: dmsByStatus.map((s) => ({ status: s.status, count: s._count })),
      byConfidentiality: dmsByConfidentiality.map((c) => ({
        confidentiality: c.confidentiality,
        count: c._count,
      })),
    },
    signatureInbox: { total: inboxTotal },
    pendingApprovalsAssignedToYou: myDmsApprovals,
    orgPendingApprovalRequests: orgApprovals,
  };
}

async function searchEsign(scope: AubreyScope, args: Record<string, unknown>) {
  const where = {
    AND: [
      esignScopeWhere(scope),
      ...(typeof args.query === 'string' && args.query
        ? [{ title: { contains: args.query, mode: 'insensitive' as const } }]
        : []),
      ...(typeof args.status === 'string' ? [{ status: args.status as never }] : []),
    ],
  };

  const docs = await prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: clampLimit(args.limit),
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      teamId: true,
      recipients: { select: { name: true, email: true, signingStatus: true } },
    },
  });

  return {
    count: docs.length,
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      createdAt: d.createdAt.toISOString().slice(0, 10),
      recipients: d.recipients.map((r) => ({
        name: r.name || r.email,
        email: r.email,
        signingStatus: r.signingStatus,
      })),
    })),
  };
}

async function searchDms(scope: AubreyScope, args: Record<string, unknown>) {
  const expiringClause =
    args.expiringSoon === true
      ? [{ expiryDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }]
      : [];

  const where = {
    AND: [
      dmsScopeWhere(scope),
      ...(typeof args.query === 'string' && args.query
        ? [{ title: { contains: args.query, mode: 'insensitive' as const } }]
        : []),
      ...(typeof args.status === 'string' ? [{ status: args.status as never }] : []),
      ...expiringClause,
    ],
  };

  const docs = await prisma.dmsDocument.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: clampLimit(args.limit),
    select: {
      id: true,
      title: true,
      status: true,
      confidentiality: true,
      createdAt: true,
      expiryDate: true,
    },
  });

  return {
    count: docs.length,
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      confidentiality: d.confidentiality,
      createdAt: d.createdAt.toISOString().slice(0, 10),
      expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : null,
    })),
  };
}

async function inboxSummary(scope: AubreyScope) {
  if (!scope.organizationId) return { available: false, reason: 'You are not in an organization.' };

  const [byStatus, recent] = await Promise.all([
    prisma.signatureInboxItem.groupBy({
      by: ['status'],
      where: { organizationId: scope.organizationId },
      _count: true,
    }),
    prisma.signatureInboxItem.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { subject: true, status: true, createdAt: true },
    }),
  ]);

  return {
    available: true,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    recent: recent.map((r) => ({
      subject: r.subject ?? '(no subject)',
      status: r.status,
      receivedAt: r.createdAt.toISOString().slice(0, 10),
    })),
  };
}

async function listWorkflows(scope: AubreyScope) {
  if (!scope.organizationId) return { available: false, workflows: [] };
  const workflows = await prisma.workflow.findMany({
    where: { organizationId: scope.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { name: true, enabled: true, triggerType: true, triggerEvent: true },
  });
  return { available: true, count: workflows.length, workflows };
}

async function listPendingApprovals(scope: AubreyScope) {
  const [myDmsSteps, orgApprovals] = await Promise.all([
    prisma.dmsWorkflowStep.findMany({
      where: { assignedToId: scope.userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, createdAt: true },
    }),
    scope.organizationId
      ? prisma.approvalRequest.findMany({
          where: { organizationId: scope.organizationId, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: { id: true, createdAt: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    dmsStepsAssignedToYou: myDmsSteps.length,
    orgPendingApprovalRequests: orgApprovals.length,
    orgApprovals: orgApprovals.map((a) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt.toISOString().slice(0, 10),
    })),
  };
}

async function listTemplates(scope: AubreyScope) {
  const templates = await prisma.template.findMany({
    where: {
      OR: [
        { userId: scope.userId },
        ...(scope.teamIds.length
          ? [{ teamId: { in: scope.teamIds }, visibility: { in: scope.visibilities } }]
          : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { title: true, type: true, visibility: true },
  });
  return { count: templates.length, templates };
}

export async function executeAubreyTool(
  name: string,
  args: Record<string, unknown>,
  scope: AubreyScope,
): Promise<unknown> {
  switch (name) {
    case 'get_overview':
      return getOverview(scope);
    case 'search_esign_documents':
      return searchEsign(scope, args);
    case 'search_dms_documents':
      return searchDms(scope, args);
    case 'get_inbox_summary':
      return inboxSummary(scope);
    case 'list_workflows':
      return listWorkflows(scope);
    case 'list_pending_approvals':
      return listPendingApprovals(scope);
    case 'list_templates':
      return listTemplates(scope);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
