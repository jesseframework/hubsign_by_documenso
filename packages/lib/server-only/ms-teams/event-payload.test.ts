import { describe, expect, it } from 'vitest';

import { resolveMsTeamsEventTarget } from './event-payload';

const APP = 'https://app.hubsign.io/';

describe('resolveMsTeamsEventTarget — eSign', () => {
  const payload = {
    id: 42,
    title: 'Master Services Agreement',
    status: 'PENDING',
    recipients: [
      { id: 1, email: 'a@x.com', name: 'Ada', role: 'SIGNER', signedAt: '2026-07-08T10:00:00.000Z' },
      { id: 2, email: 'b@x.com', name: 'Bob', role: 'SIGNER', signedAt: null },
      { id: 3, email: 'c@x.com', name: 'Cc', role: 'CC', signedAt: null },
    ],
  };

  it('reads the document straight off the payload', () => {
    const target = resolveMsTeamsEventTarget('DOCUMENT_SENT', payload, APP);

    expect(target?.document.id).toBe(42);
    expect(target?.document.title).toBe('Master Services Agreement');
    expect(target?.documentUrl).toBe('https://app.hubsign.io/documents/42');
    expect(target?.trackable).toBe(true);
  });

  it('maps recipients, preserving ISO signedAt strings from the JSON job payload', () => {
    const target = resolveMsTeamsEventTarget('DOCUMENT_SIGNED', payload, APP);

    expect(target?.document.recipients).toHaveLength(3);
    expect(target?.document.recipients?.[0].signedAt).toBe('2026-07-08T10:00:00.000Z');
    expect(target?.document.recipients?.[1].signedAt).toBe(null);
  });

  it('drops recipients with no email rather than rendering blanks', () => {
    const target = resolveMsTeamsEventTarget(
      'DOCUMENT_SENT',
      { ...payload, recipients: [{ name: 'Nobody' }, { email: 'ok@x.com' }] },
      APP,
    );

    expect(target?.document.recipients).toHaveLength(1);
  });

  it('returns null when the payload has no id or title', () => {
    expect(resolveMsTeamsEventTarget('DOCUMENT_SENT', { title: 'x' }, APP)).toBe(null);
    expect(resolveMsTeamsEventTarget('DOCUMENT_SENT', { id: 1 }, APP)).toBe(null);
    expect(resolveMsTeamsEventTarget('DOCUMENT_SENT', null, APP)).toBe(null);
  });
});

describe('resolveMsTeamsEventTarget — inbox', () => {
  it('INBOX_EMAIL_RECEIVED reads documentId, not id', () => {
    const target = resolveMsTeamsEventTarget(
      'INBOX_EMAIL_RECEIVED',
      { documentId: 7, title: 'Invoice.pdf', sender: 'a@b.com' },
      APP,
    );

    expect(target?.document.id).toBe(7);
    expect(target?.documentUrl).toBe('https://app.hubsign.io/documents/7');
    expect(target?.trackable).toBe(false);
  });

  it('INBOX_OCR_COMPLETED reads the nested document object', () => {
    const target = resolveMsTeamsEventTarget(
      'INBOX_OCR_COMPLETED',
      {
        inboxItemId: 'abc',
        ocrConfidence: 0.91,
        document: { id: 9, title: 'Scanned invoice', status: 'DRAFT' },
      },
      APP,
    );

    expect(target?.document.id).toBe(9);
    expect(target?.document.status).toBe('DRAFT');
    expect(target?.trackable).toBe(false);
  });

  it('INBOX_OCR_COMPLETED returns null when the nested document is absent', () => {
    expect(resolveMsTeamsEventTarget('INBOX_OCR_COMPLETED', { inboxItemId: 'abc' }, APP)).toBe(null);
  });
});

describe('resolveMsTeamsEventTarget — DMS cross-table safety', () => {
  it('does NOT treat a DMS `id` as an eSign Document id', () => {
    // DmsDocument #42 and Document #42 are different rows in different tables.
    // The link must go to /dms/doc/42, never /documents/42.
    const target = resolveMsTeamsEventTarget(
      'DMS_DOCUMENT_FILED',
      { id: 42, title: 'Signed lease', referenceNumber: 'REF-1' },
      APP,
    );

    expect(target?.documentUrl).toBe('https://app.hubsign.io/dms/doc/42');
    expect(target?.documentUrl).not.toContain('/documents/');
  });

  it('never marks a DMS event trackable (its id would collide in MsTeamsCardRef)', () => {
    for (const event of ['DMS_DOCUMENT_FILED', 'DMS_DOCUMENT_CLASSIFIED'] as const) {
      const target = resolveMsTeamsEventTarget(event, { id: 1, title: 't' }, APP);
      expect(target?.trackable, event).toBe(false);
    }
  });

  it('DMS_RETRIEVAL_REQUESTED uses documentId, not the request id', () => {
    const target = resolveMsTeamsEventTarget(
      'DMS_RETRIEVAL_REQUESTED',
      { id: 999, documentId: 5, requestedById: 1, reason: 'Audit' },
      APP,
    );

    // 999 is the request; 5 is the document.
    expect(target?.document.id).toBe(5);
    expect(target?.documentUrl).toBe('https://app.hubsign.io/dms/doc/5');
    expect(target?.document.title).toContain('Audit');
  });

  it('DMS_RETRIEVAL_REQUESTED still names the card when there is no reason', () => {
    const target = resolveMsTeamsEventTarget(
      'DMS_RETRIEVAL_REQUESTED',
      { id: 999, documentId: 5, reason: null },
      APP,
    );

    expect(target?.document.title).toBe('Retrieval requested for document #5');
  });

  it('returns null when DMS_RETRIEVAL_REQUESTED has no documentId', () => {
    expect(resolveMsTeamsEventTarget('DMS_RETRIEVAL_REQUESTED', { id: 999 }, APP)).toBe(null);
  });
});

describe('resolveMsTeamsEventTarget — url handling', () => {
  it('does not double the slash regardless of trailing slash on appUrl', () => {
    for (const app of ['https://a.io', 'https://a.io/', 'https://a.io///']) {
      const target = resolveMsTeamsEventTarget('DOCUMENT_SENT', { id: 1, title: 't' }, app);
      expect(target?.documentUrl, app).toBe('https://a.io/documents/1');
    }
  });
});
