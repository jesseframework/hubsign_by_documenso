import { Hono } from 'hono';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { prisma } from '@documenso/prisma';

import { GoogleAuthOptions, OidcAuthOptions } from '../config';
import { getOidcConfigForOrgSlug } from '../lib/utils/get-org-oidc-config';
import { handleOAuthCallbackUrl } from '../lib/utils/handle-oauth-callback-url';
import type { HonoAuthContext } from '../types/context';

/**
 * Have to create this route instead of bundling callback with oauth routes to provide
 * backwards compatibility for self-hosters (since we used to use NextAuth).
 */
export const callbackRoute = new Hono<HonoAuthContext>()
  /**
   * OIDC callback verification.
   *
   * If the callback URL has `?org=<slug>` (set by the per-org initiate flow),
   * use the org's OIDC config and auto-add the user to the OrganizationMember
   * table on first sign-in.
   */
  .get('/oidc', async (c) => {
    const orgSlug = c.req.query('org');

    if (orgSlug) {
      const orgConfig = await getOidcConfigForOrgSlug(orgSlug);
      if (!orgConfig) {
        throw new AppError(AppErrorCode.NOT_SETUP, {
          message: `Organization "${orgSlug}" does not have SSO configured.`,
        });
      }

      return handleOAuthCallbackUrl({
        c,
        clientOptions: orgConfig,
        // Auto-add the user to the org on first SSO sign-in.
        onAfterSignIn: async (userId) => {
          const existing = await prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId: orgConfig.organizationId,
                userId,
              },
            },
          });
          if (!existing) {
            await prisma.organizationMember.create({
              data: {
                organizationId: orgConfig.organizationId,
                userId,
                role: 'MEMBER',
              },
            });
          }
        },
      });
    }

    return handleOAuthCallbackUrl({ c, clientOptions: OidcAuthOptions });
  })

  /**
   * Google callback verification.
   */
  .get('/google', async (c) => handleOAuthCallbackUrl({ c, clientOptions: GoogleAuthOptions }));
