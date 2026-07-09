/**
 * Turn a workflow event payload into something the Teams cards can render.
 *
 * The five dispatch sites emit genuinely different shapes, and — critically —
 * `data.id` means a DIFFERENT ENTITY depending on the event:
 *
 *   DOCUMENT_*              data.id          → Document.id        + data.recipients[]
 *   INBOX_EMAIL_RECEIVED    data.documentId  → Document.id
 *   INBOX_OCR_COMPLETED     data.document.id → Document.id
 *   DMS_DOCUMENT_FILED      data.id          → DmsDocument.id     (NOT a Document!)
 *   DMS_DOCUMENT_CLASSIFIED data.id          → DmsDocument.id
 *   DMS_RETRIEVAL_REQUESTED data.id          → retrieval request; data.documentId → DmsDocument.id
 *
 * So there is no safe generic "find the id" heuristic: reading `data.id` for a
 * DMS event and looking it up as a Document would surface an unrelated — possibly
 * another team's — document title in a Teams channel. Each event is handled
 * explicitly, and nothing is re-queried from the database; the payload the org
 * emitted is the only source.
 */
import type { MsTeamsDocumentSummary, MsTeamsRecipientSummary } from '../../types/ms-teams';
import type { WorkflowEventKey } from '../../types/workflow';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const trimUrl = (appUrl: string) => appUrl.replace(/\/+$/, '');

/**
 * Recipients only exist on the eSign webhook payload. Job payloads round-trip
 * through JSON, so `signedAt` arrives as an ISO string rather than a Date —
 * `renderTrackerCard` only ever tests it for truthiness, which holds for both.
 */
const mapRecipients = (value: unknown): MsTeamsRecipientSummary[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const recipient = asRecord(entry);
    const email = recipient && asString(recipient.email);

    if (!email) {
      return [];
    }

    return [
      {
        email,
        name: asString(recipient.name) ?? null,
        role: asString(recipient.role) ?? null,
        signedAt: (recipient.signedAt as MsTeamsRecipientSummary['signedAt']) ?? null,
      },
    ];
  });
};

export type MsTeamsEventTarget = {
  document: MsTeamsDocumentSummary;
  /** Fully-qualified deep link. eSign and DMS documents live at different paths. */
  documentUrl: string;
  /**
   * Whether a live tracker card makes sense. True only when the payload carries
   * a real Document plus its recipients — i.e. the eSign lifecycle events. A
   * tracker for a DMS filing would have no signing progress to show, and its id
   * would collide with an unrelated Document in MsTeamsCardRef.
   */
  trackable: boolean;
};

const ESIGN_EVENTS = new Set<WorkflowEventKey>([
  'DOCUMENT_CREATED',
  'DOCUMENT_SENT',
  'DOCUMENT_OPENED',
  'DOCUMENT_SIGNED',
  'DOCUMENT_COMPLETED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_CANCELLED',
]);

/**
 * @returns `null` when the payload carries nothing worth rendering, in which case
 * the caller should skip delivery rather than post an empty card.
 */
export const resolveMsTeamsEventTarget = (
  event: WorkflowEventKey,
  data: unknown,
  appUrl: string,
): MsTeamsEventTarget | null => {
  const payload = asRecord(data);

  if (!payload) {
    return null;
  }

  const base = trimUrl(appUrl);

  // ── eSign: the payload IS the document (mapDocumentToWebhookDocumentPayload) ──
  if (ESIGN_EVENTS.has(event)) {
    const id = asNumber(payload.id);
    const title = asString(payload.title);

    if (id === undefined || !title) {
      return null;
    }

    return {
      document: {
        id,
        title,
        status: asString(payload.status) ?? null,
        recipients: mapRecipients(payload.recipients),
      },
      documentUrl: `${base}/documents/${id}`,
      trackable: true,
    };
  }

  // ── Signature inbox: references a real Document, but carries no recipients ──
  if (event === 'INBOX_EMAIL_RECEIVED') {
    const id = asNumber(payload.documentId);
    const title = asString(payload.title);

    if (id === undefined || !title) {
      return null;
    }

    return {
      document: { id, title, status: null, recipients: [] },
      documentUrl: `${base}/documents/${id}`,
      trackable: false,
    };
  }

  if (event === 'INBOX_OCR_COMPLETED') {
    const document = asRecord(payload.document);
    const id = document && asNumber(document.id);
    const title = document && asString(document.title);

    if (id === undefined || !title) {
      return null;
    }

    return {
      document: {
        id,
        title,
        status: (document && asString(document.status)) ?? null,
        recipients: [],
      },
      documentUrl: `${base}/documents/${id}`,
      trackable: false,
    };
  }

  // ── DMS: `id` is a DmsDocument, which lives at a different route entirely ──
  if (event === 'DMS_DOCUMENT_FILED' || event === 'DMS_DOCUMENT_CLASSIFIED') {
    const id = asNumber(payload.id);
    const title = asString(payload.title);

    if (id === undefined || !title) {
      return null;
    }

    return {
      document: { id, title, status: null, recipients: [] },
      documentUrl: `${base}/dms/doc/${id}`,
      trackable: false,
    };
  }

  if (event === 'DMS_RETRIEVAL_REQUESTED') {
    // `id` here is the retrieval request; the document is `documentId`. The
    // payload has no title, so name the card after the request.
    const documentId = asNumber(payload.documentId);

    if (documentId === undefined) {
      return null;
    }

    return {
      document: {
        id: documentId,
        title: asString(payload.reason)
          ? `Retrieval requested: ${asString(payload.reason)}`
          : `Retrieval requested for document #${documentId}`,
        status: null,
        recipients: [],
      },
      documentUrl: `${base}/dms/doc/${documentId}`,
      trackable: false,
    };
  }

  return null;
};
