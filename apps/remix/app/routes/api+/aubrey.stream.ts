/**
 * Aubrey chat over Server-Sent Events.
 *
 * Not token streaming — WorkHub's AI bridge returns each turn complete and has
 * no streaming mode (probed: `stream: true` is silently ignored, `chatStream` is
 * an unknown operation). What this streams is *progress*: a tool-using answer
 * takes several sequential model calls and can run past ten seconds, and the
 * steps in between are real, knowable, and worth showing.
 *
 * POST rather than GET, so this uses `action` and the client reads the body with
 * fetch instead of EventSource — EventSource cannot send a request body, and the
 * message doesn't belong in a query string.
 *
 * The tRPC `aubrey.chat` mutation stays as-is: same function underneath, minus
 * the progress channel. Non-browser callers and the fallback path use it.
 */

import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { AubreyServiceError, aubreyChat } from '@documenso/lib/server-only/aubrey/agent';
import { AubreyCreditError } from '@documenso/lib/server-only/aubrey/credits';

import type { Route } from './+types/aubrey.stream';

export const action = async ({ request }: Route.ActionArgs) => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const session = await getSession(request).catch(() => null);
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : undefined;

  if (!message) {
    return new Response('Bad Request', { status: 400 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;

      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client hung up mid-write.
          open = false;
        }
      };

      // Proxies and browsers alike hold a stream that has produced nothing.
      // An immediate comment gets the connection established so the first real
      // step lands the moment it happens.
      try {
        controller.enqueue(encoder.encode(': open\n\n'));
      } catch {
        open = false;
      }

      try {
        const result = await aubreyChat({
          userId,
          message,
          conversationId,
          onProgress: (event) => send('progress', event),
        });

        send('done', {
          conversationId: result.conversationId,
          messageId: result.messageId,
          content: result.content,
          credit: result.credit,
        });
      } catch (err) {
        /*
          Errors travel as an SSE event, not an HTTP status: by the time the
          model call fails the response has already been committed as a 200
          stream. The client reads `error` and renders it the same way it would
          a failed mutation.
        */
        if (err instanceof AubreyCreditError) {
          send('error', { message: err.message, kind: 'credits' });
        } else if (err instanceof AubreyServiceError) {
          console.error('[aubrey/stream]', err.detail);
          send('error', { message: err.message, kind: 'service' });
        } else {
          console.error('[aubrey/stream] unexpected failure:', err);
          send('error', {
            message: 'Aubrey could not complete that request.',
            kind: 'unknown',
          });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stop nginx and friends buffering the steps into one late flush.
      'x-accel-buffering': 'no',
    },
  });
};
