import { Trans } from '@lingui/react/macro';
import { Outlet } from 'react-router';

import { SettingsDesktopNav } from '~/components/general/settings-nav-desktop';
import { SettingsMobileNav } from '~/components/general/settings-nav-mobile';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Settings');
}

export default function SettingsLayout() {
  return (
    <div className="w-full">
      <h1 className="text-xl font-semibold tracking-tight">
        <Trans>Settings</Trans>
      </h1>

      <div className="mt-5 flex gap-6">
        {/* Desktop nav */}
        <div className="hidden w-[220px] flex-shrink-0 md:block">
          <div className="sticky top-20 rounded-[var(--r)] border border-border bg-card p-2">
            <SettingsDesktopNav />
          </div>
        </div>

        {/* Mobile nav */}
        <div className="mb-4 md:hidden">
          <SettingsMobileNav />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="rounded-[var(--r)] border border-border bg-card p-4 sm:p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
