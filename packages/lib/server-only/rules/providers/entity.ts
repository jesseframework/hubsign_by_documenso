/**
 * The remaining fact providers: the document itself, its recipients, the
 * organization, the acting user, and any attachments.
 *
 * Each is deliberately small and independent — that is the point of the
 * registry. Making a new entity available to rules means appending a provider
 * here (or in its own file) and listing it in `registry.ts`; no evaluator, gate
 * or UI code changes.
 */

import { prisma } from '@documenso/prisma';

import type { RuleFactProvider, RuleSubject } from '../types';

const documentIdOf = (subject: RuleSubject): number | null => {
  const id = Number(subject.entityId);

  return Number.isFinite(id) ? id : null;
};

export const documentProvider: RuleFactProvider = {
  namespace: 'document',
  label: 'Document',
  fields: [
    { path: 'document.id', label: 'Document ID', type: 'number' },
    { path: 'document.title', label: 'Title', type: 'string' },
    { path: 'document.status', label: 'Status', type: 'string' },
    { path: 'document.source', label: 'Source', type: 'string' },
    { path: 'document.recipientCount', label: 'Number of recipients', type: 'number' },
    { path: 'document.fieldCount', label: 'Number of fields', type: 'number' },
    { path: 'document.createdAt', label: 'Created at', type: 'date' },
    { path: 'document.fromInbox', label: 'Arrived via the signature inbox', type: 'boolean' },
    { path: 'document.owner.email', label: 'Owner email', type: 'string' },
    { path: 'document.owner.name', label: 'Owner name', type: 'string' },
  ],

  resolve: async (subject) => {
    const documentId = documentIdOf(subject);
    if (documentId === null) return undefined;

    const document = await prisma.document
      .findUnique({
        where: { id: documentId },
        select: {
          id: true,
          title: true,
          status: true,
          source: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          documentMeta: { select: { subject: true } },
          inboxItem: { select: { id: true } },
          _count: { select: { recipients: true, fields: true } },
        },
      })
      .catch(() => null);

    if (!document) return undefined;

    return {
      id: document.id,
      title: document.title,
      status: document.status,
      source: document.source,
      subject: document.documentMeta?.subject ?? null,
      recipientCount: document._count.recipients,
      fieldCount: document._count.fields,
      createdAt: document.createdAt.toISOString(),
      fromInbox: Boolean(document.inboxItem),
      owner: {
        id: document.user.id,
        name: document.user.name,
        email: document.user.email,
      },
    };
  },
};

export const recipientsProvider: RuleFactProvider = {
  namespace: 'recipients',
  label: 'Recipients',
  fields: [
    { path: 'recipients.count', label: 'Total recipients', type: 'number' },
    { path: 'recipients.signedCount', label: 'How many have signed', type: 'number' },
    { path: 'recipients.pendingCount', label: 'How many are outstanding', type: 'number' },
    { path: 'recipients.approverCount', label: 'How many are approvers', type: 'number' },
    { path: 'recipients.emails', label: 'All recipient emails', type: 'array' },
    {
      path: 'recipients.signer.email',
      label: 'Email of the recipient acting now',
      type: 'string',
      description: 'Only populated at the signing gate.',
    },
    { path: 'recipients.signer.role', label: 'Role of the recipient acting now', type: 'string' },
  ],

  resolve: async (subject) => {
    const documentId = documentIdOf(subject);
    if (documentId === null) return undefined;

    const recipients = await prisma.recipient
      .findMany({
        where: { documentId },
        select: { id: true, email: true, name: true, role: true, signingStatus: true },
      })
      .catch(() => []);

    const acting = subject.recipientId
      ? recipients.find((r) => r.id === subject.recipientId)
      : undefined;

    return {
      count: recipients.length,
      signedCount: recipients.filter((r) => r.signingStatus === 'SIGNED').length,
      pendingCount: recipients.filter((r) => r.signingStatus === 'NOT_SIGNED').length,
      approverCount: recipients.filter((r) => r.role === 'APPROVER').length,
      emails: recipients.map((r) => r.email),
      roles: recipients.map((r) => r.role),
      signer: acting
        ? { id: acting.id, email: acting.email, name: acting.name, role: acting.role }
        : null,
    };
  },
};

export const organizationProvider: RuleFactProvider = {
  namespace: 'organization',
  label: 'Organization',
  fields: [
    { path: 'organization.id', label: 'Organization ID', type: 'number' },
    { path: 'organization.name', label: 'Name', type: 'string' },
    { path: 'organization.slug', label: 'Slug', type: 'string' },
    { path: 'organization.memberCount', label: 'Number of members', type: 'number' },
  ],

  resolve: async (subject) => {
    const org = await prisma.organization
      .findUnique({
        where: { id: subject.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          domain: true,
          _count: { select: { members: true } },
        },
      })
      .catch(() => null);

    if (!org) return { id: subject.organizationId };

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      domain: org.domain,
      memberCount: org._count.members,
    };
  },
};

export const actorProvider: RuleFactProvider = {
  namespace: 'actor',
  label: 'Acting user',
  fields: [
    { path: 'actor.email', label: 'Email', type: 'string' },
    { path: 'actor.isMember', label: 'Is an organization member', type: 'boolean' },
    { path: 'actor.role', label: 'Organization role', type: 'string' },
    { path: 'actor.department', label: 'Department', type: 'string' },
    { path: 'actor.isDepartmentHead', label: 'Is a department head', type: 'boolean' },
  ],

  resolve: async (subject) => {
    // Signing happens without a session, so there frequently is no actor. An
    // absent actor must not make a rule accidentally true, so the namespace is
    // still present with explicit falses rather than omitted.
    if (!subject.actorUserId) {
      return { isMember: false, role: null, department: null, isDepartmentHead: false };
    }

    const membership = await prisma.organizationMember
      .findFirst({
        where: { userId: subject.actorUserId, organizationId: subject.organizationId },
        select: {
          role: true,
          department: true,
          isDepartmentHead: true,
          user: { select: { email: true, name: true } },
        },
      })
      .catch(() => null);

    if (!membership) {
      const user = await prisma.user
        .findUnique({ where: { id: subject.actorUserId }, select: { email: true, name: true } })
        .catch(() => null);

      return {
        email: user?.email ?? null,
        name: user?.name ?? null,
        isMember: false,
        role: null,
        department: null,
        isDepartmentHead: false,
      };
    }

    return {
      email: membership.user.email,
      name: membership.user.name,
      isMember: true,
      role: membership.role,
      department: membership.department,
      isDepartmentHead: membership.isDepartmentHead,
    };
  },
};

export const attachmentsProvider: RuleFactProvider = {
  namespace: 'attachments',
  label: 'Supporting documents',
  fields: [
    { path: 'attachments.count', label: 'Number of attachments', type: 'number' },
    { path: 'attachments.fileNames', label: 'Attachment file names', type: 'array' },
    { path: 'attachments.contentTypes', label: 'Attachment content types', type: 'array' },
    { path: 'attachments.hasPdf', label: 'At least one PDF attached', type: 'boolean' },
  ],

  resolve: async (subject) => {
    const documentId = documentIdOf(subject);
    if (documentId === null) return undefined;

    const files = await prisma.documentSupportingFile
      .findMany({ where: { documentId }, select: { fileName: true, contentType: true } })
      .catch(() => []);

    return {
      count: files.length,
      fileNames: files.map((f) => f.fileName),
      contentTypes: files.map((f) => f.contentType),
      hasPdf: files.some((f) => f.contentType === 'application/pdf'),
    };
  },
};
