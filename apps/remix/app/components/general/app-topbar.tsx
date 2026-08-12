import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { HomeIcon, ChevronRightIcon, LogOutIcon, MenuIcon, SearchIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { authClient } from '@documenso/auth/client';

import { useNavContext } from '~/hooks/use-nav-context';

import { AppCommandMenu } from './app-command-menu';
import { TopbarPreferences } from './app-topbar-preferences';
import { getPrimaryNav, resolveBreadcrumb, resolvePrimaryHref } from './nav-config';

export type AppTopbarProps = {
  onHamburgerClick: () => void;
  title?: string;
};

export const AppTopbar = ({ onHamburgerClick, title }: AppTopbarProps) => {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const location = useLocation();

  /**
   * Sign out is also in the sidebar footer, but that is off-screen on mobile and
   * scrolls out of reach on a long nav — so the one control that ends a session
   * was sometimes unreachable. This copy lives in the topbar, which is sticky on
   * every page and every breakpoint.
   */
  const onSignOutClick = () => {
    if (isSigningOut) {
      return;
    }

    // Latched rather than reset: signOut navigates away, so there is no state to
    // restore, and latching stops a second click firing during the redirect.
    setIsSigningOut(true);
    void authClient.signOut();
  };

  const ctx = useNavContext();

  // Where "Home" actually goes for this user. A personal account has no org
  // dashboard, so the first row they can see is the only honest target.
  const primaryNav = getPrimaryNav(ctx);
  const homeHref = primaryNav.length > 0 ? resolvePrimaryHref(primaryNav[0], ctx) : '/documents';

  /**
   * The trail comes from the nav registries, so a page is named in the
   * breadcrumb exactly as it is named in the sidebar. Only the leaf names that
   * no registry owns — a document editor, a detail view — are worked out here.
   */
  const trail = resolveBreadcrumb(location.pathname);

  const leafNames: Record<string, string> = {
    edit: 'Edit',
    logs: 'Logs',
    doc: 'Details',
    label: 'Print Label',
    folders: 'Folders',
  };

  const pathParts = location.pathname.split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1] ?? '';

  const crumbs: React.ReactNode[] = title
    ? [title]
    : trail.length > 0
      ? [...trail, ...(leafNames[lastPart] ? [leafNames[lastPart]] : [])]
      : [leafNames[lastPart] ?? 'Documents'];

  return (
    <>
      <div className="sticky top-0 z-20 flex h-[52px] items-center justify-between gap-2.5 border-b border-border bg-card px-3.5 sm:h-14 sm:px-5">
        {/* Left */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground lg:hidden"
            onClick={onHamburgerClick}
          >
            <MenuIcon className="h-[18px] w-[18px]" />
          </button>

          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link
              to={homeHref}
              className="flex flex-shrink-0 items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <HomeIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                <Trans>Home</Trans>
              </span>
            </Link>

            {crumbs.map((crumb, index) => (
              <span key={index} className="flex min-w-0 items-center gap-1.5">
                <ChevronRightIcon className="h-3 w-3 flex-shrink-0" />
                <span
                  className={
                    index === crumbs.length - 1
                      ? 'truncate font-medium text-foreground'
                      : 'hidden truncate sm:inline'
                  }
                >
                  {crumb}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* Language + theme quick-pickers (live next to search). */}
          <TopbarPreferences />

          {/* Search bar - hidden on mobile */}
          <button
            className="hidden items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/30 sm:flex"
            onClick={() => setIsCommandMenuOpen(true)}
            style={{ width: 200 }}
          >
            <SearchIcon className="h-[13px] w-[13px]" />
            <span className="flex-1 text-left">
              <Trans>Search...</Trans>
            </span>
            <kbd className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              &#8984;K
            </kbd>
          </button>

          {/* Mobile search icon */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground sm:hidden"
            onClick={() => setIsCommandMenuOpen(true)}
          >
            <SearchIcon className="h-4 w-4" />
          </button>

          {/* Sign out — labelled where there is room, icon-only on mobile. */}
          <button
            className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-60 sm:px-3"
            onClick={onSignOutClick}
            disabled={isSigningOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOutIcon className="h-4 w-4 flex-shrink-0" />
            <span className="hidden sm:inline">
              <Trans>Sign out</Trans>
            </span>
          </button>
        </div>
      </div>

      <AppCommandMenu open={isCommandMenuOpen} onOpenChange={setIsCommandMenuOpen} />
    </>
  );
};
