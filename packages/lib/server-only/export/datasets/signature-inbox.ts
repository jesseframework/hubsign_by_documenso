import { Prisma } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import {
  invoiceAmount,
  invoiceFields,
  parseAmount,
  parseOcrDate,
} from '../../../universal/inbox-invoice-fields';
import type { DateOrder } from '../../../universal/ocr-date';
import { detectDateOrder } from '../../../universal/ocr-date';
import {
  DEFAULT_VENDOR_MATCH_THRESHOLD,
  matchVendorName,
  prepareVendorCandidates,
} from '../../../universal/vendor-match';
import type { DocumentResponsibility } from '../../document/responsibility';
import { getDocumentResponsibility } from '../../document/responsibility';
import type { ItemSlaResult } from '../../inbox/sla';
import { SLA_ORG_SELECT, evaluateItemsSla, slaClockStart } from '../../inbox/sla';
import type { ExportColumnDef, ExportDataset, ExportJoinDef } from '../types';

/**
 * The Signature Inbox as an exportable dataset.
 *
 * Columns come in four tiers, and the distinction matters to whoever reads the
 * spreadsheet:
 *
 *   Document   — what the system knows for certain (ids, statuses, timestamps).
 *   Invoice    — OCR output resolved exactly as the grid resolves it.
 *   OCR raw    — every key the extractor emitted for THIS organization, offered
 *                verbatim, because the extractor's schema differs per tenant and
 *                a fixed list would silently drop whatever is new.
 *   Derived    — SLA and responsibility, computed on read and never stored.
 */

/**
 * Rows scanned before filters that cannot be pushed into SQL (OCR amount, free
 * text) are applied in memory. Reaching it is reported rather than hidden.
 */
const SCAN_CEILING = 20_000;

type InboxExportRow = {
  item: Awaited<ReturnType<typeof fetchItems>>[number];
  sla: ItemSlaResult | null;
  responsibility: DocumentResponsibility | null;
  workflow: { status: string | null; runs: number };
};

const fetchItems = async (where: Prisma.SignatureInboxItemWhereInput) =>
  prisma.signatureInboxItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: SCAN_CEILING,
    include: {
      document: {
        select: {
          id: true,
          title: true,
          status: true,
          completedAt: true,
          createdAt: true,
          documentMeta: { select: { subject: true, signingOrder: true } },
        },
      },
    },
  });

const text = (value: string) => (value === '' ? null : value);

/**
 * How to read an all-numeric date on THIS invoice, inferred from the invoice's
 * own fields.
 *
 * Both date cells consult it, and the overdue calculation infers it the same way
 * from the same two fields, so a `03/04/2026` that the dashboard reads as 3 April
 * cannot land in the spreadsheet as 4 March. The two used to disagree on exactly
 * this value, which is a difference nobody catches until they reconcile the sheet
 * against the screen.
 */
const ocrDateOrder = (item: { extractedData?: unknown }): DateOrder | null => {
  const fields = invoiceFields(item);
  return detectDateOrder(fields.invoiceDate) ?? detectDateOrder(fields.dueDate);
};

/** Newest-first list of every OCR key present in this org's extracted data. */
const discoverOcrKeys = async (organizationId: number): Promise<string[]> => {
  const rows = await prisma.signatureInboxItem.findMany({
    where: { organizationId, extractedData: { not: Prisma.DbNull } },
    orderBy: { createdAt: 'desc' },
    take: 2_000,
    select: { extractedData: true },
  });

  const keys = new Set<string>();
  for (const row of rows) {
    if (row.extractedData && typeof row.extractedData === 'object' && !Array.isArray(row.extractedData)) {
      for (const key of Object.keys(row.extractedData)) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
};

/**
 * Read a raw OCR key without any alias resolution.
 *
 * Arrays are joined rather than dropped: the line-item fields arrive as four
 * parallel arrays (`item_description`, `item_quantity`, `item_rate`,
 * `item_amount`) and a cell containing "[object Object]" helps nobody.
 */
const readRawOcr = (row: InboxExportRow, key: string) => {
  const data = row.item.extractedData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const value = (data as Record<string, unknown>)[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === null || entry === undefined ? '' : String(entry))).join(' | ');
  }
  if (typeof value === 'object') return JSON.stringify(value);

  return text(String(value));
};

const minutes = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value);

const staticColumns = (): ExportColumnDef<InboxExportRow>[] => [
  // ---- Document -----------------------------------------------------------
  {
    key: 'title',
    label: 'Document title',
    group: 'Document',
    type: 'text',
    isDefault: true,
    read: (r) => r.item.document.title,
  },
  {
    key: 'inboxStatus',
    label: 'Inbox status',
    group: 'Document',
    type: 'text',
    isDefault: true,
    hint: 'Where the item is in the inbox queue. Not the same as the document status.',
    read: (r) => r.item.status,
  },
  {
    key: 'documentStatus',
    label: 'Document status',
    group: 'Document',
    type: 'text',
    isDefault: true,
    hint: 'DRAFT until the document is actually sent for signature.',
    read: (r) => r.item.document.status,
  },
  {
    key: 'documentType',
    label: 'Document type',
    group: 'Document',
    type: 'text',
    read: (r) => text(r.item.documentType ?? ''),
  },
  {
    key: 'senderEmail',
    label: 'Sent from',
    group: 'Document',
    type: 'text',
    isDefault: true,
    read: (r) => text(r.item.senderEmail ?? ''),
  },
  {
    key: 'subject',
    label: 'Email subject',
    group: 'Document',
    type: 'text',
    read: (r) => text(r.item.subject ?? ''),
  },
  {
    key: 'receivedAt',
    label: 'Received (mail server)',
    group: 'Document',
    type: 'datetime',
    hint: 'True arrival time. Blank when the mail source supplied no date.',
    read: (r) => r.item.receivedAt,
  },
  {
    key: 'createdAt',
    label: 'Ingested',
    group: 'Document',
    type: 'datetime',
    isDefault: true,
    hint: 'When the poller inserted the row, which is later than arrival if polling had been down.',
    read: (r) => r.item.createdAt,
  },
  {
    key: 'updatedAt',
    label: 'Last updated',
    group: 'Document',
    type: 'datetime',
    read: (r) => r.item.updatedAt,
  },
  {
    key: 'viewedAt',
    label: 'First opened',
    group: 'Document',
    type: 'datetime',
    read: (r) => r.item.viewedAt,
  },
  {
    key: 'emailReadAt',
    label: 'Mailbox marked read',
    group: 'Document',
    type: 'datetime',
    read: (r) => r.item.emailReadAt,
  },
  {
    key: 'completedAt',
    label: 'Completed',
    group: 'Document',
    type: 'datetime',
    read: (r) => r.item.document.completedAt,
  },
  { key: 'itemId', label: 'Inbox item ID', group: 'Document', type: 'text', read: (r) => r.item.id },
  {
    key: 'documentId',
    label: 'Document ID',
    group: 'Document',
    type: 'number',
    read: (r) => r.item.documentId,
  },
  {
    key: 'externalMessageId',
    label: 'Source message ID',
    group: 'Document',
    type: 'text',
    read: (r) => text(r.item.externalMessageId ?? ''),
  },

  // ---- Invoice (resolved exactly as the grid resolves it) -----------------
  {
    key: 'invoiceNumber',
    label: 'Invoice #',
    group: 'Invoice',
    type: 'text',
    isDefault: true,
    read: (r) => text(invoiceFields(r.item).invoiceNumber),
  },
  {
    key: 'poNumber',
    label: 'PO #',
    group: 'Invoice',
    type: 'text',
    read: (r) => text(invoiceFields(r.item).poNumber),
  },
  {
    key: 'vendorName',
    label: 'Vendor',
    group: 'Invoice',
    type: 'text',
    isDefault: true,
    read: (r) => text(invoiceFields(r.item).vendorName),
  },
  {
    key: 'vendorEmail',
    label: 'Vendor email',
    group: 'Invoice',
    type: 'text',
    read: (r) => text(invoiceFields(r.item).vendorEmail),
  },
  {
    key: 'customerName',
    label: 'Bill to',
    group: 'Invoice',
    type: 'text',
    read: (r) => text(invoiceFields(r.item).customerName),
  },
  {
    key: 'currency',
    label: 'Currency',
    group: 'Invoice',
    type: 'text',
    isDefault: true,
    read: (r) => text(invoiceFields(r.item).currency),
  },
  {
    key: 'total',
    label: 'Invoice total',
    group: 'Invoice',
    type: 'money',
    isDefault: true,
    hint: 'The extracted total. Blank when the extractor found none — not zero.',
    // Falls back to the raw string when it will not parse, so a value the
    // extractor mangled is still visible rather than silently blank.
    read: (r) => parseAmount(invoiceFields(r.item).total) ?? text(invoiceFields(r.item).total),
  },
  {
    key: 'tax',
    label: 'Tax',
    group: 'Invoice',
    type: 'money',
    read: (r) => parseAmount(invoiceFields(r.item).tax) ?? text(invoiceFields(r.item).tax),
  },
  {
    key: 'net',
    label: 'Net / subtotal',
    group: 'Invoice',
    type: 'money',
    read: (r) => parseAmount(invoiceFields(r.item).net) ?? text(invoiceFields(r.item).net),
  },
  {
    key: 'amountForFilters',
    label: 'Amount (best effort)',
    group: 'Invoice',
    type: 'money',
    hint: 'Falls back to the subtotal when no total was extracted, so it can disagree with Invoice total.',
    read: (r) => invoiceAmount(r.item),
  },
  {
    key: 'invoiceDate',
    label: 'Invoice date',
    group: 'Invoice',
    type: 'date',
    isDefault: true,
    read: (r) => {
      const raw = invoiceFields(r.item).invoiceDate;
      return parseOcrDate(raw, ocrDateOrder(r.item)) ?? text(raw);
    },
  },
  {
    key: 'dueDate',
    label: 'Due date',
    group: 'Invoice',
    type: 'date',
    isDefault: true,
    read: (r) => {
      const raw = invoiceFields(r.item).dueDate;
      return parseOcrDate(raw, ocrDateOrder(r.item)) ?? text(raw);
    },
  },

  // ---- OCR quality --------------------------------------------------------
  {
    key: 'ocrProcessed',
    label: 'OCR processed',
    group: 'OCR quality',
    type: 'boolean',
    read: (r) => r.item.ocrProcessed,
  },
  {
    key: 'ocrConfidence',
    label: 'OCR confidence',
    group: 'OCR quality',
    type: 'number',
    read: (r) => r.item.ocrConfidence,
  },
  {
    key: 'mlConfidence',
    label: 'ML confidence',
    group: 'OCR quality',
    type: 'number',
    read: (r) => r.item.mlConfidence,
  },
  {
    key: 'needsReview',
    label: 'Needs review',
    group: 'OCR quality',
    type: 'boolean',
    read: (r) => r.item.needsReview,
  },
  {
    key: 'ocrEngine',
    label: 'OCR engine',
    group: 'OCR quality',
    type: 'text',
    read: (r) => text(r.item.ocrEngine ?? ''),
  },
  {
    key: 'error',
    label: 'Error',
    group: 'OCR quality',
    type: 'text',
    read: (r) => text(r.item.error ?? ''),
  },
  {
    key: 'ocrText',
    label: 'Raw OCR text',
    group: 'OCR quality',
    type: 'text',
    hint: 'The entire document text. Long, and it makes the file much bigger.',
    read: (r) => text(r.item.ocrText ?? ''),
  },

  // ---- Responsibility -----------------------------------------------------
  {
    key: 'awaitingName',
    label: 'Awaiting signature from',
    group: 'Responsibility',
    type: 'text',
    isDefault: true,
    read: (r) => {
      const awaiting = r.responsibility?.awaiting ?? [];
      return text(awaiting.map((a) => a.name || a.email).join(', '));
    },
  },
  {
    key: 'awaitingEmail',
    label: 'Awaiting signature from (email)',
    group: 'Responsibility',
    type: 'text',
    read: (r) => text((r.responsibility?.awaiting ?? []).map((a) => a.email).join(', ')),
  },
  {
    key: 'signingOrderMode',
    label: 'Signing order',
    group: 'Responsibility',
    type: 'text',
    read: (r) => r.responsibility?.signingOrder ?? null,
  },
  {
    key: 'allSigners',
    label: 'All recipients',
    group: 'Responsibility',
    type: 'text',
    hint: 'In signing order, each as name <email> (role).',
    read: (r) =>
      text(
        (r.responsibility?.recipients ?? [])
          .map((p) => `${p.name || p.email} <${p.email}> (${p.role.toLowerCase()})`)
          .join('; '),
      ),
  },
  {
    key: 'recipientsTotal',
    label: 'Recipients',
    group: 'Responsibility',
    type: 'number',
    read: (r) => r.responsibility?.recipients.length ?? 0,
  },
  {
    key: 'recipientsSigned',
    label: 'Signed',
    group: 'Responsibility',
    type: 'number',
    isDefault: true,
    read: (r) =>
      (r.responsibility?.recipients ?? []).filter((p) => p.signingStatus === 'SIGNED').length,
  },
  {
    key: 'recipientsPending',
    label: 'Still to sign',
    group: 'Responsibility',
    type: 'number',
    read: (r) =>
      (r.responsibility?.recipients ?? []).filter((p) => p.signingStatus === 'NOT_SIGNED').length,
  },
  {
    key: 'recipientsRejected',
    label: 'Declined',
    group: 'Responsibility',
    type: 'number',
    read: (r) =>
      (r.responsibility?.recipients ?? []).filter((p) => p.signingStatus === 'REJECTED').length,
  },

  // ---- Reminders ----------------------------------------------------------
  {
    key: 'reminderTotal',
    label: 'Reminders sent',
    group: 'Reminders',
    type: 'number',
    isDefault: true,
    read: (r) => r.responsibility?.reminderTotal ?? 0,
  },
  {
    key: 'lastReminderAt',
    label: 'Last reminder',
    group: 'Reminders',
    type: 'datetime',
    read: (r) => r.responsibility?.lastReminderAt ?? null,
  },
  {
    key: 'reminderLog',
    label: 'Reminder log',
    group: 'Reminders',
    type: 'text',
    hint: 'Every recorded send. Reminders sent before logging began have no date.',
    read: (r) => {
      const parts: string[] = [];
      for (const recipient of r.responsibility?.recipients ?? []) {
        if (recipient.reminders.total === 0) continue;
        const times = recipient.reminders.timestamps.map((t) => t.sentAt.toISOString()).join(', ');
        const missing = recipient.reminders.untimestamped;
        parts.push(
          `${recipient.email}: ${recipient.reminders.total} sent` +
            (times ? ` [${times}]` : '') +
            (missing > 0 ? ` (+${missing} with no recorded time)` : ''),
        );
      }
      return text(parts.join('; '));
    },
  },
  {
    key: 'remindersUntimestamped',
    label: 'Reminders with no recorded time',
    group: 'Reminders',
    type: 'number',
    read: (r) =>
      (r.responsibility?.recipients ?? []).reduce((sum, p) => sum + p.reminders.untimestamped, 0),
  },

  // ---- SLA ----------------------------------------------------------------
  {
    key: 'slaState',
    label: 'SLA state',
    group: 'SLA',
    type: 'text',
    isDefault: true,
    hint: 'Blank when SLA tracking is switched off for the organization.',
    read: (r) => r.sla?.internal.state ?? null,
  },
  {
    key: 'slaSettled',
    label: 'SLA clock stopped',
    group: 'SLA',
    type: 'boolean',
    hint: 'True once the work finished, on time or late.',
    read: (r) => (r.sla ? r.sla.internal.settled : null),
  },
  {
    key: 'slaDueAt',
    label: 'SLA due',
    group: 'SLA',
    type: 'datetime',
    read: (r) => r.sla?.internal.dueAt ?? null,
  },
  {
    key: 'slaOverdueMinutes',
    label: 'Overdue by (business minutes)',
    group: 'SLA',
    type: 'number',
    read: (r) =>
      r.sla ? Math.max(0, Math.round(r.sla.internal.elapsedMinutes - r.sla.internal.targetMinutes)) : null,
  },
  {
    key: 'slaElapsedMinutes',
    label: 'Elapsed (business minutes)',
    group: 'SLA',
    type: 'number',
    read: (r) => minutes(r.sla?.internal.elapsedMinutes),
  },
  {
    key: 'slaTargetMinutes',
    label: 'Target (business minutes)',
    group: 'SLA',
    type: 'number',
    read: (r) => minutes(r.sla?.internal.targetMinutes),
  },
  {
    key: 'slaClockStart',
    label: 'SLA clock started',
    group: 'SLA',
    type: 'datetime',
    read: (r) => slaClockStart(r.item),
  },
  {
    key: 'slaClockSource',
    label: 'SLA clock measured from',
    group: 'SLA',
    type: 'text',
    hint: '"ingest" means the mail server gave no arrival time, so the clock starts when we polled.',
    read: (r) => r.sla?.startedFrom ?? null,
  },
  {
    key: 'slaTargetSource',
    label: 'SLA target source',
    group: 'SLA',
    type: 'text',
    read: (r) => r.sla?.targets.source ?? null,
  },
  {
    key: 'slaVendorLabel',
    label: 'SLA vendor',
    group: 'SLA',
    type: 'text',
    read: (r) => r.sla?.vendorLabel ?? null,
  },
  {
    key: 'slaEndToEndState',
    label: 'End-to-end SLA state',
    group: 'SLA',
    type: 'text',
    read: (r) => r.sla?.endToEnd.state ?? null,
  },
  {
    key: 'slaEndToEndDueAt',
    label: 'End-to-end SLA due',
    group: 'SLA',
    type: 'datetime',
    read: (r) => r.sla?.endToEnd.dueAt ?? null,
  },

  // ---- Workflow -----------------------------------------------------------
  {
    key: 'workflowStatus',
    label: 'Latest workflow run',
    group: 'Workflow',
    type: 'text',
    read: (r) => r.workflow.status,
  },
  {
    key: 'workflowRuns',
    label: 'Workflow runs',
    group: 'Workflow',
    type: 'number',
    read: (r) => r.workflow.runs,
  },
];

/**
 * Join the org's reference directory onto each row by vendor name.
 *
 * Uses the same fuzzy matcher the workflow engine uses, so "Northgate
 * Consulting Ltd." on the invoice finds "Northgate Consulting Limited" in the
 * directory — and, just as importantly, refuses to guess between two directory
 * entries that score within a hair of each other. Every pairing's score is
 * written into the sheet so a reader can audit the match instead of trusting it.
 */
const metadataJoin: ExportJoinDef<InboxExportRow> = {
  id: 'metadata',
  label: 'Reference table (Metadata)',
  matchDescription:
    'Matches the OCR vendor name against the Metadata directory, allowing for legal-form and spelling differences. Rows scoring below the threshold are left blank rather than guessed.',
  options: [
    { id: 'category', label: 'Category', kind: 'text', hint: 'Which Metadata category to search. Defaults to "vendor".' },
    {
      id: 'minScore',
      label: 'Minimum match %',
      kind: 'numberRange',
      hint: `Below this, no match is recorded. Default ${Math.round(DEFAULT_VENDOR_MATCH_THRESHOLD * 100)}%.`,
    },
  ],
  prepare: async ({ organizationId, rows, options }) => {
    const category = (options.category || 'vendor').trim();
    const parsedScore = Number(options.minScore);
    const threshold =
      Number.isFinite(parsedScore) && parsedScore >= 50 && parsedScore <= 100
        ? parsedScore / 100
        : DEFAULT_VENDOR_MATCH_THRESHOLD;

    const records = await prisma.metadataRecord.findMany({
      where: { organizationId, category },
      select: { id: true, key: true, label: true, email: true, data: true },
    });

    // Reduce the directory to its comparable forms once, not per row.
    const candidates = prepareVendorCandidates(
      records.map((record) => ({ name: record.label || record.key, value: record })),
    );

    // The `data` blob is org-authored, so its keys differ per deployment and
    // have to be discovered rather than declared.
    const dataKeys = new Set<string>();
    for (const record of records) {
      if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
        for (const key of Object.keys(record.data)) dataKeys.add(key);
      }
    }

    const columns = [
      { key: 'matched', label: 'Matched', group: 'Reference table', type: 'boolean' as const },
      { key: 'name', label: 'Directory name', group: 'Reference table', type: 'text' as const },
      { key: 'email', label: 'Directory email', group: 'Reference table', type: 'text' as const },
      {
        key: 'score',
        label: 'Match %',
        group: 'Reference table',
        type: 'number' as const,
        hint: '100 means the names were identical after normalisation.',
      },
      {
        key: 'method',
        label: 'Match method',
        group: 'Reference table',
        type: 'text' as const,
        hint: 'exact, core (same name, different legal form) or fuzzy.',
      },
      ...[...dataKeys].sort().map((key) => ({
        key: `data.${key}`,
        label: key,
        group: 'Reference table',
        type: 'text' as const,
      })),
    ];

    const resolved = new Map<string, Record<string, string | number | boolean | null>>();
    let matched = 0;
    let fuzzy = 0;
    let ambiguous = 0;

    for (const row of rows) {
      const vendor = invoiceFields(row.item).vendorName;
      if (!vendor) {
        resolved.set(row.item.id, { matched: false, name: null, email: null, score: null, method: null });
        continue;
      }

      const outcome = matchVendorName(vendor, candidates, { threshold });

      if (!outcome.match) {
        if (outcome.ambiguousWith) ambiguous += 1;
        resolved.set(row.item.id, {
          matched: false,
          name: null,
          email: null,
          score: Math.round(outcome.bestScore * 100),
          method: outcome.ambiguousWith ? 'ambiguous' : 'below threshold',
        });
        continue;
      }

      matched += 1;
      if (outcome.match.method === 'fuzzy') fuzzy += 1;

      const record = outcome.match.value;
      const data =
        record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : {};

      const values: Record<string, string | number | boolean | null> = {
        matched: true,
        name: record.label || record.key,
        email: record.email,
        score: Math.round(outcome.match.score * 100),
        method: outcome.match.method,
      };

      for (const key of dataKeys) {
        const value = data[key];
        values[`data.${key}`] =
          value === null || value === undefined
            ? null
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
      }

      resolved.set(row.item.id, values);
    }

    const notes = [
      `Matched ${matched} of ${rows.length} rows against ${records.length} "${category}" records at a ${Math.round(threshold * 100)}% threshold.`,
    ];
    if (fuzzy > 0) {
      notes.push(`${fuzzy} were approximate matches — check the Match % column before relying on them.`);
    }
    if (ambiguous > 0) {
      notes.push(
        `${ambiguous} rows were left blank because two directory entries scored too closely to choose between.`,
      );
    }
    if (records.length === 0) {
      notes.push(`No Metadata records exist in category "${category}", so every joined column is blank.`);
    }

    return {
      columns,
      resolve: (row) => resolved.get(row.item.id) ?? {},
      matched,
      notes,
    };
  },
};

export const signatureInboxDataset: ExportDataset<InboxExportRow> = {
  id: 'signature-inbox',
  label: 'Signature Inbox',
  description: 'Invoices emailed in for signature, with their OCR data, SLA state and signing progress.',
  groupOrder: ['Document', 'Invoice', 'Responsibility', 'Reminders', 'SLA', 'Workflow', 'OCR quality', 'OCR fields'],
  joins: [metadataJoin],

  filters: async ({ organizationId }) => {
    const types = await prisma.signatureInboxItem.findMany({
      where: { organizationId, documentType: { not: null } },
      distinct: ['documentType'],
      select: { documentType: true },
      take: 50,
    });

    return [
      {
        id: 'status',
        label: 'Status',
        kind: 'select',
        options: [
          'RECEIVED',
          'OCR_PROCESSING',
          'OCR_COMPLETED',
          'OCR_FAILED',
          'READY',
          'SENT_FOR_SIGNATURE',
          'COMPLETED',
          'REJECTED',
          'ARCHIVED',
        ].map((value) => ({ value, label: value.replace(/_/g, ' ').toLowerCase() })),
      },
      {
        id: 'documentType',
        label: 'Document type',
        kind: 'select',
        options: types
          .map((t) => t.documentType)
          .filter((t): t is string => Boolean(t))
          .map((value) => ({ value, label: value })),
      },
      {
        id: 'received',
        label: 'Received between',
        kind: 'dateRange',
        hint: 'Uses the mail arrival time where known, otherwise the ingest time.',
      },
      { id: 'amount', label: 'Invoice amount', kind: 'numberRange' },
      { id: 'search', label: 'Search', kind: 'text', hint: 'Matches vendor, invoice number, title or any OCR value.' },
    ];
  },

  columns: async ({ organizationId }) => {
    const ocrKeys = await discoverOcrKeys(organizationId);

    const ocrColumns: ExportColumnDef<InboxExportRow>[] = ocrKeys.map((key) => ({
      key: `ocr:${key}`,
      label: key,
      group: 'OCR fields',
      type: 'text',
      hint: 'Raw extractor output, exactly as it was returned.',
      read: (row) => readRawOcr(row, key),
    }));

    // Keys leave here fully qualified. A raw OCR key called `title` and the
    // document's own title are different columns, and only the prefix keeps
    // them apart in a saved layout.
    return [
      ...staticColumns().map((column) => ({ ...column, key: `field:${column.key}` })),
      ...ocrColumns,
    ];
  },

  fetch: async ({ organizationId, filters, limit }) => {
    const where: Prisma.SignatureInboxItemWhereInput = { organizationId };

    const status = filters.get('status');
    if (status?.kind === 'select' && status.value.length > 0) {
      where.status = { in: status.value as never };
    }

    const documentType = filters.get('documentType');
    if (documentType?.kind === 'select' && documentType.value.length > 0) {
      where.documentType = { in: documentType.value };
    }

    // Arrival is `receivedAt` when the mail server gave one and `createdAt`
    // otherwise, so the range has to test both rather than one column.
    const received = filters.get('received');
    if (received?.kind === 'dateRange' && (received.from || received.to)) {
      const range: Prisma.DateTimeFilter = {};
      if (received.from) range.gte = new Date(received.from);
      if (received.to) range.lte = new Date(received.to);

      where.OR = [
        { receivedAt: range },
        { AND: [{ receivedAt: null }, { createdAt: range }] },
      ];
    }

    const items = await fetchItems(where);
    const scanTruncated = items.length === SCAN_CEILING;

    const [org, runs] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: SLA_ORG_SELECT }),
      prisma.workflowRun.findMany({
        where: { workflow: { organizationId }, trigger: 'INBOX_OCR_COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 2_000,
        select: { status: true, context: true },
      }),
    ]);

    const workflowByItem = new Map<string, string[]>();
    for (const run of runs) {
      const itemId = (run.context as { payload?: { inboxItemId?: unknown } })?.payload?.inboxItemId;
      if (typeof itemId === 'string') {
        const list = workflowByItem.get(itemId) ?? [];
        list.push(run.status);
        workflowByItem.set(itemId, list);
      }
    }

    const slaByItem = new Map<string, ItemSlaResult>();
    if (org?.slaEnabled) {
      const evaluated = await evaluateItemsSla({
        organizationId,
        org,
        items: items.map((item) => ({ ...item, document: item.document })),
      });
      for (const result of evaluated) slaByItem.set(result.inboxItemId, result);
    }

    const responsibility = await getDocumentResponsibility(items.map((item) => item.documentId));

    let rows: InboxExportRow[] = items.map((item) => {
      const statuses = workflowByItem.get(item.id) ?? [];
      return {
        item,
        sla: slaByItem.get(item.id) ?? null,
        responsibility: responsibility.get(item.documentId) ?? null,
        workflow: { status: statuses[0] ?? null, runs: statuses.length },
      };
    });

    // Filters that need the OCR blob, applied after the fetch because they
    // cannot be expressed against a JSON column without a scan anyway.
    const amount = filters.get('amount');
    if (amount?.kind === 'numberRange' && (amount.min !== null || amount.max !== null)) {
      rows = rows.filter((row) => {
        const value = invoiceAmount(row.item);
        if (value === null) return false;
        if (amount.min !== null && value < amount.min) return false;
        if (amount.max !== null && value > amount.max) return false;
        return true;
      });
    }

    const search = filters.get('search');
    if (search?.kind === 'text' && search.value.trim() !== '') {
      const needle = search.value.trim().toLowerCase();
      rows = rows.filter((row) => {
        const fields = invoiceFields(row.item);
        const haystack = [
          row.item.document.title,
          row.item.senderEmail,
          row.item.subject,
          fields.invoiceNumber,
          fields.poNumber,
          fields.vendorName,
          fields.vendorEmail,
          JSON.stringify(row.item.extractedData ?? {}),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });
    }

    const total = rows.length;

    if (scanTruncated) {
      // Surfaced through `total` being an undercount would be a lie, so say it
      // plainly in the server log; the workbook reports the row cap separately.
      console.warn(
        `[export:signature-inbox] Scan hit the ${SCAN_CEILING}-row ceiling for organization ${organizationId}; filtered totals are computed over that slice only.`,
      );
    }

    return { rows: rows.slice(0, limit), total };
  },
};
