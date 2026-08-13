import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';
import type { AppLoadContext, EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

import { APP_I18N_OPTIONS } from '@documenso/lib/constants/i18n';
import { dynamicActivate, extractLocaleData } from '@documenso/lib/utils/i18n';

import { buildCspHeader, getCspHeaderName, getCspMode } from '../server/csp';
import { NonceProvider } from './providers/nonce';
import { langCookie } from './storage/lang-cookie.server';

export const streamTimeout = 5_000;

const CSP_HEADERS = ['Content-Security-Policy', 'Content-Security-Policy-Report-Only'];

/**
 * Attach a nonce'd CSP to this document, unless the route already declared one.
 *
 * The `/embed/*` layout sets its own `frame-ancestors <origin>` so third
 * parties can iframe the signing flow — overwriting that would break the
 * embedded product, so an existing policy always wins.
 */
const applyCspHeader = (responseHeaders: Headers, nonce: string) => {
  const mode = getCspMode();

  if (mode === 'off' || CSP_HEADERS.some((header) => responseHeaders.has(header))) {
    return;
  }

  responseHeaders.set(getCspHeaderName(mode), buildCspHeader(nonce));
};

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

  // One nonce per document. Base64 of 16 random bytes — every character is
  // valid in a CSP nonce-value, and 128 bits is well past guessable.
  const nonce = randomBytes(16).toString('base64');

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get('user-agent');

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady';

    const { pipe, abort } = renderToPipeableStream(
      <NonceProvider nonce={nonce}>
        <I18nProvider i18n={i18n}>
          {/* Nonces the inline scripts that stream deferred loader data down. */}
          <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
        </I18nProvider>
      </NonceProvider>,
      {
        // React emits its own inline scripts to reveal Suspense boundaries
        // after the shell flushes; without this they'd be blocked too.
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('Content-Type', 'text/html');
          applyCspHeader(responseHeaders, nonce);

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
