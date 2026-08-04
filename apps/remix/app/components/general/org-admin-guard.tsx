import { Trans } from '@lingui/react/macro';
import type { OrganizationRole } from '@prisma/client';
import { ShieldAlertIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';

const DEFAULT_ROLES: OrganizationRole[] = ['ORG_ADMIN'];

/**
 * Renders `children` only for the given organization roles.
 *
 * The sidebar already omits administrative links for ordinary members, but a
 * hidden link is not an access control — the URL is still typeable, and several
 * of these pages previously rendered the org's settings, member roster, billing
 * and permission matrix to anyone who navigated directly. This is the component
 * that actually withholds the data.
 *
 * It is still only a client-side guard. It stops a member from *reading* these
 * screens; it is the tRPC procedures that must refuse to *act*, and the
 * mutating org procedures do enforce ORG_ADMIN independently.
 */
export const OrgAdminGuard = ({
  roles = DEFAULT_ROLES,
  children,
}: {
  roles?: OrganizationRole[];
  children: React.ReactNode;
}) => {
  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-[13px] text-muted-foreground">
        <Trans>Loading...</Trans>
      </div>
    );
  }

  // No membership is treated the same as an insufficient one — never fall
  // through to the page while the role is unknown.
  if (!membership || !roles.includes(membership.role)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--r)] border border-border bg-card py-20 text-center">
        <ShieldAlertIcon className="mb-3 h-9 w-9 text-muted-foreground opacity-50" />
        <p className="text-[14px] font-medium text-foreground">
          <Trans>Administrators only</Trans>
        </p>
        <p className="mt-1 max-w-sm text-[12px] text-muted-foreground">
          <Trans>
            This section is restricted to organization administrators. Ask an admin if you need
            access.
          </Trans>
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
