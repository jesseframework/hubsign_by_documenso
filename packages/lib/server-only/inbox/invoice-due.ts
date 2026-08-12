/**
 * Invoice due dates for a set of inbox items.
 *
 * "Is this late?" has two possible answers in this product and they are not the
 * same question:
 *
 *   - The **SLA** asks whether *we* turned it around inside our own target, in
 *     business hours, from the moment it arrived. That is an internal service
 *     level, and `sla.ts` owns it.
 *   - The **due date** asks when the *vendor* is owed by. That is the invoice's
 *     own date, in calendar days, and it is the figure a supplier will quote at
 *     you. This file owns it.
 *
 * The dashboard's aging and overdue-by-vendor cards report the second. They used
 * to report the first, which meant an invoice with thirty days of credit left
 * could appear as overdue because our own eight-hour target had lapsed.
 *
 * The due date is resolved per invoice: the date OCR read off the page when the
 * page states one, otherwise the vendor's payment terms code applied to the
 * invoice date. See `resolveDueDate` for the precedence and why.
 */

import type { SignatureInboxItem } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { invoiceFields } from '../../universal/inbox-invoice-fields';
import type { DueDateBasis } from '../../universal/payment-terms';
import { resolveDueDate } from '../../universal/payment-terms';
import { resolveOcrVendorName } from '../../universal/ocr-fields';
import { SLA_ORG_SELECT, type OrgSlaConfig, buildSlaResolver, slaClockStart } from './sla';

export type ItemDueDate = {
  inboxItemId: string;
  documentId: number;
  /** The vendor named on the invoice, for grouping. Null when OCR found none. */
  vendorLabel: string | null;
  dueAt: Date | null;
  basis: DueDateBasis;
  /** Whole days past due; negative while still in credit. Null when unknown. */
  daysPastDue: number | null;
  /** The terms code that produced the date, when one did. */
  termsCode: string | null;
  /** Still awaiting signature — a settled invoice is history, not a problem. */
  open: boolean;
};

type DueEvaluableItem = Pick<
  SignatureInboxItem,
  'id' | 'documentId' | 'createdAt' | 'receivedAt' | 'senderEmail' | 'subject' | 'extractedData'
> & {
  document: { status: string; completedAt: Date | null };
};

/**
 * Resolve due dates for many items with one directory read.
 *
 * The vendor lookup is borrowed from the SLA resolver rather than reimplemented:
 * identifying which directory record an invoice belongs to is the hard part (exact,
 * then core-name, then fuzzy, then sender address), and a second implementation of
 * it would drift out of agreement with the first. Here it is used only to fetch
 * that vendor's terms code.
 */
export const evaluateItemsDueDates = async ({
  organizationId,
  org,
  items,
  now = new Date(),
}: {
  organizationId: number;
  org: OrgSlaConfig;
  items: DueEvaluableItem[];
  now?: Date;
}): Promise<ItemDueDate[]> => {
  if (items.length === 0) {
    return [];
  }

  const resolve = await buildSlaResolver(organizationId, org);

  return items.map((item) => {
    const fields = invoiceFields(item);
    const targets = resolve(item);

    const resolved = resolveDueDate({
      ocrDueDate: fields.dueDate || null,
      invoiceDate: fields.invoiceDate || null,
      // Arrival, not the row's insert instant, for the same reason the SLA clock
      // uses it: a poller that was down for a week inserted a month of invoices
      // in ten seconds, and dating terms from that evening would give every one
      // of them a fortnight of credit it never had.
      arrivedAt: slaClockStart(item),
      termsCode: targets.termsCode ?? null,
      now,
    });

    return {
      inboxItemId: item.id,
      documentId: item.documentId,
      // The vendor named ON THE INVOICE, not whichever record supplied the terms —
      // a keyword- or sender-matched record must never make the dashboard blame a
      // different company for this invoice being late.
      vendorLabel: resolveOcrVendorName(item.extractedData) ?? targets.vendorLabel ?? null,
      dueAt: resolved.dueAt,
      basis: resolved.basis,
      daysPastDue: resolved.daysPastDue,
      termsCode: targets.termsCode ?? null,
      open: item.document.status !== 'COMPLETED' && item.document.completedAt === null,
    };
  });
};

/** The columns `evaluateItemsDueDates` needs, for callers building a query. */
export const DUE_DATE_ITEM_SELECT = {
  id: true,
  documentId: true,
  createdAt: true,
  receivedAt: true,
  senderEmail: true,
  subject: true,
  extractedData: true,
  document: { select: { status: true, completedAt: true } },
} as const;

/**
 * Due dates for every live inbox item in an organization.
 *
 * Deliberately not windowed by any dashboard date filter: an invoice that went
 * overdue four months ago is the worst case, and hiding it because it falls
 * outside "this month" would hide exactly what the reader needs to see.
 */
export const getOrganizationDueDates = async ({
  organizationId,
  org,
  limit = 2000,
  now = new Date(),
}: {
  organizationId: number;
  /** Fetched here when the caller has no reason to have loaded it already. */
  org?: OrgSlaConfig | null;
  limit?: number;
  now?: Date;
}): Promise<ItemDueDate[]> => {
  const orgConfig =
    org ??
    (await prisma.organization.findUnique({ where: { id: organizationId }, select: SLA_ORG_SELECT }));

  if (!orgConfig) {
    return [];
  }

  const items = await prisma.signatureInboxItem.findMany({
    where: { organizationId, status: { notIn: ['ARCHIVED'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: DUE_DATE_ITEM_SELECT,
  });

  return evaluateItemsDueDates({ organizationId, org: orgConfig, items, now });
};
