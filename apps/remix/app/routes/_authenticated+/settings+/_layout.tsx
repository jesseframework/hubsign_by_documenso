import { Outlet } from 'react-router';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Settings');
}

/**
 * Settings layout. The section rail and content card are supplied by
 * `ConsoleShell` in the authenticated layout — these routes are split across
 * the Account and Settings consoles (personal preferences versus organizational
 * configuration), so the chrome is resolved per path rather than per folder.
 */
export default function SettingsLayout() {
  return <Outlet />;
}
