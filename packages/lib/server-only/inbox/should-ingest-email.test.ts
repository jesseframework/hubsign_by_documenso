import { describe, expect, it } from 'vitest';

import { normalizeEmailAddress, shouldIngestInboundEmail } from './should-ingest-email';

// FROM_ADDRESS falls back to this when NEXT_PRIVATE_SMTP_FROM_ADDRESS is unset.
const OUR_ADDRESS = 'noreply@hubsign.io';
const ORG_INBOX = 'atl.invoices@bmssuite.com';

describe('normalizeEmailAddress', () => {
  it('extracts the bare address from a display-name form', () => {
    expect(normalizeEmailAddress('HubSign <NoReply@HubSign.io>')).toBe('noreply@hubsign.io');
    expect(normalizeEmailAddress('  Plain@Example.com ')).toBe('plain@example.com');
    expect(normalizeEmailAddress(null)).toBe('');
  });
});

describe('shouldIngestInboundEmail', () => {
  it('ingests an ordinary vendor invoice', () => {
    const d = shouldIngestInboundEmail(
      { from: 'ap@vendor.example', subject: 'Invoice INV-000105' },
      { orgInboxEmail: ORG_INBOX },
    );

    expect(d.ingest).toBe(true);
  });

  it('refuses mail this platform sent — the completion-email loop', () => {
    const d = shouldIngestInboundEmail(
      { from: `HubSign <${OUR_ADDRESS}>`, subject: 'Signing Complete!' },
      { orgInboxEmail: ORG_INBOX },
    );

    expect(d.ingest).toBe(false);
    expect(d).toMatchObject({ reason: 'self-sent' });
  });

  it('refuses mail from the org inbox to itself', () => {
    const d = shouldIngestInboundEmail(
      { from: ORG_INBOX.toUpperCase(), subject: 'FW: invoice' },
      { orgInboxEmail: ORG_INBOX },
    );

    expect(d.ingest).toBe(false);
    expect(d).toMatchObject({ reason: 'self-addressed' });
  });

  it('applies org-configured sender patterns as case-insensitive substrings', () => {
    const d = shouldIngestInboundEmail(
      { from: 'No-Reply@Notifications.Example', subject: 'Statement' },
      { blockedSenders: ['no-reply@'] },
    );

    expect(d.ingest).toBe(false);
    expect(d).toMatchObject({ reason: 'blocked-sender' });
  });

  it('applies org-configured subject patterns', () => {
    const d = shouldIngestInboundEmail(
      { from: 'ap@vendor.example', subject: 'Signing Complete! INV-000105' },
      { blockedSubjects: ['signing complete'] },
    );

    expect(d.ingest).toBe(false);
    expect(d).toMatchObject({ reason: 'blocked-subject' });
  });

  it('ignores blank blocklist entries instead of matching everything', () => {
    // A trailing newline in a textarea must not silently disable the inbox.
    const d = shouldIngestInboundEmail(
      { from: 'ap@vendor.example', subject: 'Invoice 1' },
      { blockedSenders: ['', '   '], blockedSubjects: ['', '\n'] },
    );

    expect(d.ingest).toBe(true);
  });

  it('still ingests when the org has no inbox address configured', () => {
    const d = shouldIngestInboundEmail({ from: 'ap@vendor.example', subject: 'Invoice' }, {});

    expect(d.ingest).toBe(true);
  });

  it('does not block on a missing sender or subject', () => {
    expect(shouldIngestInboundEmail({}, { orgInboxEmail: ORG_INBOX }).ingest).toBe(true);
    expect(
      shouldIngestInboundEmail({ from: 'ap@vendor.example' }, { blockedSubjects: ['complete'] })
        .ingest,
    ).toBe(true);
  });
});
