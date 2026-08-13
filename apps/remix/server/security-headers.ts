import type { Context, Next } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { env } from '@documenso/lib/utils/env';

import { STRIPE_JS, buildCspHeader, getCspHeaderName, getCspMode } from './csp';

/**
 * Security response headers for the origin.
 *
 * The external blackbox pass (2026-08-13) found the app shipping none of these,
 * which left the sign/approve flows framable — clickjacking is the one that
 * actually threatens signing integrity, so `frame-ancestors`/XFO are the point
 * of this file and everything else is defence in depth.
 *
 * Two things make this less mechanical than dropping in `secureHeaders()`:
 *
 *  1. `/embed/*` is *meant* to be framed — that's the embedded signing product.
 *     Those routes set their own `frame-ancestors <origin>` in
 *     `app/routes/embed+/_v0+/_layout.tsx`, and because Hono's `secureHeaders`
 *     writes after the handler with `headers.set()` it would clobber that. So
 *     embed responses get a reduced set: no CSP, no XFO, and no COOP/CORP
 *     either (CORP is enforced on iframe navigations and would break framing).
 *
 *  2. SSR documents set their own nonce'd CSP in `app/entry.server.tsx`, since
 *     the nonce has to be minted at render time. Any response that already
 *     carries a policy keeps it; this middleware only fills the gap for
 *     everything else.
 *
 * The policy itself lives in `./csp` so both emitters share one definition.
 */

/** The CSP header names we might find already set on a response. */
const CSP_HEADERS = ['Content-Security-Policy', 'Content-Security-Policy-Report-Only'];

/** Nonce-less policy, for responses that have no inline scripts to bless. */
const staticCspHeaderValue = buildCspHeader();

/** Whether this request reached us over TLS (Cloudflare terminates it). */
const isHttps = (c: Context): boolean => {
  const forwardedProto = c.req.header('x-forwarded-proto');

  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim() === 'https';
  }

  return new URL(c.req.url).protocol === 'https:';
};

/**
 * No `preload` — that's a one-way door, and it only goes in once FIX-01
 * (Always Use HTTPS at the edge) is verified in production.
 */
const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Paths that must stay reachable over plain HTTP.
 *
 * Render health-checks `/api/health` over the internal network, and redirecting
 * it would fail the check and take the service out of rotation. ACME HTTP-01
 * challenges have to be answered over HTTP by definition.
 */
const HTTPS_REDIRECT_EXEMPT = /^(\/api\/health|\/\.well-known\/acme-challenge\/)/;

/**
 * Redirect plaintext requests to HTTPS.
 *
 * The real fix is at the edge (Cloudflare → SSL/TLS → Always Use HTTPS); this
 * is defence in depth for anything that reaches the origin directly. It only
 * arms itself when the instance is configured with an `https://` app URL, so
 * local development over HTTP is untouched.
 *
 * `x-forwarded-proto` is what we trust, since Cloudflare terminates TLS and the
 * origin socket itself is plaintext. If you front the app with a proxy that
 * terminates TLS *without* setting that header, every request will look
 * plaintext and this will loop — set NEXT_PRIVATE_DISABLE_HTTPS_REDIRECT=true
 * and fix the proxy.
 */
export const enforceHttps = async (c: Context, next: Next) => {
  const appUrl = NEXT_PUBLIC_WEBAPP_URL();

  const enabled =
    appUrl.startsWith('https://') && env('NEXT_PRIVATE_DISABLE_HTTPS_REDIRECT') !== 'true';

  if (!enabled || isHttps(c) || HTTPS_REDIRECT_EXEMPT.test(c.req.path)) {
    return next();
  }

  const target = new URL(c.req.url);
  target.protocol = 'https:';
  target.port = '';

  // 308 preserves the method and body; a 301 would silently turn a POSTed
  // signature into a GET. GET/HEAD keep the cacheable 301 the retest expects.
  const status = c.req.method === 'GET' || c.req.method === 'HEAD' ? 301 : 308;

  return c.redirect(target.toString(), status);
};

/**
 * `payment` stays delegated to Stripe rather than denied — locking it to `()`
 * silently drops Apple Pay / Google Pay out of Embedded Checkout. Passkey
 * sign-in relies on `publickey-credentials-get`, which is left unlisted so it
 * keeps its `self` default.
 */
const PERMISSIONS_POLICY: NonNullable<Parameters<typeof secureHeaders>[0]>['permissionsPolicy'] = {
  camera: [],
  microphone: [],
  geolocation: [],
  usb: [],
  payment: ['self', STRIPE_JS],
};

const appSecureHeaders = secureHeaders({
  strictTransportSecurity: false, // Set per-request, HTTPS only.
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  crossOriginEmbedderPolicy: false,
  permissionsPolicy: PERMISSIONS_POLICY,
});

/**
 * Embedded signing is framed by third parties by design, so the framing
 * controls have to come off: no XFO, no CSP (the route sets its own
 * `frame-ancestors`), and no COOP/CORP.
 */
const embedSecureHeaders = secureHeaders({
  strictTransportSecurity: false, // Set per-request, HTTPS only.
  xFrameOptions: false,
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  permissionsPolicy: PERMISSIONS_POLICY,
});

const isEmbedPath = (path: string): boolean => path === '/embed' || path.startsWith('/embed/');

export const securityHeaders = async (c: Context, next: Next) => {
  const embedded = isEmbedPath(c.req.path);

  await (embedded ? embedSecureHeaders : appSecureHeaders)(c, next);

  // Only meaningful over TLS, and sending it from a plain-HTTP dev origin is a
  // good way to lock yourself out of localhost subdomains.
  if (isHttps(c)) {
    c.res.headers.set('Strict-Transport-Security', HSTS_VALUE);
  }

  const cspMode = getCspMode();

  // Embed routes and SSR documents both set their own policy — don't clobber it.
  if (embedded || cspMode === 'off' || CSP_HEADERS.some((header) => c.res.headers.has(header))) {
    return;
  }

  c.res.headers.set(getCspHeaderName(cspMode), staticCspHeaderValue);
};
