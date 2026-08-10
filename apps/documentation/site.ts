/**
 * Deployment-specific addresses used by the documentation.
 *
 * These were hard-coded into individual pages, which meant a link that says
 * "open your security settings" pointed at one fixed host — wrong for any tenant
 * not served from it, and wrong when reading the docs from a different
 * environment.
 *
 * The site is a static export, so `NEXT_PUBLIC_*` values are inlined at build
 * time rather than read at runtime. To change them, set the variable for the
 * build (the Dockerfile forwards both as build args) and rebuild — there is no
 * runtime setting to flip.
 */

/** The HubSign application itself — where a reader actually signs in. */
export const APP_URL = (
  process.env.NEXT_PUBLIC_HUBSIGN_APP_URL || 'https://app.hubsign.io'
).replace(/\/+$/, '');

/** The public marketing site, used for company links in the footer. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_HUBSIGN_SITE_URL || 'https://hubsign.io'
).replace(/\/+$/, '');

/** Where readers should be sent for help. */
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_HUBSIGN_SUPPORT_EMAIL || 'support@fepro.io';

/** Build an absolute link into the application. */
export const appUrl = (path = '') => `${APP_URL}/${String(path).replace(/^\/+/, '')}`;
