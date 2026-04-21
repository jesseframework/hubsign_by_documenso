import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';

import { GoogleAuthOptions, OidcAuthOptions } from '../config';
import { getOidcConfigForOrgSlug } from '../lib/utils/get-org-oidc-config';
import { handleOAuthAuthorizeUrl } from '../lib/utils/handle-oauth-authorize-url';
import type { HonoAuthContext } from '../types/context';

const ZOAuthAuthorizeSchema = z.object({
  redirectPath: z.string().optional(),
  // Optional: when present, use the org's OIDC config instead of the global env-based one.
  orgSlug: z.string().min(1).max(120).optional(),
});

export const oauthRoute = new Hono<HonoAuthContext>()
  /**
   * Google authorize endpoint.
   */
  .post('/authorize/google', sValidator('json', ZOAuthAuthorizeSchema), async (c) => {
    const { redirectPath } = c.req.valid('json');

    return handleOAuthAuthorizeUrl({
      c,
      clientOptions: GoogleAuthOptions,
      redirectPath,
    });
  })
  /**
   * OIDC authorize endpoint.
   *
   * If `orgSlug` is supplied and that org has OIDC SSO configured, we use the
   * org's client_id/secret/well-known URL. Otherwise we fall back to the
   * global env-based OIDC config.
   */
  .post('/authorize/oidc', sValidator('json', ZOAuthAuthorizeSchema), async (c) => {
    const { redirectPath, orgSlug } = c.req.valid('json');

    let clientOptions = OidcAuthOptions;
    if (orgSlug) {
      const orgConfig = await getOidcConfigForOrgSlug(orgSlug);
      if (orgConfig) {
        clientOptions = orgConfig;
      } else {
        throw new AppError(AppErrorCode.NOT_SETUP, {
          message: `Organization "${orgSlug}" does not have SSO configured.`,
        });
      }
    }

    return handleOAuthAuthorizeUrl({
      c,
      clientOptions,
      redirectPath,
    });
  });
