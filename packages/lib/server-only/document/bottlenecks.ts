import { prisma } from '@documenso/prisma';

import { invoiceFields } from '../../universal/inbox-invoice-fields';
import { vendorCoreName } from '../../universal/vendor-match';
import { SLA_ORG_SELECT, evaluateItemsSla } from '../inbox/sla';
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
    /** False when SLA tracking is switched off — not zero, which reads as "all on time". */
    enabled: boolean;
    rows: { vendor: string; breached: number; open: number }[];
    /**
     * Late invoices whose vendor could not be identified. Reported separately
     * rather than ranked as a vendor called "Unknown": it is not a supplier,
     * and letting it top the chart buries the ones somebody can actually call.
     */
    unattributed: number;
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
    vendors: { enabled: false, rows: [], unattributed: 0 },
  };

  if (documents.length === 0) {
    return { ...empty, vendors: await vendorBreaches(organizationId) };
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
    vendors: await vendorBreaches(organizationId),
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
 * Open SLA breaches grouped by vendor.
 *
 * Counts only breaches whose clock is still running: a late invoice that has
 * since been sent is history, and listing it would keep a supplier on the
 * naughty step forever.
 */
const vendorBreaches = async (organizationId: number): Promise<SigningBottlenecks['vendors']> => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: SLA_ORG_SELECT,
  });

  if (!org?.slaEnabled) {
    return { enabled: false, rows: [], unattributed: 0 };
  }

  const items = await prisma.signatureInboxItem.findMany({
    where: { organizationId, status: { notIn: ['ARCHIVED'] } },
    orderBy: { createdAt: 'desc' },
    take: SCAN_LIMIT,
    include: { document: { select: { status: true, completedAt: true } } },
  });

  if (items.length === 0) {
    return { enabled: true, rows: [], unattributed: 0 };
  }

  const evaluated = await evaluateItemsSla({ organizationId, org, items });
  const slaByItem = new Map(evaluated.map((result) => [result.inboxItemId, result]));

  const byVendor = new Map<string, { vendor: string; breached: number; open: number }>();
  let unattributed = 0;

  for (const item of items) {
    const sla = slaByItem.get(item.id);
    if (!sla) continue;

    const isOpenBreach = sla.internal.state === 'breached' && !sla.internal.settled;

    // Grouped on the normalised core name, so "Northgate Consulting Ltd." and
    // "Northgate Consulting Limited" are one supplier rather than two.
    const label = sla.vendorLabel || invoiceFields(item).vendorName || '';
    const key = vendorCoreName(label) || label.trim().toLowerCase();

    if (key === '') {
      if (isOpenBreach) unattributed += 1;
      continue;
    }

    const row = byVendor.get(key) ?? { vendor: label, breached: 0, open: 0 };

    if (!sla.internal.settled) row.open += 1;
    if (isOpenBreach) row.breached += 1;

    byVendor.set(key, row);
  }

  const rows = [...byVendor.values()]
    .filter((row) => row.breached > 0)
    .sort((a, b) => b.breached - a.breached || b.open - a.open)
    .slice(0, VENDOR_LIMIT);

  return { enabled: true, rows, unattributed };
};
