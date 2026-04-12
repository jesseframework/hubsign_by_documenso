import { useState } from 'react';

import { Outlet, redirect } from 'react-router';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { getLimits } from '@documenso/ee/server-only/limits/client';
import { LimitsProvider } from '@documenso/ee/server-only/limits/provider/client';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { getSiteSettings } from '@documenso/lib/server-only/site-settings/get-site-settings';
import { SITE_SETTINGS_BANNER_ID } from '@documenso/lib/server-only/site-settings/schemas/banner';

import { AppBanner } from '~/components/general/app-banner';
import { AppBottomNav } from '~/components/general/app-bottom-nav';
import { AppSidebar } from '~/components/general/app-sidebar';
import { AppTopbar } from '~/components/general/app-topbar';
import { VerifyEmailBanner } from '~/components/general/verify-email-banner';

import type { Route } from './+types/_layout';

/**
 * Don't revalidate (run the loader on sequential navigations)
 *
 * Update values via providers.
 */
export const shouldRevalidate = () => false;

export async function loader({ request }: Route.LoaderArgs) {
  const requestHeaders = Object.fromEntries(request.headers.entries());

  const session = await getOptionalSession(request);

  if (!session.isAuthenticated) {
    throw redirect('/signin');
  }

  const [limits, banner] = await Promise.all([
    getLimits({ headers: requestHeaders }),
    getSiteSettings().then((settings) =>
      settings.find((setting) => setting.id === SITE_SETTINGS_BANNER_ID),
    ),
  ]);

  return {
    banner,
    limits,
  };
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  const { user, teams } = useSession();
  const { banner, limits } = loaderData;
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <LimitsProvider initialValue={limits}>
      <div id="portal-header"></div>

      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      {banner && <AppBanner banner={banner} />}

      <div className="sidebar-layout">
        <AppSidebar
          user={user}
          teams={teams}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        <div className="sidebar-main">
          <AppTopbar onHamburgerClick={() => setIsSidebarOpen(true)} />

          <main className="flex-1 px-3.5 pb-[90px] pt-3.5 sm:px-5 sm:pb-5 sm:pt-5">
            <Outlet />
          </main>
        </div>
      </div>

      <AppBottomNav />
    </LimitsProvider>
  );
}
