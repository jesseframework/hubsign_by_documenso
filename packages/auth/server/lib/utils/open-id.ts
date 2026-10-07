import { z } from 'zod';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';

const ZOpenIdConfigurationSchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  scopes_supported: z.array(z.string()).optional(),
});

type OpenIdConfiguration = z.infer<typeof ZOpenIdConfigurationSchema>;

type GetOpenIdConfigurationOptions = {
  requiredScopes?: string[];
};

/**
 * Hint for the single most common way this is misconfigured.
 *
 * Microsoft publishes two discovery documents per tenant. The v1.0 one, at
 * `/.well-known/openid-configuration`, advertises `scopes_supported: ["openid"]`
 * and nothing else; the v2.0 one, at `/v2.0/.well-known/openid-configuration`,
 * advertises `openid`, `profile`, `email` and `offline_access`. An admin who
 * pastes the v1.0 URL — the one most search results show — fails the scope
 * check below and has no way to tell why from the response.
 */
const microsoftV2Hint = (wellKnownUrl: string): string => {
  if (!wellKnownUrl.includes('login.microsoftonline.com') || wellKnownUrl.includes('/v2.0/')) {
    return '';
  }

  return (
    ' This looks like a Microsoft v1.0 endpoint, which only advertises the "openid" scope. ' +
    'Use the v2.0 document instead: ' +
    'https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration'
  );
};

export const getOpenIdConfiguration = async (
  wellKnownUrl: string,
  options: GetOpenIdConfigurationOptions = {},
): Promise<OpenIdConfiguration> => {
  /*
    Everything below raises AppError rather than Error.

    A plain Error misses both typed branches of the auth error handler
    (packages/auth/server/index.ts) and lands in its final fallback, which
    answers `{"code":"UNKNOWN_ERROR","message":"Internal Server Error"}` with a
    500. Every failure in here is a configuration problem belonging to the
    organization's SSO settings — wrong URL, wrong tenant, wrong scopes — so
    reporting them as a server fault sent admins looking for a crash that never
    happened, while the real reason sat in a log line.
  */
  if (!wellKnownUrl) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message: 'No OpenID discovery URL is configured for this provider.',
      statusCode: 400,
    });
  }

  let response: Response;

  try {
    response = await fetch(wellKnownUrl);
  } catch (err) {
    // DNS failure, TLS failure, a host that is not reachable from the server.
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        `Could not reach the OpenID discovery URL (${wellKnownUrl}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      statusCode: 400,
    });
  }

  if (!response.ok) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        `The OpenID discovery URL (${wellKnownUrl}) returned ` +
        `${response.status} ${response.statusText}.`,
      statusCode: 400,
    });
  }

  const rawConfig = await response.json().catch(() => null);

  const parsed = ZOpenIdConfigurationSchema.safeParse(rawConfig);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');

    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        `The OpenID discovery URL (${wellKnownUrl}) did not return a valid discovery ` +
        `document${missing ? ` (problem with: ${missing})` : ''}.`,
      statusCode: 400,
    });
  }

  const config = parsed.data;

  const supportedScopes = config.scopes_supported ?? [];
  const requiredScopes = options.requiredScopes ?? [];

  /*
    Only checked when the provider actually advertises a list.

    `scopes_supported` is RECOMMENDED rather than required by OpenID Discovery,
    and the spec says a server "MAY choose not to advertise some supported scope
    values" — so an absent list means unknown, not unsupported. Treating absent
    as empty failed every scope and locked out providers that simply do not
    publish one.
  */
  const unsupportedScopes = config.scopes_supported
    ? requiredScopes.filter((scope) => !supportedScopes.includes(scope))
    : [];

  if (unsupportedScopes.length > 0) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        `The identity provider does not support the scopes this sign-in needs: ` +
        `${unsupportedScopes.join(', ')}. It advertises: ${supportedScopes.join(', ') || 'none'}.` +
        microsoftV2Hint(wellKnownUrl),
      statusCode: 400,
    });
  }

  return config;
};
