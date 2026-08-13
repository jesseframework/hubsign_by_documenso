import { env } from '@documenso/lib/utils/env';

/**
 * The Content-Security-Policy itself, kept free of Hono so both layers that
 * emit it can share one definition:
 *
 *  - `server/security-headers.ts` stamps the nonce-less policy on everything
 *    that isn't an SSR document — API responses, `.data` loader payloads,
 *    static assets, the FCM service worker.
 *  - `app/entry.server.tsx` stamps a per-request nonce'd policy on documents,
 *    where the inline hydration/theme/env scripts live.
 *
 * Documents are the only responses that carry inline scripts, so they're the
 * only ones that need a nonce; everything else gets `script-src 'self' …` with
 * no inline escape hatch at all.
 *
 * Ship report-only, read `/api/csp-report`, then flip
 * `NEXT_PRIVATE_CSP_MODE=enforce`.
 */

/** Where violation reports land. Handled in `server/api/csp-report.ts`. */
export const CSP_REPORT_PATH = '/api/csp-report';

// Hosts the app genuinely talks to. Anything added here should come with a
// reason, because every entry is a place an injected script could exfiltrate to.
/** `<link rel=stylesheet>` for Inter + Caveat (app/root.tsx). */
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
/** The font files those stylesheets reference. */
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';
/** `importScripts()` of firebase-*-compat.js in the FCM service worker. */
const GSTATIC = 'https://www.gstatic.com';
/** plausible-tracker posts pageviews to its default apiHost. */
const PLAUSIBLE = 'https://plausible.io';
/** Firebase installations + FCM registration/send endpoints. */
const GOOGLE_APIS = 'https://*.googleapis.com';
/**
 * Cloudflare Turnstile gates signup — `components/general/turnstile.tsx` injects
 * its script tag at runtime, so it can't carry a nonce and has to be
 * allowlisted by host. The widget itself renders in an iframe and phones home,
 * hence frame-src and connect-src too.
 */
const TURNSTILE = 'https://challenges.cloudflare.com';
/** Stripe Embedded Checkout — see `components/general/embedded-checkout-form.tsx`. */
export const STRIPE_JS = 'https://js.stripe.com';
const STRIPE_FRAMES = ['https://js.stripe.com', 'https://checkout.stripe.com'];
const STRIPE_APIS = [
  'https://api.stripe.com',
  'https://checkout.stripe.com',
  'https://merchant-ui-api.stripe.com',
];

export type CspMode = 'enforce' | 'report-only' | 'off';

/**
 * Report-only by default: an enforcing CSP that turns out to be wrong takes the
 * whole app down, and the report endpoint is how we find out before that.
 */
export const getCspMode = (): CspMode => {
  switch (env('NEXT_PRIVATE_CSP_MODE')) {
    case 'enforce':
      return 'enforce';
    case 'off':
      return 'off';
    default:
      return 'report-only';
  }
};

export const getCspHeaderName = (mode: CspMode): string =>
  mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

const buildCspDirectives = (nonce?: string): Record<string, string[]> => ({
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'form-action': ["'self'"],

  // The clickjacking fix. `/embed/*` is excluded from the middleware entirely.
  'frame-ancestors': ["'none'"],
  'frame-src': ["'self'", ...STRIPE_FRAMES, TURNSTILE],

  // No 'unsafe-inline': documents nonce their inline scripts, and nothing else
  // we serve has any. Note that a browser which understands nonces ignores
  // 'unsafe-inline' anyway, so there is no point keeping it as a fallback.
  //
  // Expect a recurring `blocked-uri: eval` report from the pdf.js worker: it
  // probes for eval with `try { new Function('') }` and falls back to its
  // interpreter when the probe fails. That report is the fallback working —
  // do NOT answer it by adding 'unsafe-eval'.
  'script-src': ["'self'", ...(nonce ? [`'nonce-${nonce}'`] : []), GSTATIC, STRIPE_JS, TURNSTILE],

  // Inline styles stay: React writes `style` attributes throughout, and
  // style attributes are governed by style-src-attr, which nonces can't cover.
  'style-src': ["'self'", "'unsafe-inline'", GOOGLE_FONTS_CSS],
  'font-src': ["'self'", 'data:', GOOGLE_FONTS_FILES],

  // blob: for signature canvases and upload previews, data: for inline assets,
  // https: because org branding logos can point anywhere.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'data:', 'blob:'],

  'connect-src': ["'self'", PLAUSIBLE, GOOGLE_APIS, ...STRIPE_APIS, TURNSTILE],

  // pdf.js ships its worker as a bundled asset but falls back to a blob worker.
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
});

/**
 * Hono's `secureHeaders` CSP builder has no `report-uri`, only the newer
 * `report-to` that Firefox and Safari still don't implement. We want reports
 * from every browser during the report-only phase, so the policy is built here.
 *
 * @param nonce Per-request nonce for documents. Omit for everything else.
 */
export const buildCspHeader = (nonce?: string): string =>
  Object.entries(buildCspDirectives(nonce))
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .concat(`report-uri ${CSP_REPORT_PATH}`)
    .join('; ');
