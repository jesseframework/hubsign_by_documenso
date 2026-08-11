/**
 * Duplicate-invoice facts.
 *
 * The same invoice reaching the inbox twice is routine — a vendor re-sends, or
 * someone forwards the original into the mailbox — and nothing downstream
 * notices. Both copies OCR cleanly, both look legitimate, and both can be sent
 * for signature and paid.
 *
 * Detection is on identity, not similarity, and the TOTAL MUST ALWAYS AGREE.
 *
 * The obvious design — same vendor plus same invoice number — is wrong here,
 * because the number is an OCR guess. Real data in this deployment has eight
 * distinct Northgate invoices all reading `invoice_number: "12"` (the true
 * numbers are INV-2026-0142, -0151, -0152 …). Matching on vendor + number alone
 * declared all eight duplicates of each other, which would have blocked seven
 * legitimate invoices. Their totals and dates differ, and that is what
 * distinguishes them.
 *
 * So a match needs vendor + total + (invoice number OR issue date). A genuine
 * duplicate is the same document and agrees on all of them; a shared misread
 * number does not survive the total check. This trades a few missed duplicates
 * — when a total fails to extract — for not blocking real invoices, which is
 * the right way round.
 *
 * Deliberately NOT matched on: amount alone (a recurring bill is identical every
 * month and is not a duplicate), or the file name (forwards rename).
 */

import { prisma } from '@documenso/prisma';

import { readOcrField } from '../../../universal/ocr-fields';
import { vendorCoreName } from '../../../universal/vendor-match';
import type { RuleFactProvider, RuleSubject } from '../types';

/** How far back to look. Beyond this a repeat is likelier a genuine re-bill. */
const LOOKBACK_DAYS = 400;

type Candidate = {
  id: string;
  createdAt: Date;
  status: string;
  extractedData: unknown;
};

/**
 * Vendor identity, reduced to the core name so "Acme Ltd.", "ACME LTD" and
 * "Acme Limited" are one vendor.
 *
 * Deliberately the same identity test the directory lookup uses. A vendor
 * re-sending an invoice whose suffix happened to OCR differently the second time
 * is exactly the duplicate this provider exists to catch, and comparing raw
 * spellings would let it through. The total still has to agree as well, so a
 * looser vendor test cannot on its own flag two different invoices.
 */
const vendorKeyOf = (extractedData: unknown): string | null => {
  const name = readOcrField(extractedData, 'vendorName');
  const key = name ? vendorCoreName(name) : '';
  return key || null;
};

/** Invoice numbers vary in punctuation between reads; compare on the essentials. */
const invoiceKeyOf = (extractedData: unknown): string | null => {
  const raw = readOcrField(extractedData, 'invoiceNumber');
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key || null;
};

const dateKeyOf = (extractedData: unknown): string | null => {
  const raw = readOcrField(extractedData, 'invoiceDate');
  if (!raw) return null;
  // Tolerate both "2026-04-27" and "2026-04-27T00:00:00Z".
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return match ? match[1] : raw.trim().toLowerCase();
};

const amountKeyOf = (extractedData: unknown): string | null => {
  const raw = readOcrField(extractedData, 'totalAmount');
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : null;
};

export type DuplicateFacts = {
  isDuplicate: boolean;
  /** How the match was made, for the message shown to a human. */
  matchedOn: 'invoice-number' | 'date-and-amount' | null;
  /** Other inbox items that are the same invoice. */
  count: number;
  /** The earliest copy — the one to treat as the original. */
  originalInboxItemId: string | null;
  originalReceivedAt: string | null;
  /** True when a copy already went out for signature: the expensive case. */
  originalAlreadySent: boolean;
  vendor: string | null;
  invoiceNumber: string | null;
};

const EMPTY: DuplicateFacts = {
  isDuplicate: false,
  matchedOn: null,
  count: 0,
  originalInboxItemId: null,
  originalReceivedAt: null,
  originalAlreadySent: false,
  vendor: null,
  invoiceNumber: null,
};

/** Statuses meaning a copy has already been acted on, not just received. */
const ACTED_ON = new Set(['SENT_FOR_SIGNATURE', 'COMPLETED']);

/**
 * Find prior inbox items that are the same invoice as `item`.
 *
 * Exported so the ingestion path can flag a duplicate the moment OCR lands,
 * without going through the rule engine.
 */
export const findDuplicateInboxItems = async ({
  organizationId,
  inboxItemId,
  extractedData,
}: {
  organizationId: number;
  inboxItemId: string;
  extractedData: unknown;
}): Promise<DuplicateFacts> => {
  const vendorKey = vendorKeyOf(extractedData);

  // Without a vendor there is nothing to be a duplicate *of* — matching on
  // number alone would collide across unrelated companies, whose invoice
  // sequences overlap constantly.
  if (!vendorKey) {
    return EMPTY;
  }

  const invoiceKey = invoiceKeyOf(extractedData);
  const dateKey = dateKeyOf(extractedData);
  const amountKey = amountKeyOf(extractedData);

  // The total is the anchor — without it there is nothing to corroborate a
  // number or date against, and matching on those alone is what produced the
  // eight-way false positive described above.
  if (!amountKey || (!invoiceKey && !dateKey)) {
    return EMPTY;
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const candidates: Candidate[] = await prisma.signatureInboxItem.findMany({
    where: {
      organizationId,
      id: { not: inboxItemId },
      createdAt: { gte: since },
      ocrProcessed: true,
    },
    select: { id: true, createdAt: true, status: true, extractedData: true },
    orderBy: { createdAt: 'asc' },
  });

  let matchedOn: DuplicateFacts['matchedOn'] = null;

  const matches = candidates.filter((candidate) => {
    if (vendorKeyOf(candidate.extractedData) !== vendorKey) {
      return false;
    }

    // The anchor. A shared misread invoice number cannot get past this, because
    // two genuinely different invoices practically never total the same.
    if (amountKeyOf(candidate.extractedData) !== amountKey) {
      return false;
    }

    const sameNumber = invoiceKey !== null && invoiceKeyOf(candidate.extractedData) === invoiceKey;
    const sameDate = dateKey !== null && dateKeyOf(candidate.extractedData) === dateKey;

    if (sameNumber) {
      matchedOn = 'invoice-number';
    } else if (sameDate && matchedOn === null) {
      matchedOn = 'date-and-amount';
    }

    return sameNumber || sameDate;
  });

  if (matches.length === 0) {
    return {
      ...EMPTY,
      vendor: readOcrField(extractedData, 'vendorName'),
      invoiceNumber: readOcrField(extractedData, 'invoiceNumber'),
    };
  }

  const original = matches[0];

  return {
    isDuplicate: true,
    matchedOn,
    count: matches.length,
    originalInboxItemId: original.id,
    originalReceivedAt: original.createdAt.toISOString(),
    originalAlreadySent: matches.some((m) => ACTED_ON.has(m.status)),
    vendor: readOcrField(extractedData, 'vendorName'),
    invoiceNumber: readOcrField(extractedData, 'invoiceNumber'),
  };
};

export const duplicateProvider: RuleFactProvider = {
  namespace: 'duplicate',
  label: 'Duplicate detection',
  fields: [
    {
      path: 'duplicate.isDuplicate',
      label: 'Is a duplicate',
      type: 'boolean',
      description:
        'Another inbox item from the same vendor carries the same invoice number, or the same issue date and total.',
    },
    {
      path: 'duplicate.matchedOn',
      label: 'Matched on',
      type: 'string',
      description: '"invoice-number" (conclusive) or "date-and-amount" (strong, used when no number extracted).',
    },
    {
      path: 'duplicate.count',
      label: 'Other copies',
      type: 'number',
      description: 'How many earlier inbox items are the same invoice.',
    },
    {
      path: 'duplicate.originalAlreadySent',
      label: 'Original already sent',
      type: 'boolean',
      description:
        'An earlier copy has already gone out for signature or completed — the case where a second send risks a double payment.',
    },
    {
      path: 'duplicate.originalInboxItemId',
      label: 'Original inbox item',
      type: 'string',
    },
    {
      path: 'duplicate.originalReceivedAt',
      label: 'Original received at',
      type: 'date',
    },
    {
      path: 'duplicate.vendor',
      label: 'Vendor',
      type: 'string',
      unreliable: true,
    },
    {
      path: 'duplicate.invoiceNumber',
      label: 'Invoice number',
      type: 'string',
      unreliable: true,
    },
  ],
  resolve: async (subject: RuleSubject) => {
    const documentId = Number(subject.entityId);

    if (!Number.isFinite(documentId)) {
      return EMPTY;
    }

    const item = await prisma.signatureInboxItem.findFirst({
      where: { documentId, organizationId: subject.organizationId },
      select: { id: true, extractedData: true },
    });

    // Not an inbox-sourced document — nothing to compare against.
    if (!item) {
      return EMPTY;
    }

    return findDuplicateInboxItems({
      organizationId: subject.organizationId,
      inboxItemId: item.id,
      extractedData: item.extractedData,
    });
  },
};
