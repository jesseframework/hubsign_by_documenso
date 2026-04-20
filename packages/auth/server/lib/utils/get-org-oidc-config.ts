import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { prisma } from '@documenso/prisma';

import type { OAuthClientOptions } from '../../config';

/**
 * Load per-org OIDC config and return it as an OAuthClientOptions, or null
 * if the org isn't configured for SSO.
 *
 * Used to override the global env-based OIDC config when a user signs in
 * via `/signin?org=<slug>`.
 */
export const getOidcConfigForOrgSlug = async (
  slug: string,
): Promise<(OAuthClientOptions & { organizationId: number }) | null> => {
  if (!slug) return null;

  const org = await prisma.organization.findUnique({
    where: { slug: slug.toLowerCase() },
    select: {
      id: true,
      oidcEnabled: true,
      oidcClientId: true,
      oidcClientSecret: true,
      oidcWellKnownUrl: true,
    },
  });

  if (!org || !org.oidcEnabled) return null;
  if (!org.oidcClientId || !org.oidcClientSecret || !org.oidcWellKnownUrl) return null;

  return {
    // The id is suffixed with the org slug so the cookie state for this
    // request doesn't collide with the global OIDC flow.
    id: `oidc-org-${slug}`,
    scope: ['openid', 'email', 'profile'],
    clientId: org.oidcClientId,
    clientSecret: org.oidcClientSecret,
    wellKnownUrl: org.oidcWellKnownUrl,
    redirectUrl: `${NEXT_PUBLIC_WEBAPP_URL()}/api/auth/callback/oidc?org=${encodeURIComponent(slug)}`,
    bypassEmailVerification: false,
    organizationId: org.id,
  };
};
