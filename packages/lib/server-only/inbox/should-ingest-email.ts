/**
 * Decides whether an inbound email should become a signature-inbox document.
 *
 * THE FEEDBACK LOOP THIS PREVENTS
 *
 * When a document finishes signing, `send-completed-email` mails the signed PDF
 * as an ATTACHMENT to the owner and to every recipient. Send a document to the
 * org's own inbox address — which a workflow will happily do — and the
 * completion mail arrives back in that inbox carrying a PDF. The poller sees a
 * new message with an attachment and ingests it as a fresh invoice: a new
 * document, a new OCR run, and `INBOX_EMAIL_RECEIVED` /
 * `INBOX_OCR_COMPLETED` firing again. That last part is what makes it a loop
 * rather than merely noise, since a workflow that sends for signature will
 * produce another completion mail.
 *
 * Two rules are unconditional because no legitimate inbound invoice can ever
 * match them, and leaving either configurable would let someone re-open the
 * loop by clearing a text field:
 *
 *   1. mail sent by our own outbound address (`FROM_ADDRESS`)
 *   2. mail whose sender is the receiving org's own inbox address
 *
 * Everything else is org-configurable, since "which counterparties are noise"
 * is a business decision this module cannot make.
 */

import { FROM_ADDRESS } from '../../constants/email';

export type InboundEmailMeta = {
  from?: string | null;
  subject?: string | null;
};

export type InboxFilterConfig = {
  /** The receiving org's own inbox address, if configured. */
  orgInboxEmail?: string | null;
  blockedSenders?: string[];
  blockedSubjects?: string[];
};

export type IngestDecision =
  | { ingest: true }
  | { ingest: false; reason: string; detail: string };

/** Bare address out of `Display Name <addr@host>`, lowercased. */
export const normalizeEmailAddress = (raw?: string | null): string => {
  if (!raw) return '';

  const angled = raw.match(/<([^>]+)>/);

  return (angled ? angled[1] : raw).trim().toLowerCase();
};

const matchesAny = (haystack: string, needles: string[]): string | null => {
  for (const needle of needles) {
    const trimmed = needle.trim().toLowerCase();
    // Skip blanks — an empty entry would otherwise match everything and
    // silently disable the whole inbox.
    if (trimmed && haystack.includes(trimmed)) {
      return needle.trim();
    }
  }

  return null;
};

export const shouldIngestInboundEmail = (
  meta: InboundEmailMeta,
  config: InboxFilterConfig = {},
): IngestDecision => {
  const from = normalizeEmailAddress(meta.from);
  const subject = (meta.subject ?? '').trim().toLowerCase();

  // 1. Our own outbound address — every notification this platform sends.
  const ourAddress = normalizeEmailAddress(FROM_ADDRESS);
  if (from && ourAddress && from === ourAddress) {
    return {
      ingest: false,
      reason: 'self-sent',
      detail: `sent by this platform (${ourAddress})`,
    };
  }

  // 2. The org's own inbox talking to itself.
  const orgInbox = normalizeEmailAddress(config.orgInboxEmail);
  if (from && orgInbox && from === orgInbox) {
    return {
      ingest: false,
      reason: 'self-addressed',
      detail: `sender is the org's own inbox address (${orgInbox})`,
    };
  }

  const blockedSender = from ? matchesAny(from, config.blockedSenders ?? []) : null;
  if (blockedSender) {
    return {
      ingest: false,
      reason: 'blocked-sender',
      detail: `sender "${from}" matches blocked pattern "${blockedSender}"`,
    };
  }

  const blockedSubject = subject ? matchesAny(subject, config.blockedSubjects ?? []) : null;
  if (blockedSubject) {
    return {
      ingest: false,
      reason: 'blocked-subject',
      detail: `subject matches blocked pattern "${blockedSubject}"`,
    };
  }

  return { ingest: true };
};
