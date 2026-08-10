/**
 * SLA evaluation for Signature Inbox items.
 *
 * Two clocks run from the moment the email arrives:
 *
 *   INTERNAL    received → sent for signature   (what this organization controls)
 *   END-TO-END  received → fully signed         (also depends on the signer)
 *
 * Keeping them apart is the point: a single blended number tells you an invoice
 * was late but not whether your team sat on it or the signer did.
 *
 * Targets resolve per vendor, falling back to the organization default — the
 * same precedence idea as OCR template routing, since "this vendor's invoices
 * legitimately take longer" is the common case.
 */

import type { Organization, SignatureInboxItem } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { normalizeMetadataKey } from '../../universal/metadata';
import { resolveOcrVendorName } from '../../universal/ocr-fields';
import {
  type SlaCalendar,
  type SlaEvaluation,
  evaluateSla,
  normalizeCalendar,
} from '../../universal/sla';

export type OrgSlaConfig = Pick<
  Organization,
  | 'slaEnabled'
  | 'slaTimezone'
  | 'slaWorkingDays'
  | 'slaWorkdayStart'
  | 'slaWorkdayEnd'
  | 'slaHolidays'
  | 'slaDefaultInternalHours'
  | 'slaDefaultEndToEndHours'
>;

export const SLA_ORG_SELECT = {
  slaEnabled: true,
  slaTimezone: true,
  slaWorkingDays: true,
  slaWorkdayStart: true,
  slaWorkdayEnd: true,
  slaHolidays: true,
  slaDefaultInternalHours: true,
  slaDefaultEndToEndHours: true,
} as const;

export const calendarFromOrg = (org: OrgSlaConfig): SlaCalendar =>
  normalizeCalendar({
    timezone: org.slaTimezone ?? 'UTC',
    workingDays: org.slaWorkingDays?.length ? org.slaWorkingDays : undefined,
    workdayStart: org.slaWorkdayStart ?? undefined,
    workdayEnd: org.slaWorkdayEnd ?? undefined,
    holidays: org.slaHolidays ?? [],
  });

export type SlaTargets = {
  internalHours: number | null;
  endToEndHours: number | null;
  /** Where the target came from, for display and for debugging a surprise. */
  source: 'vendor' | 'keyword' | 'org-default' | 'none';
  vendorLabel?: string;
};

const positiveInt = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const readTargets = (data: unknown): { internal: number | null; endToEnd: number | null } => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { internal: null, endToEnd: null };
  }

  const bag = data as Record<string, unknown>;

  return {
    internal: positiveInt(bag.slaInternalHours),
    endToEnd: positiveInt(bag.slaEndToEndHours),
  };
};

const keywordsOf = (data: unknown): string[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const raw = (data as Record<string, unknown>).keywords;
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',') : [];
  return list.map((k) => k.trim().toLowerCase()).filter(Boolean);
};

type ResolverRecord = {
  key: string;
  label: string | null;
  email: string | null;
  keywords: string[];
  internal: number | null;
  endToEnd: number | null;
};

/**
 * Load the directory once and return a synchronous resolver.
 *
 * A dashboard evaluates every item in the range; doing a lookup per item would
 * be one query per invoice.
 */
export const buildSlaResolver = async (organizationId: number, org: OrgSlaConfig) => {
  const records = await prisma.metadataRecord.findMany({
    where: { organizationId },
    select: { key: true, label: true, email: true, data: true },
  });

  const candidates: ResolverRecord[] = records.map((record) => {
    const targets = readTargets(record.data);
    return {
      key: record.key,
      label: record.label,
      email: record.email,
      keywords: keywordsOf(record.data),
      internal: targets.internal,
      endToEnd: targets.endToEnd,
    };
  });

  // Only records that actually carry a target can win; the rest of the
  // directory is noise for this purpose.
  const withTargets = candidates.filter((c) => c.internal !== null || c.endToEnd !== null);
  const byKey = new Map(withTargets.map((c) => [c.key, c]));
  /** Every directory key, including records that set no target of their own. */
  const knownKeys = new Set(candidates.map((c) => c.key));

  const orgDefaults: SlaTargets = {
    internalHours: org.slaDefaultInternalHours ?? null,
    endToEndHours: org.slaDefaultEndToEndHours ?? null,
    source: org.slaDefaultInternalHours || org.slaDefaultEndToEndHours ? 'org-default' : 'none',
  };

  return (item: Pick<SignatureInboxItem, 'senderEmail' | 'extractedData' | 'subject'>): SlaTargets => {
    const vendorName = resolveOcrVendorName(item.extractedData);

    // 1. The vendor named on the invoice.
    if (vendorName) {
      const hit = byKey.get(normalizeMetadataKey(vendorName));
      if (hit) {
        return {
          internalHours: hit.internal ?? orgDefaults.internalHours,
          endToEndHours: hit.endToEnd ?? orgDefaults.endToEndHours,
          source: 'vendor',
          vendorLabel: hit.label ?? undefined,
        };
      }
    }

    // 2. The sender's own record — catches mail whose vendor name didn't extract.
    const sender = item.senderEmail?.trim().toLowerCase();
    if (sender) {
      const hit = withTargets.find((c) => c.email?.trim().toLowerCase() === sender);
      if (hit) {
        return {
          internalHours: hit.internal ?? orgDefaults.internalHours,
          endToEndHours: hit.endToEnd ?? orgDefaults.endToEndHours,
          source: 'vendor',
          vendorLabel: hit.label ?? undefined,
        };
      }
    }

    // 3. Keywords, scanned across the extracted values and the subject — lets a
    //    class of document ("utility", "rush") carry its own target.
    //
    //    Skipped once the invoice's vendor is positively in the directory: that
    //    vendor simply not setting a target means "use the default", not "borrow
    //    whichever other vendor's keyword happens to appear". Without this guard
    //    a generic keyword like "consulting" on one vendor silently captures
    //    every invoice from any company with that word in its name.
    const identifiedVendor = vendorName ? knownKeys.has(normalizeMetadataKey(vendorName)) : false;

    if (!identifiedVendor) {
      const haystack = [
        vendorName ?? '',
        item.subject ?? '',
        JSON.stringify(item.extractedData ?? {}),
      ]
        .join(' ')
        .toLowerCase();

      const keywordHit = withTargets.find((c) => c.keywords.some((kw) => haystack.includes(kw)));

      if (keywordHit) {
        return {
          internalHours: keywordHit.internal ?? orgDefaults.internalHours,
          endToEndHours: keywordHit.endToEnd ?? orgDefaults.endToEndHours,
          source: 'keyword',
          vendorLabel: keywordHit.label ?? undefined,
        };
      }
    }

    return orgDefaults;
  };
};

export type ItemSlaResult = {
  inboxItemId: string;
  vendorLabel: string | null;
  targets: SlaTargets;
  internal: SlaEvaluation;
  endToEnd: SlaEvaluation;
};

type EvaluableItem = Pick<
  SignatureInboxItem,
  'id' | 'createdAt' | 'senderEmail' | 'subject' | 'extractedData' | 'documentId'
> & {
  document: { status: string; completedAt: Date | null };
};

/**
 * Evaluate both clocks for a set of items.
 *
 * The "sent for signature" instant comes from the document's `DOCUMENT_SENT`
 * audit log rather than a dedicated column, so history that predates SLA being
 * switched on is measurable too — the dashboard is useful immediately instead
 * of starting empty.
 */
export const evaluateItemsSla = async ({
  organizationId,
  org,
  items,
  now = new Date(),
}: {
  organizationId: number;
  org: OrgSlaConfig;
  items: EvaluableItem[];
  now?: Date;
}): Promise<ItemSlaResult[]> => {
  if (items.length === 0) {
    return [];
  }

  const [resolve, sentLogs] = await Promise.all([
    buildSlaResolver(organizationId, org),
    prisma.documentAuditLog.findMany({
      where: { documentId: { in: items.map((i) => i.documentId) }, type: 'DOCUMENT_SENT' },
      select: { documentId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // First send wins — a resend must not reset a clock that already stopped.
  const sentAtByDocument = new Map<number, Date>();
  for (const log of sentLogs) {
    if (!sentAtByDocument.has(log.documentId)) {
      sentAtByDocument.set(log.documentId, log.createdAt);
    }
  }

  const calendar = calendarFromOrg(org);

  return items.map((item) => {
    const targets = resolve(item);
    const sentAt = sentAtByDocument.get(item.documentId) ?? null;

    return {
      inboxItemId: item.id,
      // Attribute to the vendor named ON THE INVOICE, not to whichever record
      // supplied the target — a keyword-matched target must never make the
      // dashboard blame a different company for this invoice's breach.
      vendorLabel: resolveOcrVendorName(item.extractedData) ?? targets.vendorLabel ?? null,
      targets,
      internal: evaluateSla({
        startedAt: item.createdAt,
        completedAt: sentAt,
        targetHours: targets.internalHours,
        calendar,
        now,
      }),
      endToEnd: evaluateSla({
        startedAt: item.createdAt,
        completedAt: item.document.completedAt,
        targetHours: targets.endToEndHours,
        calendar,
        now,
      }),
    };
  });
};
