import { Outlet } from 'react-router';

/**
 * Organization settings layout. The section nav now lives in the app sidebar
 * (expandable under "Organization"), so this just renders the page full-width.
 */
export default function OrgLayout() {
  return (
    <div className="w-full">
      <Outlet />
    </div>
  );
}
