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
  /**
   * - `new`      an item was ingested
   * - `ocr`      OCR finished (succeeded or failed)
   * - `update`   a user action changed the item's status (send / archive / reprocess)
   * - `viewed`   an item was opened, so the org's unread count moved
   * - `workflow` a workflow run triggered by the item changed state
   */
  type: 'new' | 'ocr' | 'update' | 'viewed' | 'workflow';
  inboxItemId?: string;
  status?: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per connected SSE client

const channel = (organizationId: number) => `inbox:${organizationId}`;

/**
 * Best-effort broadcast — never throws. Callers publish from the middle of
 * mutations and job handlers, where a misbehaving subscriber must not take the
 * business logic down with it.
 */
export const publishInboxEvent = (organizationId: number, event: InboxEvent): void => {
  try {
    emitter.emit(channel(organizationId), event);
  } catch (err) {
    console.error('[inbox-events] publish failed:', err);
  }
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
