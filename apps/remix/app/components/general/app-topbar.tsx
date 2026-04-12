import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { HomeIcon, ChevronRightIcon, MenuIcon, SearchIcon } from 'lucide-react';
import { useLocation } from 'react-router';

import { AppCommandMenu } from './app-command-menu';

export type AppTopbarProps = {
  onHamburgerClick: () => void;
  title?: string;
};

export const AppTopbar = ({ onHamburgerClick, title }: AppTopbarProps) => {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const location = useLocation();

  // Derive page name from path
  const pathParts = location.pathname.split('/').filter(Boolean);
  const pageName = title || pathParts[pathParts.length - 1] || 'Documents';
  const displayName = pageName.charAt(0).toUpperCase() + pageName.slice(1);

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
            <HomeIcon className="h-3.5 w-3.5" />
            <span>Home</span>
            <ChevronRightIcon className="h-3 w-3" />
            <span className="font-medium text-foreground">{displayName}</span>
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-shrink-0 items-center gap-2">
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
        </div>
      </div>

      <AppCommandMenu open={isCommandMenuOpen} onOpenChange={setIsCommandMenuOpen} />
    </>
  );
};
