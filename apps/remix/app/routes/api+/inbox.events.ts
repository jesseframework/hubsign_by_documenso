/**
 * Server-Sent Events stream for realtime Signature Inbox updates.
 *
 * The browser opens an EventSource to `/api/inbox/events`; we authenticate via
 * the session cookie, resolve the caller's organization, and stream that org's
 * inbox events (new item, OCR finished). The client invalidates its tRPC inbox
 * queries on each event so the list/detail refresh without a manual reload.
 */

import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { subscribeInboxEvents } from '@documenso/lib/server-only/inbox/inbox-events';
import { prisma } from '@documenso/prisma';

import type { Route } from './+types/inbox.events';

export const loader = async ({ request }: Route.LoaderArgs) => {
  const session = await getSession(request).catch(() => null);
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id },
  });
  if (!membership) {
    return new Response('Forbidden', { status: 403 });
  }
  const organizationId = membership.organizationId;

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client gone) — ignore.
        }
      };

      enqueue(': connected\n\n');

      unsubscribe = subscribeInboxEvents(organizationId, (event) => {
        enqueue(`event: inbox\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // Comment ping keeps the connection alive through idle-timeout proxies.
      heartbeat = setInterval(() => enqueue(': ping\n\n'), 25_000);

      request.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable proxy buffering (e.g. nginx) so events flush immediately.
      'x-accel-buffering': 'no',
    },
  });
};
