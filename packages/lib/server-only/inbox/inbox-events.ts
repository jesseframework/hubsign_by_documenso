/**
 * Tiny in-process pub/sub for realtime Signature Inbox updates, consumed by the
 * SSE endpoint (`/api/inbox/events`). Events are scoped per organization so a
 * client only receives its own org's updates.
 *
 * NOTE: in-process only — works because the app runs as a single Node process.
 * If it's ever scaled horizontally, swap the EventEmitter for Redis pub/sub.
 */

import { EventEmitter } from 'node:events';

export type InboxEvent = {
  /** 'new' = item ingested, 'ocr' = OCR finished, 'update' = status changed. */
  type: 'new' | 'ocr' | 'update';
  inboxItemId?: string;
  status?: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per connected SSE client

const channel = (organizationId: number) => `inbox:${organizationId}`;

export const publishInboxEvent = (organizationId: number, event: InboxEvent): void => {
  emitter.emit(channel(organizationId), event);
};

/** Subscribe to an org's inbox events. Returns an unsubscribe function. */
export const subscribeInboxEvents = (
  organizationId: number,
  handler: (event: InboxEvent) => void,
): (() => void) => {
  const ch = channel(organizationId);
  emitter.on(ch, handler);
  return () => emitter.off(ch, handler);
};
