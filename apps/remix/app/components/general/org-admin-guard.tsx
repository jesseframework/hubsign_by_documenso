import { Trans } from '@lingui/react/macro';
import type { OrganizationRole } from '@prisma/client';
import { BuildingIcon, ShieldAlertIcon } from 'lucide-react';
import { Link } from 'react-router';

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
  allowWithoutOrg = false,
  children,
}: {
  roles?: OrganizationRole[];
  /**
   * Render `children` for a user who belongs to no organization at all.
   *
   * Needed by the settings page, which is where an organization gets *created*.
   * Guarding it unconditionally locked people out of the one screen that would
   * have given them a role in the first place — you had to already be an admin
   * to reach the form that makes you one.
   */
  allowWithoutOrg?: boolean;
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

  if (!membership) {
    if (allowWithoutOrg) {
      return <>{children}</>;
    }

    // Distinct from the admin refusal below: "administrators only" would be
    // actively misleading here, since the problem is having no organization
    // rather than the wrong role in one.
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--r)] border border-border bg-card py-20 text-center">
        <BuildingIcon className="mb-3 h-9 w-9 text-muted-foreground opacity-50" />
        <p className="text-[14px] font-medium text-foreground">
          <Trans>You're not part of an organization</Trans>
        </p>
        <p className="mt-1 max-w-sm text-[12px] text-muted-foreground">
          <Trans>
            Create one to use organization features, or ask an admin to invite you to an existing
            organization.
          </Trans>
        </p>
        <Link
          to="/org/settings"
          className="mt-4 rounded-[var(--r-sm)] bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90"
        >
          <Trans>Create an organization</Trans>
        </Link>
      </div>
    );
  }

  if (!roles.includes(membership.role)) {
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
