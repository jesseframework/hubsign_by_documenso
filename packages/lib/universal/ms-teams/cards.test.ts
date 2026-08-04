import { describe, expect, it } from 'vitest';

import { toCardEnvelope } from '../../types/ms-teams';
import { progressBar, renderDigestCard, renderMilestoneCard, renderTrackerCard } from './cards';

const doc = (recipients: { email: string; role?: string; signedAt?: Date | null }[] = []) => ({
  id: 42,
  title: 'Master Services Agreement',
  status: 'PENDING',
  recipients,
});

const APP_URL = 'https://app.hubsign.io/';
const ORG = 'Acme Corp';

/** Depth-first scan for objects with `type === t`. */
const findAll = (node: unknown, t: string, acc: Record<string, unknown>[] = []) => {
  if (Array.isArray(node)) {
    node.forEach((n) => findAll(n, t, acc));
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.type === t) acc.push(obj);
    Object.values(obj).forEach((v) => findAll(v, t, acc));
  }
  return acc;
};

describe('progressBar', () => {
  it('fills proportionally', () => {
    expect(progressBar(0, 10)).toBe('░'.repeat(10));
    expect(progressBar(10, 10)).toBe('█'.repeat(10));
    expect(progressBar(5, 10)).toBe(`${'█'.repeat(5)}${'░'.repeat(5)}`);
  });

  it('always returns exactly `width` cells', () => {
    for (let done = 0; done <= 7; done++) {
      expect(progressBar(done, 7, 10)).toHaveLength(10);
    }
    expect(progressBar(1, 3, 6)).toHaveLength(6);
  });

  it('does not divide by zero when there are no signers', () => {
    expect(progressBar(0, 0)).toBe('░'.repeat(10));
  });

  it('clamps overshoot rather than overflowing the bar', () => {
    expect(progressBar(99, 10)).toBe('█'.repeat(10));
    expect(progressBar(-5, 10)).toBe('░'.repeat(10));
  });
});

describe('renderTrackerCard', () => {
  it('excludes CC and VIEWER recipients from signing progress', () => {
    const message = renderTrackerCard({
      document: doc([
        { email: 'a@x.com', role: 'SIGNER', signedAt: new Date() },
        { email: 'b@x.com', role: 'SIGNER', signedAt: new Date() },
        { email: 'cc@x.com', role: 'CC' },
        { email: 'v@x.com', role: 'VIEWER' },
      ]),
      organizationName: ORG,
      appUrl: APP_URL,
    });

    // 2 of 2 signers signed — the CC/VIEWER pair must not make this "2 of 4".
    expect(message.summary).toContain('Fully signed');
    expect(JSON.stringify(message.card)).toContain('2 / 2');
  });

  it('lists CC/VIEWER separately rather than dropping them', () => {
    const message = renderTrackerCard({
      document: doc([
        { email: 'a@x.com', role: 'SIGNER' },
        { email: 'cc@x.com', role: 'CC' },
      ]),
      organizationName: ORG,
      appUrl: APP_URL,
    });

    expect(JSON.stringify(message.card)).toContain('cc@x.com');
  });

  it('reports remaining signers while pending', () => {
    const message = renderTrackerCard({
      document: doc([
        { email: 'a@x.com', role: 'SIGNER', signedAt: new Date() },
        { email: 'b@x.com', role: 'SIGNER' },
        { email: 'c@x.com', role: 'SIGNER' },
      ]),
      organizationName: ORG,
      appUrl: APP_URL,
    });

    expect(message.summary).toContain('Awaiting 2 of 3');
  });

  it('surfaces rejection over completion', () => {
    const message = renderTrackerCard({
      document: { ...doc([{ email: 'a@x.com', role: 'SIGNER', signedAt: new Date() }]), status: 'REJECTED' },
      organizationName: ORG,
      appUrl: APP_URL,
    });

    expect(message.summary).toContain('Rejected');
  });

  it('omits Action.Execute and refresh on a non-interactive (webhook) card', () => {
    const message = renderTrackerCard({
      document: doc([{ email: 'a@x.com', role: 'SIGNER' }]),
      organizationName: ORG,
      appUrl: APP_URL,
      interactive: false,
    });

    // A webhook-delivered card has no bot to route the invoke back to; shipping
    // a button that silently does nothing is worse than shipping no button.
    expect(findAll(message.card, 'Action.Execute')).toHaveLength(0);
    expect(message.card.refresh).toBeUndefined();
    expect(findAll(message.card, 'Action.OpenUrl')).toHaveLength(1);
  });

  it('includes Action.Execute and refresh on an interactive (bot) card', () => {
    const message = renderTrackerCard({
      document: doc([{ email: 'a@x.com', role: 'SIGNER' }]),
      organizationName: ORG,
      appUrl: APP_URL,
      interactive: true,
    });

    expect(findAll(message.card, 'Action.Execute').length).toBeGreaterThan(0);
    expect(message.card.refresh).toBeDefined();
  });

  it('drops the reminder button once the document is settled', () => {
    for (const document of [
      { ...doc([{ email: 'a@x.com', role: 'SIGNER', signedAt: new Date() }]), status: 'COMPLETED' },
      { ...doc([{ email: 'a@x.com', role: 'SIGNER' }]), status: 'REJECTED' },
    ]) {
      const message = renderTrackerCard({
        document,
        organizationName: ORG,
        appUrl: APP_URL,
        interactive: true,
      });

      const verbs = findAll(message.card, 'Action.Execute').map((a) => a.verb);
      expect(verbs).not.toContain('document.remind');
    }
  });

  it('does not double the slash in the document URL', () => {
    const message = renderTrackerCard({ document: doc(), organizationName: ORG, appUrl: APP_URL });

    expect(JSON.stringify(message.card)).toContain('https://app.hubsign.io/documents/42');
    expect(JSON.stringify(message.card)).not.toContain('.io//documents');
  });
});

describe('renderMilestoneCard', () => {
  it('titles the card by event and names the document', () => {
    const message = renderMilestoneCard({
      event: 'DOCUMENT_COMPLETED',
      document: doc(),
      organizationName: ORG,
      appUrl: APP_URL,
    });

    expect(message.summary).toBe('Completed: Master Services Agreement');
    expect(JSON.stringify(message.card)).toContain('Master Services Agreement');
  });

  it('renders every workflow event without falling back to the generic bell', () => {
    const events = [
      'DOCUMENT_CREATED',
      'DOCUMENT_SENT',
      'DOCUMENT_OPENED',
      'DOCUMENT_SIGNED',
      'DOCUMENT_COMPLETED',
      'DOCUMENT_REJECTED',
      'DOCUMENT_CANCELLED',
      'DMS_DOCUMENT_FILED',
      'DMS_DOCUMENT_CLASSIFIED',
      'DMS_RETRIEVAL_REQUESTED',
      'INBOX_EMAIL_RECEIVED',
      'INBOX_OCR_COMPLETED',
    ] as const;

    for (const event of events) {
      const message = renderMilestoneCard({
        event,
        document: doc(),
        organizationName: ORG,
        appUrl: APP_URL,
      });

      expect(message.summary, event).not.toContain(event);
    }
  });

  it('never emits interactive actions (it may be webhook-delivered)', () => {
    const message = renderMilestoneCard({
      event: 'DOCUMENT_SENT',
      document: doc([{ email: 'a@x.com', role: 'SIGNER' }]),
      organizationName: ORG,
      appUrl: APP_URL,
    });

    expect(findAll(message.card, 'Action.Execute')).toHaveLength(0);
  });
});

describe('renderDigestCard', () => {
  const item = (id: number, overdueDays?: number) => ({
    id,
    title: `Doc ${id}`,
    signed: 1,
    total: 3,
    overdueDays,
  });

  it('counts only positive overdueDays as overdue', () => {
    const message = renderDigestCard({
      organizationName: ORG,
      appUrl: APP_URL,
      pending: [item(1, 3), item(2, 0), item(3, -2), item(4)],
      completedCount: 7,
      period: 'last 24 hours',
    });

    expect(message.summary).toBe('HubSign digest — 4 pending, 1 overdue');
  });

  it('truncates long lists and says how many were hidden', () => {
    const pending = Array.from({ length: 25 }, (_, i) => item(i + 1));

    const message = renderDigestCard({
      organizationName: ORG,
      appUrl: APP_URL,
      pending,
      completedCount: 0,
      period: 'last 24 hours',
      maxItems: 10,
    });

    const json = JSON.stringify(message.card);
    expect(json).toContain('+ 15 more');
    expect(json).toContain('Doc 10');
    expect(json).not.toContain('Doc 11');
  });

  it('celebrates an empty queue instead of rendering an empty container', () => {
    const message = renderDigestCard({
      organizationName: ORG,
      appUrl: APP_URL,
      pending: [],
      completedCount: 3,
      period: 'today',
    });

    expect(JSON.stringify(message.card)).toContain('Nothing pending');
  });
});

describe('toCardEnvelope', () => {
  it('wraps the card in the attachment shape both transports accept', () => {
    const message = renderMilestoneCard({
      event: 'DOCUMENT_SENT',
      document: doc(),
      organizationName: ORG,
      appUrl: APP_URL,
    });

    const envelope = toCardEnvelope(message);

    expect(envelope.type).toBe('message');
    expect(envelope.summary).toBe(message.summary);
    expect(envelope.attachments).toHaveLength(1);
    expect(envelope.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(envelope.attachments[0].content).toBe(message.card);
    // Adaptive Cards, not the retired MessageCard format.
    expect(JSON.stringify(envelope)).not.toContain('MessageCard');
  });
});
