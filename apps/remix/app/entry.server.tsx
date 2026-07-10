import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { PassThrough } from 'node:stream';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';
import type { AppLoadContext, EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

import { APP_I18N_OPTIONS } from '@documenso/lib/constants/i18n';
import { pollAllOrgInboxes } from '@documenso/lib/server-only/inbox/poll-workhub-inbox';
import { dynamicActivate, extractLocaleData } from '@documenso/lib/utils/i18n';
import { remember } from '@documenso/lib/utils/remember';

import { langCookie } from './storage/lang-cookie.server';

export const streamTimeout = 5_000;

// Self-scheduled WorkHub inbox polling, run in-process so it works identically
// under `react-router dev` and the production build — unlike a scheduler in
// `server/main.js`, which is only ever executed by the production Hono
// bundle. `remember` (also used for the Prisma client singleton) guards
// against Vite HMR re-evaluating this module and spinning up duplicate
// intervals.
const INBOX_POLL_INTERVAL_MS = 20_000;

remember('inboxPollScheduler', () => {
  const poll = () => void pollAllOrgInboxes().catch((err) => console.error('[inbox-poll]', err));
  poll();
  return setInterval(poll, INBOX_POLL_INTERVAL_MS);
});

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  let language = await langCookie.parse(request.headers.get('cookie') ?? '');

  if (!APP_I18N_OPTIONS.supportedLangs.includes(language)) {
    language = extractLocaleData({ headers: request.headers }).lang;
  }

  await dynamicActivate(language);

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get('user-agent');

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady';

    const { pipe, abort } = renderToPipeableStream(
      <I18nProvider i18n={i18n}>
        <ServerRouter context={routerContext} url={request.url} />
      </I18nProvider>,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('Content-Type', 'text/html');

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    setTimeout(abort, streamTimeout + 1000);
  });
}
