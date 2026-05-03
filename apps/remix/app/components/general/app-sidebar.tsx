import { version as APP_VERSION } from '../../../../../package.json';

import { Trans } from '@lingui/react/macro';
import {
  BuildingIcon,
  CombineIcon,
  FileTextIcon,
  FolderArchiveIcon,
  LogOutIcon,
  PenLineIcon,
  SettingsIcon,
  UsersIcon,
  XIcon,
  ShieldIcon,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import { authClient } from '@documenso/auth/client';
import type { SessionUser } from '@documenso/auth/server/lib/session/session';
import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import type { TGetTeamsResponse } from '@documenso/lib/server-only/team/get-teams';
import { trpc } from '@documenso/trpc/react';

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
  const { quota } = useLimits();
  const isDmsEnabled = quota.dmsEnabled;

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

  const { data: orgMembership } = trpc.org.getMyOrganization.useQuery();

  // Org branding colors
  const orgBrand = orgMembership?.organization;
  const sidebarTextColor = orgBrand?.brandingSidebarTextColor || undefined;
  const sidebarBg = orgBrand?.brandingSidebarBg || undefined;
  const primaryColor = orgBrand?.brandingPrimaryColor || undefined;
  const navActiveColor = (orgBrand as Record<string, unknown> | undefined)?.brandingNavActiveColor as string || primaryColor || undefined;

  // Nav item style helper for org branding
  const navStyle = (active: boolean): React.CSSProperties | undefined => {
    if (!sidebarTextColor) return undefined;
    return {
      color: active ? navActiveColor || sidebarTextColor : `${sidebarTextColor}90`,
      background: active ? `${navActiveColor || sidebarTextColor}18` : 'transparent',
    };
  };

  const sectionLabelStyle: React.CSSProperties | undefined = sidebarTextColor
    ? { color: `${sidebarTextColor}60` }
    : undefined;

  const dividerStyle: React.CSSProperties | undefined = sidebarTextColor
    ? { background: `${sidebarTextColor}15` }
    : undefined;

  const currentTeam = teams.find((t) => t.url === teamUrl);
  const displayName = orgMembership?.organization?.name
    ? orgMembership.organization.name
    : currentTeam
      ? currentTeam.name
      : 'Personal Account';
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

      <aside
        className={`sidebar-nav ${isOpen ? 'open' : ''}`}
        style={{
          ...(sidebarBg ? { background: sidebarBg } : {}),
          ...(sidebarTextColor ? { color: sidebarTextColor } : {}),
          ...(sidebarBg ? { borderColor: `${sidebarTextColor || '#fff'}20` } : {}),
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 border-b px-5 py-4" style={{ borderColor: sidebarTextColor ? `${sidebarTextColor}20` : 'hsl(var(--sidebar-border))' }}>
          <Link to="/documents" className="flex items-center gap-2.5" onClick={onClose}>
            {orgMembership?.organization?.brandingLogo ? (
              <img
                src={orgMembership.organization.brandingLogo}
                alt={orgMembership.organization.name}
                className="h-8 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <BrandingLogo className="h-8 w-auto brightness-0 invert" />
            )}
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
        <div
          className="mx-3 mt-3 mb-2 flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2"
          style={{
            borderColor: sidebarTextColor ? `${sidebarTextColor}20` : 'hsl(var(--sidebar-border))',
            background: sidebarTextColor ? `${sidebarTextColor}08` : 'hsl(var(--sidebar-hover))',
          }}
        >
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white"
            style={{ background: primaryColor || 'hsl(var(--primary))' }}
          >
            {orgBrand?.name?.[0]?.toUpperCase() || initials}
          </div>
          <span className="flex-1 text-xs font-medium" style={{ color: sidebarTextColor || 'hsl(var(--sidebar-text-active))' }}>
            {displayName}
          </span>
          <span className="text-[10px]" style={{ color: sidebarTextColor ? `${sidebarTextColor}80` : 'hsl(var(--sidebar-text))' }}>&#9662;</span>
        </div>

        {/* Main nav */}
        <div className="px-3 pt-1">
          <div className="sidebar-section-label" style={sectionLabelStyle}>
            <Trans>Main</Trans>
          </div>

          <Link
            to={getRootHref('/documents')}
            className={`sidebar-nav-item ${!sidebarTextColor && isActive('/documents') ? 'active' : ''}`}
            style={navStyle(isActive('/documents'))}
            onClick={onClose}
          >
            <PenLineIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>E-Sign</Trans>
          </Link>

          <Link
            to={getRootHref('/templates')}
            className={`sidebar-nav-item ${!sidebarTextColor && isActive('/templates') ? 'active' : ''}`}
            style={navStyle(isActive('/templates'))}
            onClick={onClose}
          >
            <FileTextIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Sign Templates</Trans>
          </Link>

          <Link
            to="/doc-merge"
            className={`sidebar-nav-item ${!sidebarTextColor && location.pathname.startsWith('/doc-merge') ? 'active' : ''}`}
            style={navStyle(location.pathname.startsWith('/doc-merge'))}
            onClick={onClose}
          >
            <CombineIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Doc Merging</Trans>
          </Link>

          {isDmsEnabled && (
            <Link
              to="/dms"
              className={`sidebar-nav-item ${!sidebarTextColor && location.pathname.startsWith('/dms') ? 'active' : ''}`}
              style={navStyle(location.pathname.startsWith('/dms'))}
              onClick={onClose}
            >
              <FolderArchiveIcon className="h-4 w-4 flex-shrink-0" />
              <Trans>Doc Manager</Trans>
            </Link>
          )}
        </div>

        <div className="mx-3 my-2 h-px" style={dividerStyle || { background: 'hsl(var(--sidebar-border))' }} />

        {/* Workspace section */}
        <div className="px-3">
          <div className="sidebar-section-label" style={sectionLabelStyle}>
            <Trans>Workspace</Trans>
          </div>

          <Link
            to="/org/settings"
            className={`sidebar-nav-item ${!sidebarTextColor && location.pathname.startsWith('/org') ? 'active' : ''}`}
            style={navStyle(location.pathname.startsWith('/org'))}
            onClick={onClose}
          >
            <BuildingIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Organization</Trans>
          </Link>

          <Link
            to={getRootHref('/settings/teams')}
            className={`sidebar-nav-item ${!sidebarTextColor && isActive('/settings/teams') ? 'active' : ''}`}
            style={navStyle(isActive('/settings/teams'))}
            onClick={onClose}
          >
            <UsersIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Team</Trans>
          </Link>

          <Link
            to={getRootHref('/settings/profile')}
            className={`sidebar-nav-item ${!sidebarTextColor && isActive('/settings') && !isActive('/settings/teams') ? 'active' : ''}`}
            style={navStyle(isActive('/settings') && !isActive('/settings/teams'))}
            onClick={onClose}
          >
            <SettingsIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Settings</Trans>
          </Link>

          {isAdmin && (
            <Link
              to="/admin/stats"
              className={`sidebar-nav-item ${!sidebarTextColor && location.pathname.startsWith('/admin') ? 'active' : ''}`}
              style={navStyle(location.pathname.startsWith('/admin'))}
              onClick={onClose}
            >
              <ShieldIcon className="h-4 w-4 flex-shrink-0" />
              <Trans>Admin</Trans>
            </Link>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto border-t p-3" style={{ borderColor: sidebarTextColor ? `${sidebarTextColor}20` : 'hsl(var(--sidebar-border))' }}>
          <div className="flex items-center gap-2">
            <Link
              to={getRootHref('/settings/profile')}
              className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2"
              onClick={onClose}
            >
              <div
                className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: primaryColor || 'linear-gradient(135deg, hsl(var(--primary)), #4e8bef)' }}
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium" style={{ color: sidebarTextColor || 'hsl(var(--sidebar-text-active))' }}>
                  {user.name || 'User'}
                </div>
                <div className="truncate text-[10px]" style={{ color: sidebarTextColor ? `${sidebarTextColor}60` : 'hsl(var(--sidebar-text))' }}>
                  {user.email}
                </div>
              </div>
            </Link>

            <button
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors"
              style={{ color: sidebarTextColor ? `${sidebarTextColor}70` : 'hsl(var(--sidebar-text))' }}
              onClick={() => void authClient.signOut()}
              title="Sign out"
            >
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1 px-2.5 text-center">
            <span className="text-[9px]" style={{ color: sidebarTextColor ? `${sidebarTextColor}40` : 'hsl(var(--sidebar-text))' }}>
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
