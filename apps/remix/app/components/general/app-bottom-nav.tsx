import { Trans } from '@lingui/react/macro';
import { FileTextIcon, LayoutGridIcon, MailIcon, UserIcon } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

export const AppBottomNav = () => {
  const location = useLocation();
  const params = useParams();
  const teamUrl = params?.teamUrl;

  const getRootHref = (path: string) => {
    if (teamUrl) {
      return `/t/${teamUrl}${path}`;
    }
    return path;
  };

  const isActive = (path: string) => location.pathname.startsWith(getRootHref(path));

  const items = [
    {
      href: getRootHref('/documents'),
      icon: LayoutGridIcon,
      label: <Trans>Docs</Trans>,
      active: isActive('/documents'),
    },
    {
      href: getRootHref('/templates'),
      icon: FileTextIcon,
      label: <Trans>Templates</Trans>,
      active: isActive('/templates'),
    },
    {
      href: getRootHref('/documents?status=inbox'),
      icon: MailIcon,
      label: <Trans>Inbox</Trans>,
      active: false,
    },
    {
      href: getRootHref('/settings/profile'),
      icon: UserIcon,
      label: <Trans>Account</Trans>,
      active: isActive('/settings'),
    },
  ];

  return (
    <nav className="bottom-nav">
      <div className="flex items-stretch">
        {items.map((item, i) => (
          <Link
            key={i}
            to={item.href}
            className={`flex flex-1 flex-col items-center gap-[3px] border-none bg-transparent py-1 font-sans text-[10px] font-medium transition-colors ${
              item.active
                ? 'text-primary'
                : 'text-[hsl(var(--sidebar-text))]'
            }`}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
};
