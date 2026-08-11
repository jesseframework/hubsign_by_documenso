import { env } from '@documenso/lib/utils/env';

export const APP_DOCUMENT_UPLOAD_SIZE_LIMIT =
  Number(env('NEXT_PUBLIC_DOCUMENT_SIZE_UPLOAD_LIMIT')) || 50;

export const NEXT_PUBLIC_WEBAPP_URL = () =>
  env('NEXT_PUBLIC_WEBAPP_URL') ?? 'http://localhost:3000';

export const NEXT_PRIVATE_INTERNAL_WEBAPP_URL =
  env('NEXT_PRIVATE_INTERNAL_WEBAPP_URL') ?? NEXT_PUBLIC_WEBAPP_URL();

export const IS_BILLING_ENABLED = () => env('NEXT_PUBLIC_FEATURE_BILLING_ENABLED') === 'true';

/**
 * Which kind of deployment this instance is — decides which Enterprise org
 * seat price applies (see `ORG_SEAT_TIERS`). Defaults to `dedicated` so any
 * new/other stack needs zero configuration; only the main shared multi-tenant
 * production stack (app.hubsign.io) needs this explicitly set to `shared`.
 */
export const DEPLOYMENT_TYPE = (): 'shared' | 'dedicated' =>
  env('NEXT_PUBLIC_DEPLOYMENT_TYPE') === 'shared' ? 'shared' : 'dedicated';

/**
 * The domain inbound signing emails are addressed to. Each org's inbox alias is
 * `<org-slug>@<this domain>`. Public so the UI can display the alias.
 */
export const INBOUND_EMAIL_DOMAIN = () =>
  env('NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN') ?? 'inbox.hubsign.io';

export const API_V2_BETA_URL = '/api/v2-beta';
