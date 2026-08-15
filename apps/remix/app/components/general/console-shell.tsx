import { Trans } from '@lingui/react/macro';
import { Link, useLocation } from 'react-router';

import { useNavContext } from '~/hooks/use-nav-context';

import type { ConsoleDef, NavGroup, NavItem, SurfaceDef } from './nav-config';
import { filterGroups, filterItems, isPathActive, resolveConsole, resolveSurface } from './nav-config';

/**
 * Chrome for the two lower tiers of the navigation (see `nav-config.tsx`).
 *
 * Rendered once, around the authenticated `<Outlet />`, so a route earns its
 * tab strip or console rail purely by being listed in a registry — no route
 * file has to opt in, and none of them can drift out of sync with the sidebar.
 */

/**
 * Horizontal tabs over peer views of one object. Scrolls rather than wraps, so
 * the content below never shifts down by a row on a narrow window.
 */
const SurfaceTabs = ({ tabs, pathname }: { tabs: NavItem[]; pathname: string }) => (
  <div className="mb-4 border-b border-border">
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Views">
      {tabs.map((tab) => {
        const active = isPathActive(tab, pathname);

        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <tab.icon className="h-4 w-4 shrink-0" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  </div>
);

/** One console destination, as it appears in the rail. */
const RailLink = ({ item, pathname }: { item: NavItem; pathname: string }) => {
  const active = isPathActive(item, pathname);

  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <item.icon className="h-4 w-4 shrink-0 opacity-80" />
      {item.label}
    </Link>
  );
};

/**
 * Vertical rail, shown beside console content on wide viewports.
 *
 * Settings moved its grouped view into the sidebar itself (see `app-sidebar.tsx`),
 * so the only console still rendered here is Platform Admin, which has exactly
 * one group — hence a flat list rather than the collapsible-group rendering this
 * used to need.
 */
const ConsoleRail = ({ groups, pathname }: { groups: NavGroup[]; pathname: string }) => (
  <nav className="space-y-px" aria-label="Sections">
    {groups.flatMap((group) => group.items).map((item) => (
      <RailLink key={item.to} item={item} pathname={pathname} />
    ))}
  </nav>
);

/**
 * The same console items as a horizontal scroller, for viewports too narrow to
 * afford a rail. Group labels are dropped rather than repeated inline — at this
 * width the ordering already carries the grouping.
 */
const ConsoleStrip = ({ groups, pathname }: { groups: NavGroup[]; pathname: string }) => (
  <div className="mb-4 overflow-x-auto lg:hidden">
    <div className="flex gap-1.5">
      {groups.flatMap((group) =>
        group.items.map((item) => {
          const active = isPathActive(item, pathname);

          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                active
                  ? 'border-primary/30 bg-primary/10 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </Link>
          );
        }),
      )}
    </div>
  </div>
);

const ConsoleHeader = ({ console: def }: { console: ConsoleDef }) => (
  <div className="mb-4">
    <h1 className="text-lg font-semibold tracking-tight">{def.title}</h1>

    {def.id === 'admin' && (
      // Platform admin is a different context, not another product section.
      // Say so plainly — the previous nav gave it the same shield icon as the
      // organization's access-control page and no other signal.
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        <Trans>You are administering the whole platform, not your organization.</Trans>
      </p>
    )}
  </div>
);

export const ConsoleShell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const ctx = useNavContext();

  const consoleDef = resolveConsole(pathname);
  const surface = resolveSurface(pathname);

  if (surface) {
    const tabs = filterItems(surface.tabs, ctx);

    // One visible tab is not a tab strip, it is a redundant row.
    return (
      <div className="w-full">
        {tabs.length > 1 && <SurfaceTabs tabs={tabs} pathname={pathname} />}
        {children}
      </div>
    );
  }

  if (!consoleDef) {
    return <div className="w-full">{children}</div>;
  }

  // Settings and Account no longer get a second rail beside the page content —
  // their navigation lives in the primary sidebar now (see `app-sidebar.tsx`).
  // Admin keeps its rail: it isn't part of that sidebar tree.
  if (consoleDef.id !== 'admin') {
    return (
      <div className="w-full">
        <ConsoleHeader console={consoleDef} />
        <div className="rounded-[var(--r)] border border-border bg-card p-4 sm:p-6">{children}</div>
      </div>
    );
  }

  const groups = filterGroups(consoleDef.groups, ctx);

  return (
    <div className="w-full">
      <div className="mb-4 h-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-500" />

      <div className="lg:flex lg:gap-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <ConsoleHeader console={consoleDef} />
          <ConsoleRail groups={groups} pathname={pathname} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="lg:hidden">
            <ConsoleHeader console={consoleDef} />
          </div>

          <ConsoleStrip groups={groups} pathname={pathname} />

          <div className="rounded-[var(--r)] border border-border bg-card p-4 sm:p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export type { ConsoleDef, SurfaceDef };
