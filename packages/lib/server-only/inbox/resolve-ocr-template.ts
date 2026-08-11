/**
 * Pick the BMS ML extraction template for an inbound invoice.
 *
 * Templates are what lift extraction accuracy — without one the service falls
 * back to generic AI extraction and `field_extractions` comes back empty. But
 * the template has to be chosen *before* OCR runs, while the only thing we
 * reliably know about a document at that point is who emailed it. So the
 * sender address is the routing key: a Metadata vendor record carries the
 * template, and the sender is matched against it.
 *
 * Resolution order (first hit wins):
 *   1. An explicit override — someone picked a template and re-ran OCR.
 *   2. A vendor record whose email matches the sender exactly.
 *   3. A vendor record on the same email domain as the sender.
 *   4. The organization's default template.
 *   5. Nothing — the service extracts generically, as it does today.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { normalizeMetadataKey } from '../../universal/metadata';
import { bmsMlGetTemplates } from '../bms-ml/client';

/**
 * Domains where an address says nothing about which company sent the invoice.
 * Without this guard, one vendor saved with a Gmail contact would capture every
 * document arriving from any Gmail account.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'zoho.com',
  'yandex.com',
]);

const domainOf = (email: string): string | null => {
  const at = email.lastIndexOf('@');
  return at === -1 ? null : email.slice(at + 1).trim().toLowerCase() || null;
};

/** The OCR template stored on a Metadata record's flexible `data` bag. */
export const readTemplateFromRecordData = (
  data: unknown,
): { id: number; name?: string } | null => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const raw = (data as Record<string, unknown>).ocrTemplateId;
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const name = (data as Record<string, unknown>).ocrTemplateName;

  return { id, name: typeof name === 'string' ? name : undefined };
};

export type ResolvedOcrTemplate = {
  templateId: number | null;
  templateName?: string;
  /** Why this template was chosen — surfaced in the UI and useful in logs. */
  source: 'override' | 'vendor-email' | 'vendor-domain' | 'org-default' | 'none';
  /** The matched vendor record, when one drove the decision. */
  vendorLabel?: string;
};

export const resolveOcrTemplate = async ({
  organizationId,
  senderEmail,
  overrideTemplateId,
  orgDefaultTemplateId,
}: {
  organizationId: number;
  senderEmail?: string | null;
  overrideTemplateId?: number | null;
  orgDefaultTemplateId?: number | null;
}): Promise<ResolvedOcrTemplate> => {
  if (overrideTemplateId) {
    return { templateId: overrideTemplateId, source: 'override' };
  }

  const sender = senderEmail?.trim().toLowerCase() || null;

  if (sender) {
    // Only records that actually carry a template are candidates; the rest of
    // the directory is irrelevant here.
    const candidates = await prisma.metadataRecord.findMany({
      where: { organizationId, email: { not: null } },
      select: { label: true, email: true, data: true },
    });

    const withTemplate = candidates
      .map((record) => ({ record, template: readTemplateFromRecordData(record.data) }))
      .filter((entry): entry is { record: (typeof candidates)[number]; template: { id: number; name?: string } } =>
        entry.template !== null,
      );

    const exact = withTemplate.find(
      ({ record }) => record.email?.trim().toLowerCase() === sender,
    );

    if (exact) {
      return {
        templateId: exact.template.id,
        templateName: exact.template.name,
        source: 'vendor-email',
        vendorLabel: exact.record.label ?? undefined,
      };
    }

    const senderDomain = domainOf(sender);

    if (senderDomain && !PUBLIC_EMAIL_DOMAINS.has(senderDomain)) {
      const sameDomain = withTemplate.find(
        ({ record }) => domainOf(record.email ?? '') === senderDomain,
      );

      if (sameDomain) {
        return {
          templateId: sameDomain.template.id,
          templateName: sameDomain.template.name,
          source: 'vendor-domain',
          vendorLabel: sameDomain.record.label ?? undefined,
        };
      }
    }
  }

  if (orgDefaultTemplateId) {
    return { templateId: orgDefaultTemplateId, source: 'org-default' };
  }

  return { templateId: null, source: 'none' };
};

/**
 * Teach the mapping: pin a template to whoever sent this invoice, so the next
 * one from them routes automatically. This is what makes accuracy climb with
 * use instead of requiring the directory to be filled in up front.
 *
 * Updates the sender's existing vendor record when there is one; otherwise
 * creates a vendor record seeded from the sender address.
 *
 * @returns the vendor label the template was saved against, or null.
 */
export const rememberTemplateForSender = async ({
  organizationId,
  senderEmail,
  templateId,
}: {
  organizationId: number;
  senderEmail: string;
  templateId: number;
}): Promise<string | null> => {
  const sender = senderEmail.trim().toLowerCase();
  if (!sender) {
    return null;
  }

  // Best-effort display name; the mapping works off the id regardless.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      ocrApiUrl: true,
      ocrApiKey: true,
      ocrApiUsername: true,
      ocrApiPassword: true,
    },
  });

  const templates = org?.ocrApiUrl
    ? await bmsMlGetTemplates({
        apiUrl: org.ocrApiUrl,
        apiKey: org.ocrApiKey,
        apiUsername: org.ocrApiUsername,
        apiPassword: org.ocrApiPassword,
      }).catch(() => [])
    : [];

  const templateName = templates.find((template) => template.id === templateId)?.name;

  const existing = await prisma.metadataRecord.findFirst({
    where: { organizationId, email: { equals: sender, mode: 'insensitive' } },
    select: { id: true, label: true, data: true },
  });

  const withTemplate = (data: unknown): Prisma.InputJsonValue => ({
    ...(data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}),
    ocrTemplateId: templateId,
    ...(templateName ? { ocrTemplateName: templateName } : {}),
  });

  if (existing) {
    await prisma.metadataRecord.update({
      where: { id: existing.id },
      data: { data: withTemplate(existing.data) },
    });

    return existing.label ?? sender;
  }

  // No record for this sender yet — seed one so the directory reflects the
  // mapping the user just made, rather than storing it somewhere invisible.
  const label = senderEmail.trim();
  const key = normalizeMetadataKey(label);

  if (!key) {
    return null;
  }

  await prisma.metadataRecord.upsert({
    where: {
      organizationId_category_key: { organizationId, category: 'vendor', key },
    },
    create: {
      organizationId,
      category: 'vendor',
      key,
      label,
      email: sender,
      data: withTemplate(null),
    },
    update: { email: sender, data: withTemplate(null) },
  });

  return label;
};
