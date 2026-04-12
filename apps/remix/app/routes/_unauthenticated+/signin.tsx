import { Trans } from '@lingui/react/macro';
import { Link, redirect } from 'react-router';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import {
  IS_GOOGLE_SSO_ENABLED,
  IS_OIDC_SSO_ENABLED,
  OIDC_PROVIDER_LABEL,
} from '@documenso/lib/constants/auth';
import { env } from '@documenso/lib/utils/env';

import { BrandingLogo } from '~/components/general/branding-logo';
import { SignInForm } from '~/components/forms/signin';
import { appMetaTags } from '~/utils/meta';

import type { Route } from './+types/signin';

export function meta() {
  return appMetaTags('Sign In');
}

export async function loader({ request }: Route.LoaderArgs) {
  const { isAuthenticated } = await getOptionalSession(request);

  const isGoogleSSOEnabled = IS_GOOGLE_SSO_ENABLED;
  const isOIDCSSOEnabled = IS_OIDC_SSO_ENABLED;
  const oidcProviderLabel = OIDC_PROVIDER_LABEL;

  if (isAuthenticated) {
    throw redirect('/documents');
  }

  return {
    isGoogleSSOEnabled,
    isOIDCSSOEnabled,
    oidcProviderLabel,
  };
}

export default function SignIn({ loaderData }: Route.ComponentProps) {
  const { isGoogleSSOEnabled, isOIDCSSOEnabled, oidcProviderLabel } = loaderData;

  return (
    <div className="w-full px-4">
      {/* Logo */}
      <div className="mb-8 flex justify-center">
        <BrandingLogo className="h-10 w-auto" />
      </div>

      {/* Card */}
      <div className="rounded-[var(--r)] border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          <Trans>Sign in to your account</Trans>
        </h1>

        <p className="text-muted-foreground mt-1.5 text-[13px]">
          <Trans>Welcome back, we are lucky to have you.</Trans>
        </p>

        <hr className="-mx-6 my-4 border-border" />

        <SignInForm
          isGoogleSSOEnabled={isGoogleSSOEnabled}
          isOIDCSSOEnabled={isOIDCSSOEnabled}
          oidcProviderLabel={oidcProviderLabel}
        />

        {env('NEXT_PUBLIC_DISABLE_SIGNUP') !== 'true' && (
          <p className="text-muted-foreground mt-6 text-center text-[13px]">
            <Trans>
              Don't have an account?{' '}
              <Link to="/signup" className="text-primary duration-200 hover:opacity-70">
                Sign up
              </Link>
            </Trans>
          </p>
        )}
      </div>
    </div>
  );
}
