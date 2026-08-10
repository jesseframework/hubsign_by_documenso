import { version as APP_VERSION } from '../../../../../package.json';

import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import type { OrganizationRole } from '@prisma/client';
import {
  ActivityIcon,
  ArchiveIcon,
  BarChart3Icon,
  BellIcon,
  BotIcon,
  BracesIcon,
  BuildingIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  ClockIcon,
  CombineIcon,
  CpuIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileSearchIcon,
  FileStackIcon,
  FileTextIcon,
  FolderArchiveIcon,
  FolderTreeIcon,
  GaugeIcon,
  Globe2Icon,
  HeartIcon,
  InboxIcon,
  MailIcon,
  ScaleIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LockIcon,
  LogOutIcon,
  PenLineIcon,
  PlugIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  StampIcon,
  Trash2Icon,
  TrophyIcon,
  UploadCloudIcon,
  UserIcon,
  UsersIcon,
  WebhookIcon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import { authClient } from '@documenso/auth/client';
import type { SessionUser } from '@documenso/auth/server/lib/session/session';
import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import type { TGetTeamsResponse } from '@documenso/lib/server-only/team/get-teams';
import { trpc } from '@documenso/trpc/react';

import { useInboxEvents } from '~/hooks/use-inbox-events';

import { BrandingLogo } from './branding-logo';
import { SidebarUsageIndicator } from './sidebar-usage-indicator';

export type AppSidebarProps = {
  user: SessionUser;
  teams: TGetTeamsResponse;
  isOpen: boolean;
  onClose: () => void;
};

type SubNavItem = {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  /** Match the path exactly (for dashboard-style index routes). */
  exact?: boolean;
  /** Also treat this prefix as active (for aliased routes). */
  match?: string;
  /**
   * Org roles allowed to see this item. Omit for items every member may use.
   * This is presentation only — the page itself must still refuse the data,
   * since a hidden link is not an access control.
   */
  roles?: OrganizationRole[];
  /**
   * Also show to a user who belongs to NO organization. Only for the entry
   * point that lets them create one — hiding it made org creation unreachable,
   * since the role filter treats "no org" as "no permission".
   */
  alsoWithoutOrg?: boolean;
};

/**
 * A top-level sidebar item with an expandable, nested submenu (guide rail +
 * indented children). Auto-expands when its section is active; the chevron
 * toggles it manually.
 */
function SidebarNavGroup({
  to,
  icon: Icon,
  label,
  items,
  active,
  pathname,
  sidebarTextColor,
  navStyle,
  onClose,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  items: SubNavItem[];
  active: boolean;
  pathname: string;
  sidebarTextColor?: string;
  navStyle: (active: boolean) => React.CSSProperties | undefined;
  onClose: () => void;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const show = manual === null ? active : manual;

  return (
    <div>
      <div className="flex items-center">
        <Link
          to={to}
          className={`sidebar-nav-item flex-1 ${!sidebarTextColor && active ? 'active' : ''}`}
          style={navStyle(active)}
          onClick={onClose}
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          {label}
        </Link>
        <button
          type="button"
          className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
          style={{ color: sidebarTextColor ? `${sidebarTextColor}80` : 'hsl(var(--sidebar-text))' }}
          onClick={() => setManual(!show)}
          aria-label="Toggle menu"
          aria-expanded={show}
        >
          {show ? (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {show && (
        <div
          className="mb-1 ml-[18px] mt-0.5 space-y-px border-l pl-2.5"
          style={{ borderColor: sidebarTextColor ? `${sidebarTextColor}25` : 'hsl(var(--sidebar-border))' }}
        >
          {items.map((item) => {
            const itemActive = item.exact
              ? pathname === item.to
              : pathname.startsWith(item.to) || (item.match ? pathname.startsWith(item.match) : false);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                  !sidebarTextColor
                    ? itemActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-[hsl(var(--sidebar-text))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-[hsl(var(--sidebar-text-active))]'
                    : ''
                }`}
                style={navStyle(itemActive)}
                onClick={onClose}
              >
                <item.icon className="h-3.5 w-3.5 flex-shrink-0 opacity-80" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const myOrgRole = orgMembership?.role;

  // Unread Signature Inbox count — visible from anywhere in the app, not just
  // the inbox page itself. Kept fresh by the inbox event stream below rather
  // than a refetch interval, so the badge moves the moment mail lands.
  const { data: unreadInboxCount } = trpc.inbox.unreadCount.useQuery(undefined, {
    enabled: Boolean(orgMembership?.organization),
  });

  useInboxEvents(undefined, { enabled: Boolean(orgMembership?.organization) });

  // Expandable submenus (nested under their top-level item).
  // Administrative sections. Kept out of the nav for ordinary members so the
  // menu reflects what they can actually do. `DMS Permissions` additionally
  // admits DMS_ADMIN, matching the check the page itself already performs —
  // gating it to ORG_ADMIN alone would lock DMS admins out of their own screen.
  const ORG_ADMIN_ONLY: OrganizationRole[] = ['ORG_ADMIN'];
  const DMS_ADMIN_TOO: OrganizationRole[] = ['ORG_ADMIN', 'DMS_ADMIN'];

  const orgNav: SubNavItem[] = [
    { to: '/org', icon: LayoutDashboardIcon, label: <Trans>Dashboard</Trans>, exact: true },
    { to: '/org/sla', icon: GaugeIcon, label: <Trans>SLA</Trans> },
    // `alsoWithoutOrg`: this is the only route to the "Create Organization"
    // form, so it has to stay reachable for someone who isn't in an org yet.
    {
      to: '/org/settings',
      icon: SettingsIcon,
      label: <Trans>Settings</Trans>,
      roles: ORG_ADMIN_ONLY,
      alsoWithoutOrg: true,
    },
    { to: '/org/members', icon: UsersIcon, label: <Trans>Members</Trans>, roles: ORG_ADMIN_ONLY },
    {
      to: '/org/inbox',
      icon: InboxIcon,
      label: (
        <span className="flex w-full items-center justify-between gap-2">
          <Trans>Signature Inbox</Trans>
          {Boolean(unreadInboxCount) && (
            <span className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {unreadInboxCount}
            </span>
          )}
        </span>
      ),
    },
    { to: '/org/permissions', icon: ShieldIcon, label: <Trans>DMS Permissions</Trans>, roles: DMS_ADMIN_TOO },
    { to: '/org/workflows', icon: WorkflowIcon, label: <Trans>Workflows</Trans>, roles: ORG_ADMIN_ONLY },
    { to: '/org/email-templates', icon: MailIcon, label: <Trans>Email Templates</Trans>, roles: ORG_ADMIN_ONLY },
    { to: '/org/business-rules', icon: ScaleIcon, label: <Trans>Business Rules</Trans>, roles: ORG_ADMIN_ONLY },
    { to: '/org/metadata', icon: DatabaseIcon, label: <Trans>Metadata</Trans> },
    { to: '/org/integrations', icon: PlugIcon, label: <Trans>Integrations</Trans>, roles: ORG_ADMIN_ONLY },
    { to: '/org/approvals', icon: ClipboardCheckIcon, label: <Trans>Approvals</Trans> },
    { to: '/org/approval-templates', icon: ListChecksIcon, label: <Trans>Approval Setup</Trans> },
    { to: '/org/stamps', icon: StampIcon, label: <Trans>Stamps</Trans> },
    { to: '/org/billing', icon: CreditCardIcon, label: <Trans>Billing</Trans>, roles: ORG_ADMIN_ONLY },
    { to: '/org/recycle-bin', icon: Trash2Icon, label: <Trans>Recycle Bin</Trans> },
  ].filter((item) => {
    // Open to every member.
    if (!item.roles) return true;

    // Not in an org: only the item that leads to creating one. Everything else
    // would 'Administrators only' at them, which is not the real problem.
    if (myOrgRole === undefined) return item.alsoWithoutOrg === true;

    return item.roles.includes(myOrgRole);
  });
  const dmsNav: SubNavItem[] = [
    { to: '/dms', icon: LayoutDashboardIcon, label: <Trans>Dashboard</Trans>, exact: true },
    { to: '/dms/documents', icon: ArchiveIcon, label: <Trans>Documents</Trans> },
    { to: '/dms/bulk-upload', icon: UploadCloudIcon, label: <Trans>Bulk Upload</Trans> },
    { to: '/dms/ocr-queue', icon: CpuIcon, label: <Trans>OCR Queue</Trans> },
    { to: '/dms/search', icon: FileSearchIcon, label: <Trans>Search</Trans> },
    { to: '/dms/filing', icon: FolderTreeIcon, label: <Trans>Filing Structure</Trans> },
    { to: '/dms/favorites', icon: HeartIcon, label: <Trans>Favorites</Trans> },
    { to: '/dms/approvals', icon: CheckSquareIcon, label: <Trans>Approvals</Trans> },
    { to: '/dms/retrievals', icon: ClipboardListIcon, label: <Trans>Retrievals</Trans> },
    { to: '/dms/retention', icon: ClockIcon, label: <Trans>Retention</Trans> },
    { to: '/dms/activity', icon: ActivityIcon, label: <Trans>Activity</Trans> },
    { to: '/dms/compliance', icon: ShieldCheckIcon, label: <Trans>Compliance</Trans> },
    { to: '/dms/ai', icon: BotIcon, label: <Trans>AI Agent</Trans> },
    { to: '/dms/settings', icon: SettingsIcon, label: <Trans>Settings</Trans> },
  ];
  const settingsNav: SubNavItem[] = [
    { to: '/settings/profile', icon: UserIcon, label: <Trans>Profile</Trans> },
    { to: '/settings/public-profile', icon: Globe2Icon, label: <Trans>Public Profile</Trans> },
    { to: '/settings/security', icon: LockIcon, label: <Trans>Security</Trans> },
    { to: '/settings/notifications', icon: BellIcon, label: <Trans>Notifications</Trans> },
    // Org seat limits supersede personal billing entirely (see
    // `getServerLimits`), so org members manage billing under Organization
    // instead — this link only makes sense for accounts not in an org.
    ...(!orgMembership?.organization
      ? [{ to: '/settings/billing', icon: CreditCardIcon, label: <Trans>Billing</Trans> }]
      : []),
    { to: '/settings/tokens', icon: BracesIcon, label: <Trans>API Tokens</Trans> },
    { to: '/settings/webhooks', icon: WebhookIcon, label: <Trans>Webhooks</Trans> },
  ];
  const adminNav: SubNavItem[] = [
    { to: '/admin/stats', icon: BarChart3Icon, label: <Trans>Stats</Trans> },
    { to: '/admin/users', icon: UsersIcon, label: <Trans>Users</Trans> },
    { to: '/admin/documents', icon: FileStackIcon, label: <Trans>Documents</Trans> },
    { to: '/admin/leaderboard', icon: TrophyIcon, label: <Trans>Leaderboard</Trans> },
    { to: '/admin/site-settings', icon: SettingsIcon, label: <Trans>Site Settings</Trans>, match: '/admin/banner' },
  ];
  const onSettingsRoute = isActive('/settings') && !isActive('/settings/teams');

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

  // Org seat limits (when present) always supersede personal/team limits — see
  // `getServerLimits`'s precedence — so the usage widget's upgrade link should
  // point at org billing whenever the user belongs to an org, regardless of
  // which route (personal or team) they're currently viewing.
  const billingUrl = orgMembership?.organization
    ? '/org/billing'
    : teamUrl
      ? `/t/${teamUrl}/settings/billing`
      : '/settings/billing';

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

        {/* Scrollable middle: workspace switcher + nav groups. `min-h-0` lets a
            flex child actually shrink and scroll instead of growing to fit
            all content (a classic flexbox gotcha) — otherwise expanding every
            nav group pushes content off-screen with no way to reach it. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
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
            <SidebarNavGroup
              to="/dms"
              icon={FolderArchiveIcon}
              label={<Trans>Doc Manager</Trans>}
              items={dmsNav}
              active={location.pathname.startsWith('/dms')}
              pathname={location.pathname}
              sidebarTextColor={sidebarTextColor}
              navStyle={navStyle}
              onClose={onClose}
            />
          )}
        </div>

        <div className="mx-3 my-2 h-px" style={dividerStyle || { background: 'hsl(var(--sidebar-border))' }} />

        {/* Workspace section */}
        <div className="px-3">
          <div className="sidebar-section-label" style={sectionLabelStyle}>
            <Trans>Workspace</Trans>
          </div>

          <SidebarNavGroup
            to="/org/settings"
            icon={BuildingIcon}
            label={<Trans>Organization</Trans>}
            items={orgNav}
            active={location.pathname.startsWith('/org')}
            pathname={location.pathname}
            sidebarTextColor={sidebarTextColor}
            navStyle={navStyle}
            onClose={onClose}
          />

          <Link
            to={getRootHref('/settings/teams')}
            className={`sidebar-nav-item ${!sidebarTextColor && isActive('/settings/teams') ? 'active' : ''}`}
            style={navStyle(isActive('/settings/teams'))}
            onClick={onClose}
          >
            <UsersIcon className="h-4 w-4 flex-shrink-0" />
            <Trans>Team</Trans>
          </Link>

          <SidebarNavGroup
            to="/settings/profile"
            icon={SettingsIcon}
            label={<Trans>Settings</Trans>}
            items={settingsNav}
            active={onSettingsRoute}
            pathname={location.pathname}
            sidebarTextColor={sidebarTextColor}
            navStyle={navStyle}
            onClose={onClose}
          />

          {isAdmin && (
            <SidebarNavGroup
              to="/admin/stats"
              icon={ShieldIcon}
              label={<Trans>Admin</Trans>}
              items={adminNav}
              active={location.pathname.startsWith('/admin')}
              pathname={location.pathname}
              sidebarTextColor={sidebarTextColor}
              navStyle={navStyle}
              onClose={onClose}
            />
          )}
        </div>
        </div>

        <div className="mt-auto flex-shrink-0">
          <SidebarUsageIndicator billingUrl={billingUrl} sidebarTextColor={sidebarTextColor} />
        </div>

        {/* Footer */}
        <div className="border-t p-3" style={{ borderColor: sidebarTextColor ? `${sidebarTextColor}20` : 'hsl(var(--sidebar-border))' }}>
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
