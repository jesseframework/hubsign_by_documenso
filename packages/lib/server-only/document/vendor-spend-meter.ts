import { prisma } from '@documenso/prisma';

import { invoiceFields, parseAmount } from '../../universal/inbox-invoice-fields';
import { buildVendorIdentifier } from './vendor-directory';

/**
 * What the organization has spent with this vendor, against the limit it set.
 *
 * Shown to an org member on the signing page so an invoice is approved against
 * the running total rather than in isolation. The Reports page answers the same
 * question for every vendor at once; this answers it for the one vendor whose
 * invoice is on screen, at the moment it matters.
 *
 * Everything here is optional by design. The meter is a courtesy, not a control:
 * a missing directory record, an unset limit or an unreadable total each mean
 * "no meter", never a wrong one or a blocked signature. Every such case returns
 * null, and the panel is absent rather than empty — an approver must not have to
 * decide whether a blank meter means "nothing spent" or "nothing known".
 *
 * SECURITY: this reveals the organization's budget for a vendor and how much of
 * it is gone. A signing link works for anyone holding the token, and the signer
 * of a vendor's invoice may well work FOR that vendor.
 *
 * The membership check therefore lives HERE rather than in the caller. Every
 * signing surface — this page, the embed, whatever is added next — would
 * otherwise have to remember to make it, and the failure mode of forgetting is
 * silent: the meter renders, looks correct, and shows a supplier its own limit.
 * A `viewerUserId` that is not a member of `organizationId` gets null, the same
 * as everyone else with nothing to see.
 */

/**
 * How many inbox items are scanned to total a vendor's spend.
 *
 * The vendor lives in OCR output and is resolved by name similarity, so it
 * cannot be a WHERE clause — the window has to be read and filtered in memory.
 * Matches the report's own limit so the two totals cover the same invoices; a
 * meter that scanned deeper than the report would quietly disagree with it.
 */
const SCAN_LIMIT = 5_000;

export type VendorSpendMeter = {
  /** The vendor as the directory names it, not as OCR read it. */
  vendorLabel: string;
  /** The label of the field the limit came from, e.g. "Spend limit". */
  limitLabel: string;
  limit: number;
  /** ISO code the figures are in. Empty string when the invoice states none. */
  currency: string;
  days: number;

  /** Spend already booked in the window, excluding the invoice being signed. */
  spent: number;
  /** How many invoices that figure covers. */
  invoices: number;
  /**
   * The invoice on screen. Null when its total could not be read — the meter
   * still shows what came before, and says the new figure is unknown rather than
   * counting it as zero.
   */
  thisInvoice: number | null;
  /** `spent` plus this invoice: what signing makes true. */
  projected: number;
  /** `projected / limit`. 1.42 is 42% over. */
  usedShare: number;
  /** Where the bar stood before this invoice, as a share of the limit. */
  spentShare: number;
  /** Limit minus projected. Negative is an overrun. */
  remaining: number;

  /**
   * Invoices for this vendor in the window whose total OCR could not read. They
   * are in none of the figures above, so the meter understates by an unknown
   * amount and has to say so.
   */
  unreadable: number;
  /** Invoices for this vendor in the window in some other currency. */
  otherCurrency: number;
};

const VENDOR_CATEGORY = 'vendor';

const currencyOf = (raw: string): string => raw.trim().toUpperCase();

/** A finite, positive number out of whatever the field holds. */
const readLimit = (data: unknown, key: string): number | null => {
  const bag =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const raw = bag[key];

  // Stored as a number by the field's own coercion; a string here would be a
  // value written before the field existed, so it is read rather than refused.
  const value = typeof raw === 'number' ? raw : Number(raw);

  // Zero is rejected along with the unparseable. A limit of zero makes every
  // invoice infinitely over budget, which is a red bar carrying no information —
  // and is far more often an empty field than a real instruction not to spend.
  return Number.isFinite(value) && value > 0 ? value : null;
};

export const getVendorSpendMeter = async ({
  organizationId,
  documentId,
  viewerUserId,
  now = new Date(),
}: {
  organizationId: number;
  documentId: number;
  /**
   * Who is looking. Undefined for an unauthenticated signer, which is the common
   * case on a signing page and resolves to no meter.
   */
  viewerUserId?: number | null;
  now?: Date;
}): Promise<VendorSpendMeter | null> => {
  if (!viewerUserId) {
    return null;
  }

  // Membership, not merely a session: a vendor with a free HubSign account is
  // signed in too, and this is precisely the figure to keep from them.
  const membership = await prisma.organizationMember
    .findFirst({
      where: { userId: viewerUserId, organizationId },
      select: { id: true },
    })
    .catch(() => null);

  if (!membership) {
    return null;
  }

  const organization = await prisma.organization
    .findUnique({
      where: { id: organizationId },
      select: { spendMeterEnabled: true, spendMeterField: true, spendMeterDays: true },
    })
    .catch(() => null);

  if (!organization?.spendMeterEnabled || !organization.spendMeterField) {
    return null;
  }

  // The document being signed only has a vendor if it arrived through the inbox;
  // a manually uploaded PDF carries no OCR output and no vendor to measure.
  const subject = await prisma.signatureInboxItem
    .findUnique({
      where: { documentId },
      select: { id: true, organizationId: true, senderEmail: true, extractedData: true },
    })
    .catch(() => null);

  // The organization check is not redundant with the caller's: `documentId` is
  // the only key here, and a document whose inbox item belongs to another
  // organization must not be measured against this one's directory.
  if (!subject || subject.organizationId !== organizationId) {
    return null;
  }

  const subjectFields = invoiceFields(subject);

  const [definition, records] = await Promise.all([
    prisma.metadataFieldDefinition.findFirst({
      where: {
        organizationId,
        category: VENDOR_CATEGORY,
        key: organization.spendMeterField,
        // A field retyped away from NUMBER stops being a limit. Reading a TEXT
        // field as one would turn "net 30" into NaN, or worse, 30.
        type: 'NUMBER',
      },
      select: { key: true, label: true },
    }),
    prisma.metadataRecord.findMany({
      where: { organizationId, category: VENDOR_CATEGORY },
      select: { key: true, label: true, email: true, data: true },
    }),
  ]);

  if (!definition || records.length === 0) {
    return null;
  }

  const { identifyItem } = buildVendorIdentifier(records);

  const vendor = identifyItem({
    vendorName: subjectFields.vendorName,
    senderEmail: subject.senderEmail,
  });

  if (!vendor) {
    return null;
  }

  const limit = readLimit(vendor.data, definition.key);

  if (limit === null) {
    return null;
  }

  // Inclusive of today, matching the reports toolbar: "last 90 days" spans 90
  // days, not 91. Same arithmetic as `getInvoiceReport`'s caller so a meter and
  // a report set to the same window cover the same invoices.
  const days = Math.max(1, organization.spendMeterDays);
  const to = now;
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const items = await prisma.signatureInboxItem.findMany({
    where: {
      organizationId,
      OR: [
        { receivedAt: { gte: from, lte: to } },
        { AND: [{ receivedAt: null }, { createdAt: { gte: from, lte: to } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: SCAN_LIMIT,
    // Deliberately narrow. `ocrText` and `ocrMeta` on the same rows are large
    // enough to dominate this query, and nothing here reads them.
    select: {
      id: true,
      documentId: true,
      senderEmail: true,
      extractedData: true,
    },
  });

  const currency = currencyOf(subjectFields.currency);

  let spent = 0;
  let invoices = 0;
  let unreadable = 0;
  let otherCurrency = 0;

  for (const item of items) {
    // The invoice being signed is itself in this window. Counting it here and
    // again as `thisInvoice` would show its amount twice and put the bar past
    // the limit on the strength of one invoice charged double.
    if (item.documentId === documentId) {
      continue;
    }

    const fields = invoiceFields(item);

    const record = identifyItem({ vendorName: fields.vendorName, senderEmail: item.senderEmail });

    if (record?.key !== vendor.key) {
      continue;
    }

    // Amounts in different currencies are never added together. Counted so the
    // meter can say the total is not the whole story.
    if (currencyOf(fields.currency) !== currency) {
      otherCurrency += 1;
      continue;
    }

    // Only the total field, never the subtotal: a pre-tax figure reported as
    // spend understates every bill, and this is the number people budget from.
    const amount = parseAmount(fields.total);

    if (amount === null) {
      unreadable += 1;
      continue;
    }

    spent += amount;
    invoices += 1;
  }

  const thisInvoice = parseAmount(subjectFields.total);
  const projected = spent + (thisInvoice ?? 0);

  return {
    vendorLabel: vendor.label || vendor.key,
    limitLabel: definition.label,
    limit,
    currency,
    days,
    spent,
    invoices,
    thisInvoice,
    projected,
    usedShare: projected / limit,
    spentShare: spent / limit,
    remaining: limit - projected,
    unreadable,
    otherCurrency,
  };
};
