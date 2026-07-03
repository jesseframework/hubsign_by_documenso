import { Outlet } from 'react-router';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Settings');
}

/**
 * Settings layout. The section nav now lives in the app sidebar (expandable
 * under "Settings"); this keeps the content card wrapper.
 */
export default function SettingsLayout() {
  return (
    <div className="w-full">
      <div className="rounded-[var(--r)] border border-border bg-card p-4 sm:p-6">
        <Outlet />
      </div>
    </div>
  );
}
