import type { DocumentSigningOrder, RecipientRole, SendStatus, SigningStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

/**
 * Who a document is waiting on, and how often they have been chased.
 *
 * Shared by the Signature Inbox grid and the exporter so the two can never
 * disagree about who is responsible for a document — the grid showing one name
 * and the spreadsheet another would be worse than showing neither.
 */

/** Reminder timestamps kept per recipient before the list is summarised. */
const MAX_TIMESTAMPS_PER_RECIPIENT = 12;

export type ReminderEntry = {
  sentAt: Date;
  kind: 'AUTOMATIC' | 'MANUAL';
  /** Who pressed the button. Null for the scheduled sweep. */
  sentBy: string | null;
};

export type RecipientResponsibility = {
  recipientId: number;
  name: string;
  email: string;
  role: RecipientRole;
  /** Position in a sequential chain. Null when the document signs in parallel. */
  signingOrder: number | null;
  signingStatus: SigningStatus;
  sendStatus: SendStatus;
  signedAt: Date | null;
  reminders: {
    /** Every nudge we know went out: the scheduler's counter plus manual sends. */
    total: number;
    /** Newest first, capped at MAX_TIMESTAMPS_PER_RECIPIENT. */
    timestamps: ReminderEntry[];
    /**
     * Sends that happened but whose time was never recorded.
     *
     * `lastReminderAt` was overwritten on every send before the reminder log
     * existed, so for a recipient reminded twice back then exactly one date
     * survives. Reporting the gap is the only honest option — the alternative
     * is a tooltip that quietly lists fewer dates than the count beside it.
     */
    untimestamped: number;
    /** Timestamps beyond the display cap. */
    older: number;
    lastAt: Date | null;
  };
};

export type DocumentResponsibility = {
  documentId: number;
  signingOrder: DocumentSigningOrder;
  recipients: RecipientResponsibility[];
  /**
   * Whose turn it is. One person for a sequential document, everyone still
   * outstanding for a parallel one, and empty when nothing is pending —
   * including when the document has never been sent.
   */
  awaiting: RecipientResponsibility[];
  reminderTotal: number;
  lastReminderAt: Date | null;
};

type RecipientRow = {
  id: number;
  name: string;
  email: string;
  role: RecipientRole;
  signingOrder: number | null;
  signingStatus: SigningStatus;
  sendStatus: SendStatus;
  signedAt: Date | null;
  remindersSent: number;
  lastReminderAt: Date | null;
  documentId: number | null;
};

/**
 * Build the responsibility summary for a set of documents.
 *
 * Two queries total regardless of how many documents are passed — the grid
 * renders up to 200 rows and the exporter thousands, so a per-row lookup would
 * be the slowest thing on the page.
 */
export const getDocumentResponsibility = async (
  documentIds: number[],
): Promise<Map<number, DocumentResponsibility>> => {
  const result = new Map<number, DocumentResponsibility>();

  if (documentIds.length === 0) {
    return result;
  }

  const [recipients, metas] = await Promise.all([
    prisma.recipient.findMany({
      where: { documentId: { in: documentIds } },
      orderBy: [{ signingOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        signingOrder: true,
        signingStatus: true,
        sendStatus: true,
        signedAt: true,
        remindersSent: true,
        lastReminderAt: true,
        documentId: true,
      },
    }),
    prisma.documentMeta.findMany({
      where: { documentId: { in: documentIds } },
      select: { documentId: true, signingOrder: true },
    }),
  ]);

  const history = await prisma.recipientReminder.findMany({
    where: { recipientId: { in: recipients.map((r) => r.id) } },
    orderBy: { sentAt: 'desc' },
    select: {
      recipientId: true,
      sentAt: true,
      kind: true,
      sentBy: { select: { name: true, email: true } },
    },
  });

  const historyByRecipient = new Map<number, typeof history>();
  for (const entry of history) {
    const list = historyByRecipient.get(entry.recipientId) ?? [];
    list.push(entry);
    historyByRecipient.set(entry.recipientId, list);
  }

  const orderByDocument = new Map(metas.map((m) => [m.documentId, m.signingOrder]));

  const byDocument = new Map<number, RecipientRow[]>();
  for (const recipient of recipients) {
    if (recipient.documentId === null) continue;
    const list = byDocument.get(recipient.documentId) ?? [];
    list.push(recipient);
    byDocument.set(recipient.documentId, list);
  }

  for (const documentId of documentIds) {
    const rows = byDocument.get(documentId) ?? [];
    // PARALLEL is the Prisma default, so a document with no meta row behaves
    // the same way the signing flow would treat it.
    const signingOrder = orderByDocument.get(documentId) ?? 'PARALLEL';

    const summarised = rows.map((row) => summariseRecipient(row, historyByRecipient.get(row.id) ?? []));

    const pending = summarised.filter((r) => r.signingStatus === 'NOT_SIGNED');

    // A sequential document is only ever waiting on one person: the next in
    // the chain. Listing all of them would suggest four people are sitting on
    // it when three have not been asked yet.
    const awaiting = signingOrder === 'SEQUENTIAL' ? pending.slice(0, 1) : pending;

    const reminderTotal = summarised.reduce((sum, r) => sum + r.reminders.total, 0);
    const lastReminderAt = summarised.reduce<Date | null>((latest, r) => {
      if (!r.reminders.lastAt) return latest;
      return !latest || r.reminders.lastAt > latest ? r.reminders.lastAt : latest;
    }, null);

    result.set(documentId, {
      documentId,
      signingOrder,
      recipients: summarised,
      awaiting,
      reminderTotal,
      lastReminderAt,
    });
  }

  return result;
};

const summariseRecipient = (
  row: RecipientRow,
  entries: { sentAt: Date; kind: string; sentBy: { name: string | null; email: string } | null }[],
): RecipientResponsibility => {
  const automaticLogged = entries.filter((e) => e.kind === 'AUTOMATIC').length;
  const manualLogged = entries.length - automaticLogged;

  // The scheduler's counter is authoritative for automatic sends; the log is
  // authoritative for manual ones. Taking the larger of counter and logged
  // automatic rows means a log row written without the counter (or the other
  // way round, if a transaction ever half-failed) still counts once.
  const automaticTotal = Math.max(row.remindersSent, automaticLogged);

  const timestamps: ReminderEntry[] = entries
    .slice(0, MAX_TIMESTAMPS_PER_RECIPIENT)
    .map((entry) => ({
      sentAt: entry.sentAt,
      kind: entry.kind === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC',
      sentBy: entry.sentBy?.name || entry.sentBy?.email || null,
    }));

  return {
    recipientId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    signingOrder: row.signingOrder,
    signingStatus: row.signingStatus,
    sendStatus: row.sendStatus,
    signedAt: row.signedAt,
    reminders: {
      total: automaticTotal + manualLogged,
      timestamps,
      untimestamped: Math.max(0, automaticTotal - automaticLogged),
      older: Math.max(0, entries.length - MAX_TIMESTAMPS_PER_RECIPIENT),
      // The log is newest-first, so [0] is the most recent. `lastReminderAt`
      // stands in only if a log row is somehow missing for a counted send.
      lastAt: entries[0]?.sentAt ?? row.lastReminderAt ?? null,
    },
  };
};
