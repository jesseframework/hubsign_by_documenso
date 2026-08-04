import { useEffect } from 'react';

import { trpc } from '@documenso/trpc/react';

/** Mirrors `InboxEvent` in `@documenso/lib/server-only/inbox/inbox-events`. */
type InboxEvent = {
  type: 'new' | 'ocr' | 'update' | 'viewed' | 'workflow';
  inboxItemId?: string;
  status?: string;
};

type Listener = (event: InboxEvent) => void;

/**
 * One EventSource per tab, shared by every consumer (sidebar badge, inbox list,
 * inbox detail) and refcounted so it closes once the last consumer unmounts.
 * Without the sharing each consumer would hold its own connection — and its own
 * server-side subscription — against the browser's per-origin connection cap.
 */
const listeners = new Set<Listener>();
let source: EventSource | null = null;

const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = INITIAL_RECONNECT_MS;
let hasConnected = false;

const dispatch = (event: InboxEvent) => {
  for (const notify of listeners) {
    notify(event);
  }
};

const open = () => {
  const stream = new EventSource('/api/inbox/events');
  source = stream;

  stream.addEventListener('open', () => {
    reconnectDelay = INITIAL_RECONNECT_MS;

    // Anything that happened while we were disconnected was missed — this
    // stream has no replay. Force a refresh so a dropped connection can't
    // leave the UI permanently stale now that nothing polls.
    if (hasConnected) {
      dispatch({ type: 'update' });
    }

    hasConnected = true;
  });

  stream.addEventListener('inbox', (message) => {
    let event: InboxEvent;

    try {
      event = JSON.parse((message as MessageEvent<string>).data) as InboxEvent;
    } catch {
      return; // Malformed frame — nothing useful to dispatch.
    }

    dispatch(event);
  });

  stream.addEventListener('error', () => {
    // EventSource retries on its own while the socket is CONNECTING. A CLOSED
    // socket is terminal — the endpoint answered with a non-200 (an expired
    // session yielding 401, say) — so we have to reopen it ourselves.
    if (stream.readyState !== EventSource.CLOSED) {
      return;
    }

    stream.close();

    if (source === stream) {
      source = null;
    }

    scheduleReconnect();
  });
};

const scheduleReconnect = () => {
  if (reconnectTimer || source || listeners.size === 0) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (listeners.size > 0 && !source) {
      open();
    }
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);

  if (!source && !reconnectTimer) {
    open();
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      source?.close();
      source = null;
      hasConnected = false;
      reconnectDelay = INITIAL_RECONNECT_MS;
    }
  };
};

/**
 * Subscribes to the Signature Inbox event stream and refreshes the affected
 * tRPC queries whenever the server pushes an update — an item ingested, OCR
 * finished, a status changed, an item opened, or a workflow run moving. The
 * browser's EventSource reconnects automatically on transient drops.
 *
 * This is what keeps the inbox off a refetch interval: nothing polls, the
 * server tells us when something actually changed.
 *
 * @param itemId when on a detail page, also refresh that item's queries.
 * @param options.enabled set false while the caller has no organization yet.
 */
export const useInboxEvents = (itemId?: string, options?: { enabled?: boolean }) => {
  const utils = trpc.useUtils();
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribe((event) => {
      // The queue and the sidebar's unread badge can move on any event.
      void utils.inbox.list.invalidate();
      void utils.inbox.unreadCount.invalidate();

      // Refresh whichever item the event names, plus the one this page shows.
      const affected = new Set([event.inboxItemId, itemId].filter(Boolean) as string[]);

      for (const id of affected) {
        void utils.inbox.get.invalidate({ id });
        void utils.inbox.workflowActivity.invalidate({ inboxItemId: id });
      }
    });
  }, [utils, itemId, enabled]);
};
