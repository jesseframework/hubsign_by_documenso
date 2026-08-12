import { useLocation, useParams, Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { useNavContext } from '~/hooks/use-nav-context';

import {
  getPrimaryNav,
  isPrimaryItemActive,
  resolvePrimaryHref,
  resolveTeamHref,
} from './nav-config';

/**
 * Mobile shortcut bar. Draws from the same primary nav registry as the sidebar
 * so the two can never disagree, and takes the first four rows that survive the
 * visibility filter — a shortcut bar, not a second navigation to memorise. The
 * full nav remains one hamburger away.
 */
export const AppBottomNav = () => {
  const location = useLocation();
  const params = useParams();
  const teamUrl = params?.teamUrl;

  const ctx = useNavContext();

  const { data: unreadInboxCount } = trpc.inbox.unreadCount.useQuery(undefined, {
    enabled: ctx.orgRole !== undefined,
  });

  const items = getPrimaryNav(ctx)
    .map((item) => resolveTeamHref({ ...item, to: resolvePrimaryHref(item, ctx) }, teamUrl))
    .slice(0, 4);

  return (
    <nav className="bottom-nav">
      <div className="flex items-stretch">
        {items.map((item) => {
          const active = isPrimaryItemActive(item, location.pathname);
          const badge = item.surface === 'inbox' ? unreadInboxCount : undefined;

          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-[3px] border-none bg-transparent py-1 font-sans text-[10px] font-medium transition-colors ${
                active ? 'text-primary' : 'text-[hsl(var(--sidebar-text))]'
              }`}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {Boolean(badge) && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                    {badge}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
