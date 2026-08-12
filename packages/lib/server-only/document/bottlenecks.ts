import { prisma } from '@documenso/prisma';

import { vendorCoreName } from '../../universal/vendor-match';
import { getOrganizationDueDates } from '../inbox/invoice-due';
import { getDocumentResponsibility } from './responsibility';

/**
 * Where signatures are actually stuck, and with whom.
 *
 * The dashboard could say how many documents were out for signature but never
 * which person was sitting on them, so the one question the queue exists to
 * answer — who do I chase — had no answer anywhere in the product.
 *
 * Three cuts of the same pending set:
 *   waitingOn  — by person, so someone can be phoned.
 *   stages     — by cause, separating a delivery failure from a slow signer.
 *   vendors    — by counterparty, so a habitually late supplier is visible.
 */

/**
 * How many rows reach the client. The tiles show a handful; these bounds exist
 * so the detail panel behind them is complete rather than a longer teaser.
 */
const PEOPLE_LIMIT = 50;
const VENDOR_LIMIT = 25;

/** Documents scanned. Far above any realistic pending queue. */
const SCAN_LIMIT = 2_000;

export type BottleneckPerson = {
  name: string;
  /** Shown alongside the name: two people can share a display name. */
  email: string;
  /** Documents whose turn it currently is with them. */
  open: number;
  /** Calendar days since the longest-waiting of those was sent to them. */
  oldestDays: number;
  reminders: number;
  /** Of their open documents, how many were never actually emailed out. */
  neverEmailed: number;
  /** How many they have opened and not acted on. */
  openedNotSigned: number;
};

export type SigningBottlenecks = {
  /** Total pending signature obligations across all people. */
  totalOpen: number;
  people: BottleneckPerson[];
  /** People beyond the returned list, so the UI can say what it left out. */
  otherPeople: number;
  stages: {
    neverEmailed: number;
    emailedNotOpened: number;
    openedNotSigned: number;
  };
  /** Chase effectiveness: how hard we have tried, on the ones still outstanding. */
  chase: {
    none: number;
    once: number;
    repeatedly: number;
  };
  vendors: {
    /**
     * Invoices past the date the VENDOR is owed by, grouped by supplier.
     *
     * The due date comes from the invoice itself when OCR read one, and otherwise
     * from the vendor's payment terms code (see `invoice-due.ts`). It used to be
     * our own internal turnaround SLA, which answered a different question: an
     * invoice with three weeks of credit left could appear here because our
     * eight-hour target had lapsed, and a genuinely late payment could be absent
     * because we happened to process it quickly.
     */
    rows: { vendor: string; overdue: number; open: number }[];
    /**
     * Overdue invoices whose vendor could not be identified. Reported separately
     * rather than ranked as a vendor called "Unknown": it is not a supplier,
     * and letting it top the chart buries the ones somebody can actually call.
     */
    unattributed: number;
    /**
     * Open invoices with no due date at all — no date on the page, and no terms
     * code on the vendor. They cannot be judged late, and saying so is the point:
     * silently omitting them makes an unmeasured queue look like a punctual one.
     */
    noDueDate: number;
  };
};

export const getSigningBottlenecks = async (
  organizationId: number,
): Promise<SigningBottlenecks> => {
  const documents = await prisma.document.findMany({
    where: { organizationId, status: 'PENDING', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: SCAN_LIMIT,
    select: { id: true, createdAt: true },
  });

  const empty: SigningBottlenecks = {
    totalOpen: 0,
    people: [],
    otherPeople: 0,
    stages: { neverEmailed: 0, emailedNotOpened: 0, openedNotSigned: 0 },
    chase: { none: 0, once: 0, repeatedly: 0 },
    vendors: { rows: [], unattributed: 0, noDueDate: 0 },
  };

  if (documents.length === 0) {
    return { ...empty, vendors: await vendorOverdue(organizationId) };
  }

  const documentIds = documents.map((d) => d.id);

  const [responsibility, askedAt] = await Promise.all([
    getDocumentResponsibility(documentIds),
    whenEachRecipientWasAsked(documentIds),
  ]);

  const createdById = new Map(documents.map((d) => [d.id, d.createdAt]));

  const byPerson = new Map<string, BottleneckPerson>();
  const stages = { neverEmailed: 0, emailedNotOpened: 0, openedNotSigned: 0 };
  const chase = { none: 0, once: 0, repeatedly: 0 };
  let totalOpen = 0;

  for (const documentId of documentIds) {
    const record = responsibility.get(documentId);
    if (!record) continue;

    for (const person of record.awaiting) {
      totalOpen += 1;

      // When they were asked, not when the document was created. An invoice
      // ingested in June and sent in August has not been sitting with anybody
      // for two months, and saying so would blame the wrong party.
      const asked = askedAt.get(person.recipientId) ?? createdById.get(documentId) ?? new Date();
      const days = Math.max(0, Math.floor((Date.now() - asked.getTime()) / 86_400_000));

      const key = person.email.trim().toLowerCase();
      const row = byPerson.get(key) ?? {
        name: person.name || person.email,
        email: person.email,
        open: 0,
        oldestDays: 0,
        reminders: 0,
        neverEmailed: 0,
        openedNotSigned: 0,
      };

      row.open += 1;
      row.oldestDays = Math.max(row.oldestDays, days);
      row.reminders += person.reminders.total;

      if (person.sendStatus === 'NOT_SENT') {
        row.neverEmailed += 1;
        stages.neverEmailed += 1;
      } else if (person.readStatus === 'OPENED') {
        row.openedNotSigned += 1;
        stages.openedNotSigned += 1;
      } else {
        stages.emailedNotOpened += 1;
      }

      if (person.reminders.total === 0) chase.none += 1;
      else if (person.reminders.total === 1) chase.once += 1;
      else chase.repeatedly += 1;

      byPerson.set(key, row);
    }
  }

  // Ranked by how much is sitting with them, then by how long the worst one has
  // been there — a person holding one document for four months matters more
  // than one holding two since yesterday.
  const ranked = [...byPerson.values()].sort(
    (a, b) => b.open - a.open || b.oldestDays - a.oldestDays,
  );

  return {
    totalOpen,
    people: ranked.slice(0, PEOPLE_LIMIT),
    otherPeople: Math.max(0, ranked.length - PEOPLE_LIMIT),
    stages,
    chase,
    vendors: await vendorOverdue(organizationId),
  };
};

/**
 * When each recipient was actually asked to sign.
 *
 * Their own signing-request email where one was logged, otherwise the moment
 * the document was distributed. Both come from the audit log, which is the only
 * place either instant is recorded — `Recipient` has no "sent at" column.
 */
const whenEachRecipientWasAsked = async (documentIds: number[]): Promise<Map<number, Date>> => {
  const logs = await prisma.documentAuditLog.findMany({
    where: { documentId: { in: documentIds }, type: { in: ['EMAIL_SENT', 'DOCUMENT_SENT'] } },
    orderBy: { createdAt: 'asc' },
    select: { documentId: true, type: true, createdAt: true, data: true },
  });

  const distributedAt = new Map<number, Date>();
  const perRecipient = new Map<number, Date>();

  for (const log of logs) {
    if (log.type === 'DOCUMENT_SENT') {
      if (!distributedAt.has(log.documentId)) distributedAt.set(log.documentId, log.createdAt);
      continue;
    }

    const data = (log.data ?? {}) as { recipientId?: unknown; emailType?: string; isResending?: boolean };

    // A reminder is not the moment they were first asked; counting it would
    // reset the clock every time we chased, making a badly-delayed document
    // look fresh.
    if (data.isResending) continue;
    if (typeof data.recipientId !== 'number') continue;
    if (!perRecipient.has(data.recipientId)) perRecipient.set(data.recipientId, log.createdAt);
  }

  // Recipients with no email of their own fall back to the document's send.
  const recipients = await prisma.recipient.findMany({
    where: { documentId: { in: documentIds } },
    select: { id: true, documentId: true },
  });

  for (const recipient of recipients) {
    if (perRecipient.has(recipient.id)) continue;
    const fallback = recipient.documentId === null ? null : distributedAt.get(recipient.documentId);
    if (fallback) perRecipient.set(recipient.id, fallback);
  }

  return perRecipient;
};

/**
 * Overdue invoices grouped by vendor, on the invoice's own due date.
 *
 * Counts only invoices still awaiting signature: one that went out late is
 * history, and listing it would keep a supplier on the naughty step forever.
 *
 * Independent of whether SLA tracking is switched on. A due date is a fact about
 * the invoice — the date the vendor is owed by — and it exists whether or not the
 * organization has configured internal turnaround targets.
 */
const vendorOverdue = async (organizationId: number): Promise<SigningBottlenecks['vendors']> => {
  const dues = await getOrganizationDueDates({ organizationId, limit: SCAN_LIMIT });

  const byVendor = new Map<string, { vendor: string; overdue: number; open: number }>();
  let unattributed = 0;
  let noDueDate = 0;

  for (const due of dues) {
    // Settled invoices are excluded entirely, including from `noDueDate`: nobody
    // needs to be told that a signed invoice could not have been judged.
    if (!due.open) continue;

    if (due.daysPastDue === null) {
      noDueDate += 1;
      continue;
    }

    const isOverdue = due.daysPastDue > 0;

    // Grouped on the normalised core name, so "Northgate Consulting Ltd." and
    // "Northgate Consulting Limited" are one supplier rather than two.
    const label = due.vendorLabel ?? '';
    const key = vendorCoreName(label) || label.trim().toLowerCase();

    if (key === '') {
      if (isOverdue) unattributed += 1;
      continue;
    }

    const row = byVendor.get(key) ?? { vendor: label, overdue: 0, open: 0 };

    row.open += 1;
    if (isOverdue) row.overdue += 1;

    byVendor.set(key, row);
  }

  const rows = [...byVendor.values()]
    .filter((row) => row.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    .slice(0, VENDOR_LIMIT);

  return { rows, unattributed, noDueDate };
};
