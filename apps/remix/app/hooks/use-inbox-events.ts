import { useEffect } from 'react';

import { trpc } from '@documenso/trpc/react';

/**
 * Subscribes to the Signature Inbox SSE stream and refreshes the relevant tRPC
 * queries whenever the server pushes an event (new item ingested, OCR finished).
 * The browser's EventSource reconnects automatically on transient drops.
 *
 * @param itemId when on a detail page, also invalidate that item's query.
 */
export const useInboxEvents = (itemId?: string) => {
  const utils = trpc.useUtils();

  useEffect(() => {
    const source = new EventSource('/api/inbox/events');

    source.addEventListener('inbox', () => {
      void utils.inbox.list.invalidate();
      if (itemId) void utils.inbox.get.invalidate({ id: itemId });
    });

    return () => source.close();
  }, [utils, itemId]);
};
