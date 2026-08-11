import { prisma } from '@documenso/prisma';

import { readOcrField } from '../../../universal/ocr-fields';
import { amountDifference, referencesMatch, stripFieldLabel } from '../../../universal/reference-number';
import type { RuleFactProvider, RuleSubject } from '../types';

/**
 * What OCR read out of an attached document — in practice, the purchase order
 * a signer attached alongside the invoice.
 *
 * It exposes what was read, and compares the two headline values against the
 * invoice — the PO number and the total. The comparison lives here rather than
 * in each rule because a raw `{"==": [...]}` written by a rule author fails on
 * formatting: `MER-PO-5023` and `mer po 5023` are the same purchase order and
 * an equality test says they are not. A rule built that way cries wolf, and a
 * control that cries wolf gets switched off. See `universal/reference-number`.
 *
 * What it deliberately does NOT do is match line items. That needs tolerance
 * handling over four parallel arrays that collapse to bare scalars on
 * single-line documents, and a half-built version whose logic nobody can
 * inspect is exactly the quiet wrong answer a payment control must not produce.
 *
 * Every comparison distinguishes three states, not two: agrees, disagrees, and
 * nothing to compare. `applicable`, `po_comparable` and `total_comparable`
 * carry that third state, so a rule blocking on a mismatch cannot fire merely
 * because no PO was attached — the trap the original OCR preset fell into.
 */

const documentIdOf = (subject: RuleSubject): number | null => {
  if (subject.entityType !== 'Document') return null;
  const id = Number(subject.entityId);

  return Number.isInteger(id) ? id : null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const attachmentOcrProvider: RuleFactProvider = {
  namespace: 'attachedPo',
  label: 'Attached document (OCR)',
  fields: [
    {
      path: 'attachedPo.applicable',
      label: 'An attachment has been read by OCR',
      type: 'boolean',
      description:
        'False when nothing was attached, or when the attachment has not been read yet. Test this first — the other fields are all empty when it is false.',
    },
    { path: 'attachedPo.attachedCount', label: 'Attachments present', type: 'number' },
    { path: 'attachedPo.readCount', label: 'Attachments read by OCR', type: 'number' },
    {
      path: 'attachedPo.po_number',
      label: 'PO number read from the attachment',
      type: 'string',
      unreliable: true,
    },
    {
      path: 'attachedPo.vendor_name',
      label: 'Vendor name read from the attachment',
      type: 'string',
      unreliable: true,
    },
    {
      path: 'attachedPo.total_amount',
      label: 'Total read from the attachment',
      type: 'number',
      unreliable: true,
      description: 'Parsed to a number. Null when absent or unparseable — never 0.',
    },
    {
      path: 'attachedPo.documentType',
      label: 'What the extractor called the attachment',
      type: 'string',
      description:
        'Verbatim from the service. It is an invoice extractor and has never returned "purchase_order" in this deployment, so do not gate on this value without checking it first.',
    },
    { path: 'attachedPo.fileName', label: 'Attachment file name', type: 'string' },
    {
      path: 'attachedPo.failed',
      label: 'The last OCR attempt on an attachment failed',
      type: 'boolean',
      description:
        'Distinguishes a read that errored from one that simply found nothing. A rule that blocks on a missing PO should usually not also block on this.',
    },

    // ---- Comparison against the invoice ---------------------------------
    {
      path: 'attachedPo.po_differs_from_invoice',
      label: 'Attached PO number disagrees with the invoice',
      type: 'boolean',
      description:
        'True only when BOTH numbers are present and they are different. Compared with case, spacing and punctuation ignored, so MER-PO-5023 and "mer po 5023" agree. This is the field to block on — it is false when nothing was attached, which "not equal" would not be.',
    },
    {
      path: 'attachedPo.po_matches_invoice',
      label: 'Attached PO number agrees with the invoice',
      type: 'boolean',
      description: 'True only when both numbers are present and they are the same.',
    },
    {
      path: 'attachedPo.po_comparable',
      label: 'Both PO numbers are present',
      type: 'boolean',
      description: 'False when there is nothing to compare, which is not the same as a mismatch.',
    },
    {
      path: 'attachedPo.invoice_po_number',
      label: 'The invoice’s own PO number',
      type: 'string',
      unreliable: true,
      description: 'Included so a comparison rule can be read without cross-referencing ocr.*.',
    },
    {
      path: 'attachedPo.total_difference',
      label: 'Gap between the PO total and the invoice total',
      type: 'number',
      description:
        'Absolute and rounded to the cent. Null when either figure is missing, or when the attachment carries no PO number of its own — a statement attached alongside the invoice is not a purchase order and its total must not be compared. Express a tolerance as "greater than" this.',
    },
    {
      path: 'attachedPo.total_comparable',
      label: 'Both totals are present and the attachment looks like the PO',
      type: 'boolean',
      description:
        'Test this alongside the difference so an unreadable total is not read as agreement. False when the attachment has no PO number, because then there is no evidence it is the purchase order.',
    },
  ],

  resolve: async (subject) => {
    const documentId = documentIdOf(subject);
    if (documentId === null) return undefined;

    // The invoice's own extraction, so the comparison facts can be resolved
    // here rather than making every rule author join `ocr.*` to `attachedPo.*`
    // with a raw equality test that trips over formatting.
    const inboxItem = await prisma.signatureInboxItem
      .findFirst({ where: { documentId }, select: { extractedData: true } })
      .catch(() => null);

    const invoicePo = readOcrField(inboxItem?.extractedData ?? null, 'poNumber');
    const invoiceTotal = readOcrField(inboxItem?.extractedData ?? null, 'totalAmount');

    const files = await prisma.documentSupportingFile
      .findMany({
        where: { documentId },
        orderBy: { ocrRanAt: 'desc' },
        select: {
          fileName: true,
          ocrRanAt: true,
          ocrError: true,
          ocrDocumentType: true,
          extractedData: true,
        },
      })
      .catch(() => []);

    const read = files.filter((file) => file.ocrRanAt !== null && file.ocrError === null);

    // Most recently read wins. A document with two attachments read at
    // different times has no better ordering available, and picking the newest
    // at least matches what someone just did.
    const latest = read.at(0);

    const asTextValue = (value: unknown) => {
      if (value === null || value === undefined) return null;
      const cleaned = stripFieldLabel(String(value));

      return cleaned === '' ? null : cleaned;
    };

    if (!latest) {
      return {
        applicable: false,
        attachedCount: files.length,
        readCount: 0,
        po_number: null,
        vendor_name: null,
        total_amount: null,
        documentType: null,
        fileName: null,
        failed: files.some((file) => file.ocrError !== null),
        // Nothing to compare against, so every comparison is explicitly false
        // rather than absent — a missing path reads as falsy anyway, but a rule
        // author inspecting the context should see the answer, not a gap.
        po_differs_from_invoice: false,
        po_matches_invoice: false,
        po_comparable: false,
        invoice_po_number: asTextValue(invoicePo),
        total_difference: null,
        total_comparable: false,
      };
    }

    const data = asRecord(latest.extractedData);

    const poNumber = readOcrField(data, 'poNumber');
    const vendorName = readOcrField(data, 'vendorName');
    const total = readOcrField(data, 'totalAmount');

    const totalNumber = (() => {
      if (total === null || total === undefined) return null;
      const cleaned = String(total).replace(/[^0-9.-]/g, '');
      if (!/\d/.test(cleaned)) return null;
      const parsed = Number(cleaned);

      return Number.isFinite(parsed) ? parsed : null;
    })();

    const poComparison = referencesMatch(poNumber, invoicePo);

    // The totals are only compared when the attachment carries a PO number of
    // its own.
    //
    // There is no reliable way to tell a purchase order from anything else the
    // signer attached — the extractor labels everything "invoice" — so having a
    // PO number is the only evidence available that this file is the purchase
    // order at all. Without the guard, a statement or a delivery note attached
    // alongside gets its total compared to the invoice's and a tolerance rule
    // blocks on two figures that were never meant to agree. Observed in this
    // deployment: a "king.png" statement totalling 48,399 attached to a $20
    // invoice produced a 48,379 discrepancy.
    const looksLikeThePo = asTextValue(poNumber) !== null;
    const difference = looksLikeThePo ? amountDifference(totalNumber, invoiceTotal) : null;

    return {
      applicable: true,
      attachedCount: files.length,
      readCount: read.length,
      po_number: asTextValue(poNumber),
      vendor_name: asTextValue(vendorName),
      total_amount: totalNumber,
      documentType: latest.ocrDocumentType,
      fileName: latest.fileName,
      failed: files.some((file) => file.ocrError !== null),
      // `referencesMatch` answers null when either side is absent. Both flags
      // collapse that to false, so neither "they disagree" nor "they agree"
      // can be concluded from silence.
      po_differs_from_invoice: poComparison === false,
      po_matches_invoice: poComparison === true,
      po_comparable: poComparison !== null,
      invoice_po_number: asTextValue(invoicePo),
      total_difference: difference,
      total_comparable: difference !== null,
    };
  },
};
