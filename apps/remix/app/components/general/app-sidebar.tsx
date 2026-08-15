import { version as APP_VERSION } from '../../../../../package.json';

import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, LogOutIcon, XIcon } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import { authClient } from '@documenso/auth/client';
import type { SessionUser } from '@documenso/auth/server/lib/session/session';
import type { TGetTeamsResponse } from '@documenso/lib/server-only/team/get-teams';
import { trpc } from '@documenso/trpc/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';

import { useInboxEvents } from '~/hooks/use-inbox-events';
import { useNavContext } from '~/hooks/use-nav-context';

import { BrandingLogo } from './branding-logo';
import type { NavIcon, NavItem } from './nav-config';
import {
  ACCOUNT_CONSOLE,
  ACCOUNT_ITEM,
  ADMIN_CONSOLE,
  ADMIN_ITEM,
  SETTINGS_CONSOLE,
  SETTINGS_ITEM,
  TOOLS_ITEM,
  TOOLS_NAV,
  filterGroups,
  filterItems,
  getPrimaryNav,
  isConsoleActive,
  isPathActive,
  isPrimaryItemActive,
  resolvePrimaryHref,
  resolveTeamHref,
} from './nav-config';
import { SidebarUsageIndicator } from './sidebar-usage-indicator';

export type AppSidebarProps = {
  user: SessionUser;
  teams: TGetTeamsResponse;
  isOpen: boolean;
  onClose: () => void;
};

type NavStyle = (active: boolean) => React.CSSProperties | undefined;

type TopAccordionId = 'tools' | 'account' | 'settings';

type CollapsibleRowProps = {
  rowKey: string;
  icon?: NavIcon;
  label: React.ReactNode;
  /** Omit for a group header that only toggles — it has no obvious first child to jump to. */
  to?: string;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  ariaLabel?: string;
  children: React.ReactNode;
};

/**
 * One open at a time among a set of named siblings, auto-following the active
 * route until the user makes an explicit choice — same `null`-means-auto idiom
 * the sidebar already used for its single Tools toggle, generalized so several
 * collapsibles (Tools/Account/Settings, and Settings' own groups) can share one
 * accordion instead of being able to sit open simultaneously.
 */
function useAccordion<T extends string>(autoId: T | null) {
  const [explicit, setExplicit] = useState<T | null | undefined>(undefined);
  const openId = explicit === undefined ? autoId : explicit;
  const toggle = (id: T) => setExplicit(openId === id ? null : id);
  return { openId, toggle };
}

/**
 * The daily-work navigation. Everything configuration-shaped lives behind the
 * pinned consoles at the bottom, and personal preferences behind the avatar, so
 * this list stays short enough to recognise rather than read — and short enough
 * never to scroll, which is the property that makes it memorable.
 *
 * The structure is identical for every user apart from the Document Manager
 * add-on gate: role differences change what is inside a page, not what is on
 * the nav, so nothing moves position when a colleague's permissions differ.
 */
export const AppSidebar = ({ user, teams, isOpen, onClose }: AppSidebarProps) => {
  const location = useLocation();
  const params = useParams();
  const pathname = location.pathname;

  const teamUrl = params?.teamUrl;
  const isAdmin = user.roles.includes('ADMIN' as never);

  const { data: orgMembership } = trpc.org.getMyOrganization.useQuery();

  // Unread Inbox count — visible from anywhere in the app. Now that Inbox is a
  // top-level row the badge is actually reachable by the eye; nested inside a
  // collapsed group it could only be seen by someone who already knew to look.
  const { data: unreadInboxCount } = trpc.inbox.unreadCount.useQuery(undefined, {
    enabled: Boolean(orgMembership?.organization),
  });

  useInboxEvents(undefined, { enabled: Boolean(orgMembership?.organization) });

  const ctx = useNavContext();

  const primaryNav = getPrimaryNav(ctx).map((item) =>
    resolveTeamHref({ ...item, to: resolvePrimaryHref(item, ctx) }, teamUrl),
  );
  const toolsNav = filterItems(TOOLS_NAV, ctx);
  const accountNav = filterItems(
    ACCOUNT_CONSOLE.groups.flatMap((group) => group.items),
    ctx,
  );
  const settingsGroups = filterGroups(SETTINGS_CONSOLE.groups, ctx);

  // Org branding colors
  const orgBrand = orgMembership?.organization;
  const sidebarTextColor = orgBrand?.brandingSidebarTextColor || undefined;
  const sidebarBg = orgBrand?.brandingSidebarBg || undefined;
  const primaryColor = orgBrand?.brandingPrimaryColor || undefined;
  const navActiveColor =
    ((orgBrand as Record<string, unknown> | undefined)?.brandingNavActiveColor as string) ||
    primaryColor ||
    undefined;

  const navStyle: NavStyle = (active) => {
    if (!sidebarTextColor) return undefined;
    return {
      color: active ? navActiveColor || sidebarTextColor : `${sidebarTextColor}90`,
      background: active ? `${navActiveColor || sidebarTextColor}18` : 'transparent',
    };
  };

  const borderColor = sidebarTextColor ? `${sidebarTextColor}20` : 'hsl(var(--sidebar-border))';
  const mutedColor = sidebarTextColor ? `${sidebarTextColor}80` : 'hsl(var(--sidebar-text))';

  const renderNavRow = (item: NavItem, active: boolean, badge?: number) => (
    <Link
      key={item.to}
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`sidebar-nav-item ${!sidebarTextColor && active ? 'active' : ''}`}
      style={navStyle(active)}
      onClick={onClose}
    >
      <item.icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{item.label}</span>
      {Boolean(badge) && (
        <span className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {badge}
        </span>
      )}
    </Link>
  );

  const renderLeafLink = (item: NavItem, active: boolean) => (
    <Link
      key={item.to}
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
        !sidebarTextColor
          ? active
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-[hsl(var(--sidebar-text))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-[hsl(var(--sidebar-text-active))]'
          : ''
      }`}
      style={navStyle(active)}
      onClick={onClose}
    >
      <item.icon className="h-3.5 w-3.5 flex-shrink-0 opacity-80" />
      {item.label}
    </Link>
  );

  /**
   * A collapsible parent row: Tools/Account/Settings (which navigate on the
   * label and toggle via a separate chevron button, `to` given) and Settings'
   * own group headers (Organization/Documents/Automation/Developer, which only
   * toggle — a group has no obvious first child to jump to, `to` omitted).
   */
  const renderCollapsibleRow = ({
    rowKey,
    icon: Icon,
    label,
    to,
    active,
    expanded,
    onToggle,
    ariaLabel,
    children,
  }: CollapsibleRowProps) => (
    <div key={rowKey}>
      <div className="flex items-center">
        {to ? (
          <>
            <Link
              to={to}
              className={`sidebar-nav-item flex-1 ${!sidebarTextColor && active ? 'active' : ''}`}
              style={navStyle(active)}
              onClick={onClose}
            >
              {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
              {label}
            </Link>
            <button
              type="button"
              className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
              style={{ color: mutedColor }}
              onClick={onToggle}
              aria-label={ariaLabel}
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`sidebar-nav-item w-full flex-1 border-0 bg-transparent ${!sidebarTextColor && active ? 'active' : ''}`}
            style={navStyle(active)}
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
            <span className="flex-1 text-left">{label}</span>
            {expanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div
          className="mb-1 ml-[18px] mt-0.5 space-y-px border-l pl-2.5"
          style={{
            borderColor: sidebarTextColor ? `${sidebarTextColor}25` : 'hsl(var(--sidebar-border))',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );

  const billingUrl = orgMembership?.organization ? '/org/billing' : '/settings/billing';

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

  const toolsActive = toolsNav.some((item) => isPathActive(item, pathname));
  const accountActive = isConsoleActive(ACCOUNT_CONSOLE, pathname);
  const settingsActive = isConsoleActive(SETTINGS_CONSOLE, pathname);

  const autoTopId: TopAccordionId | null = toolsActive
    ? 'tools'
    : accountActive
      ? 'account'
      : settingsActive
        ? 'settings'
        : null;
  const topAccordion = useAccordion<TopAccordionId>(autoTopId);

  const autoGroupId =
    settingsGroups.find((group) => group.items.some((item) => isPathActive(item, pathname)))
      ?.id ?? null;
  const groupAccordion = useAccordion<string>(autoGroupId);

  const homeHref = primaryNav[0]?.to ?? '/documents';

  return (
    <>
      {/* Overlay (mobile) */}
      {isOpen && <div className="sidebar-overlay open" onClick={onClose} />}

      <aside
        className={`sidebar-nav ${isOpen ? 'open' : ''}`}
        style={{
          ...(sidebarBg ? { background: sidebarBg } : {}),
          ...(sidebarTextColor ? { color: sidebarTextColor } : {}),
          ...(sidebarBg ? { borderColor: `${sidebarTextColor || '#fff'}20` } : {}),
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 border-b px-5 py-4" style={{ borderColor }}>
          {/* The first row the user can actually see. A personal account has no
              org dashboard, so a fixed `/org` here sent them to a page that can
              only render its "you're not part of an organization" state. */}
          <Link to={homeHref} className="flex items-center gap-2.5" onClick={onClose}>
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
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-[5px] border border-[hsl(var(--sidebar-border))] text-[hsl(var(--sidebar-text))] lg:hidden"
            onClick={onClose}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace switcher */}
        <div
          className="mx-3 mb-2 mt-3 flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2"
          style={{
            borderColor,
            background: sidebarTextColor ? `${sidebarTextColor}08` : 'hsl(var(--sidebar-hover))',
          }}
        >
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white"
            style={{ background: primaryColor || 'hsl(var(--primary))' }}
          >
            {orgBrand?.name?.[0]?.toUpperCase() || initials}
          </div>
          <span
            className="flex-1 truncate text-xs font-medium"
            style={{ color: sidebarTextColor || 'hsl(var(--sidebar-text-active))' }}
          >
            {displayName}
          </span>
          <ChevronsUpDownIcon className="h-3 w-3 flex-shrink-0" style={{ color: mutedColor }} />
        </div>

        {/* Daily work. Sized to fit without scrolling — if this ever needs a
            scrollbar, something belongs in a console instead of here. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1">
          {primaryNav.map((item) =>
            renderNavRow(
              item,
              isPrimaryItemActive(item, pathname),
              item.surface === 'inbox' ? unreadInboxCount : undefined,
            ),
          )}

          {/* A submenu of one is just a row with an extra click in front of it.
              A personal account only has Merge, so show Merge. */}
          {toolsNav.length === 1 &&
            renderNavRow(toolsNav[0], isPathActive(toolsNav[0], pathname))}

          {toolsNav.length > 1 &&
            renderCollapsibleRow({
              rowKey: 'tools',
              icon: TOOLS_ITEM.icon,
              label: TOOLS_ITEM.label,
              to: toolsNav[0].to,
              active: toolsActive,
              expanded: topAccordion.openId === 'tools',
              onToggle: () => topAccordion.toggle('tools'),
              ariaLabel: 'Toggle tools',
              children: toolsNav.map((item) => renderLeafLink(item, isPathActive(item, pathname))),
            })}

          {/* Consoles. Below the divider because they are doors you open
              deliberately, not places you pass through during the day. Folded
              into the sidebar itself, in the same idiom as Tools above, rather
              than opening a second rail beside the page content: one accordion
              (Tools/Account/Settings, and Settings' own groups nested one level
              further) keeps the tree reachable without letting it grow tall. */}
          <div
            className="my-2 h-px"
            style={{ background: sidebarTextColor ? `${sidebarTextColor}15` : 'hsl(var(--sidebar-border))' }}
          />

          {accountNav.length === 0 && renderNavRow(ACCOUNT_ITEM, accountActive)}
          {accountNav.length === 1 &&
            renderNavRow(accountNav[0], isPathActive(accountNav[0], pathname))}
          {accountNav.length > 1 &&
            renderCollapsibleRow({
              rowKey: 'account',
              icon: ACCOUNT_ITEM.icon,
              label: ACCOUNT_ITEM.label,
              to: ACCOUNT_ITEM.to,
              active: accountActive,
              expanded: topAccordion.openId === 'account',
              onToggle: () => topAccordion.toggle('account'),
              ariaLabel: 'Toggle account',
              children: accountNav.map((item) => renderLeafLink(item, isPathActive(item, pathname))),
            })}

          {settingsGroups.length === 0 && renderNavRow(SETTINGS_ITEM, settingsActive)}
          {settingsGroups.length > 0 &&
            renderCollapsibleRow({
              rowKey: 'settings',
              icon: SETTINGS_ITEM.icon,
              label: SETTINGS_ITEM.label,
              to: SETTINGS_ITEM.to,
              active: settingsActive,
              expanded: topAccordion.openId === 'settings',
              onToggle: () => topAccordion.toggle('settings'),
              ariaLabel: 'Toggle settings',
              children:
                settingsGroups.length === 1
                  ? settingsGroups[0].items.map((item) =>
                      renderLeafLink(item, isPathActive(item, pathname)),
                    )
                  : settingsGroups.map((group) => {
                      const groupActive = group.items.some((item) =>
                        isPathActive(item, pathname),
                      );

                      return renderCollapsibleRow({
                        rowKey: group.id,
                        icon: group.icon,
                        label: group.label,
                        active: groupActive,
                        expanded: groupAccordion.openId === group.id,
                        onToggle: () => groupAccordion.toggle(group.id),
                        children: group.items.map((item) =>
                          renderLeafLink(item, isPathActive(item, pathname)),
                        ),
                      });
                    }),
            })}

          {isAdmin && renderNavRow(ADMIN_ITEM, isConsoleActive(ADMIN_CONSOLE, pathname))}
        </div>

        <div className="flex-shrink-0">
          <SidebarUsageIndicator billingUrl={billingUrl} sidebarTextColor={sidebarTextColor} />
        </div>

        {/* Personal account. Deliberately not a nav row: "my settings" and "our
            settings" sharing a menu was the previous nav's worst adjacency. */}
        <div className="border-t p-3" style={{ borderColor }}>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                    accountActive && !sidebarTextColor ? 'bg-[hsl(var(--sidebar-hover))]' : ''
                  }`}
                >
                  <div
                    className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{
                      background:
                        primaryColor || 'linear-gradient(135deg, hsl(var(--primary)), #4e8bef)',
                    }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-xs font-medium"
                      style={{ color: sidebarTextColor || 'hsl(var(--sidebar-text-active))' }}
                    >
                      {user.name || 'User'}
                    </div>
                    <div className="truncate text-[10px]" style={{ color: mutedColor }}>
                      {user.email}
                    </div>
                  </div>

                  {/* Without this the trigger is just a name and an email, which
                      reads as a label rather than a control. */}
                  <ChevronsUpDownIcon
                    className="h-3 w-3 flex-shrink-0"
                    style={{ color: mutedColor }}
                  />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel>
                  <Trans>Account</Trans>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {accountNav.map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <Link to={item.to} onClick={onClose}>
                      <item.icon className="mr-2 h-4 w-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void authClient.signOut()}>
                  <LogOutIcon className="mr-2 h-4 w-4" />
                  <Trans>Sign out</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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
            <span
              className="text-[9px]"
              style={{ color: sidebarTextColor ? `${sidebarTextColor}40` : 'hsl(var(--sidebar-text))' }}
            >
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
