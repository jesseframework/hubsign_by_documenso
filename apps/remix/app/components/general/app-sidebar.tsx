import { Trans } from '@lingui/react/macro';
import {
  FileTextIcon,
  LayoutGridIcon,
  SettingsIcon,
  UsersIcon,
  XIcon,
  BarChart3Icon,
  ShieldIcon,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import type { SessionUser } from '@documenso/auth/server/lib/session/session';
import type { TGetTeamsResponse } from '@documenso/lib/server-only/team/get-teams';

import { BrandingLogo } from './branding-logo';

export type AppSidebarProps = {
  user: SessionUser;
  teams: TGetTeamsResponse;
  isOpen: boolean;
  onClose: () => void;
};

export const AppSidebar = ({ user, teams, isOpen, onClose }: AppSidebarProps) => {
  const location = useLocation();
  const params = useParams();

  const teamUrl = params?.teamUrl;
  const isAdmin = user.roles.includes('ADMIN' as never);

  const getRootHref = (path: string) => {
    if (teamUrl) {
      return `/t/${teamUrl}${path}`;
    }
    return path;
  };

  const isActive = (path: string) => {
    const href = getRootHref(path);
    return location.pathname.startsWith(href);
  };

  const currentTeam = teams.find((t) => t.url === teamUrl);
  const displayName = currentTeam ? currentTeam.name : 'Personal Account';
  const initials = user.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <>
      {/* Overlay (mobile) */}
      {isOpen && (
        <div
          className="sidebar-overlay open"
          onClick={onClose}
        />
      )}

      <aside className={`sidebar-nav ${isOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 border-b border-[hsl(var(--sidebar-border))] px-5 py-4">
          <Link to="/documents" className="flex items-center gap-2.5" onClick={onClose}>
            <BrandingLogo className="h-8 w-auto brightness-0 invert" />
          </Link>
          <span className="ml-0.5 rounded bg-[#1e1e2a] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
            Pro
          </span>
          <button
            className="ml-auto hidden h-7 w-7 items-center justify-center rounded-[5px] border border-[hsl(var(--sidebar-border))] text-[hsl(var(--sidebar-text))] flex lg:hidden"
            onClick={onClose}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace switcher */}
        <div className="mx-3 mt-3 mb-2 flex cursor-pointer items-center gap-2 rounded-md border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-hover))] px-2.5 py-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] bg-primary text-[10px] font-semibold text-white">
            {initials}
          </div>
          <span className="flex-1 text-xs font-medium text-[hsl(var(--sidebar-text-active))]">
            {displayName}
          </span>
          <span className="text-[10px] text-[hsl(var(--sidebar-text))]">&#9662;</span>
        </div>

        {/* Main nav */}
        <div className="px-3 pt-1">
          <div className="sidebar-section-label">
            <Trans>Main</Trans>
          </div>

          <Link
            to={getRootHref('/documents')}
            className={`sidebar-nav-item ${isActive('/documents') ? 'active' : ''}`}
            onClick={onClose}
          >
            <LayoutGridIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Documents</Trans>
          </Link>

          <Link
            to={getRootHref('/templates')}
            className={`sidebar-nav-item ${isActive('/templates') ? 'active' : ''}`}
            onClick={onClose}
          >
            <FileTextIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Templates</Trans>
          </Link>
        </div>

        <div className="mx-3 my-2 h-px bg-[hsl(var(--sidebar-border))]" />

        {/* Workspace section */}
        <div className="px-3">
          <div className="sidebar-section-label">
            <Trans>Workspace</Trans>
          </div>

          <Link
            to={getRootHref('/settings/teams')}
            className={`sidebar-nav-item ${isActive('/settings/teams') ? 'active' : ''}`}
            onClick={onClose}
          >
            <UsersIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Team</Trans>
          </Link>

          <Link
            to={getRootHref('/settings/profile')}
            className={`sidebar-nav-item ${isActive('/settings') && !isActive('/settings/teams') ? 'active' : ''}`}
            onClick={onClose}
          >
            <SettingsIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Settings</Trans>
          </Link>

          {isAdmin && (
            <Link
              to="/admin/stats"
              className={`sidebar-nav-item ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
              onClick={onClose}
            >
              <ShieldIcon className="h-4 w-4 flex-shrink-0" />
              <Trans>Admin</Trans>
            </Link>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto border-t border-[hsl(var(--sidebar-border))] p-3">
          <Link
            to={getRootHref('/settings/profile')}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-[hsl(var(--sidebar-hover))]"
            onClick={onClose}
          >
            <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-[11px] font-semibold text-white">
              {initials}
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium text-[hsl(var(--sidebar-text-active))]">
                {user.name || 'User'}
              </div>
              <div className="text-[10px] text-[hsl(var(--sidebar-text))]">{user.email}</div>
            </div>
          </Link>
        </div>
      </aside>
    </>
  );
};
