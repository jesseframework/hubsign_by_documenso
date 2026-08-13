import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { trpc } from '@documenso/trpc/react';

import type { NavContext } from '~/components/general/nav-config';

/**
 * Everything the nav registries need in order to decide what a user can see.
 *
 * Shared by the sidebar, the mobile bar, the console shell and the topbar so
 * all four agree on visibility — they previously each built this inline, which
 * is exactly how a nav row and its breadcrumb end up disagreeing about whether
 * a section exists. Both queries are cached by key, so the extra callers do not
 * cost an extra request.
 */
export const useNavContext = (): NavContext => {
  const { quota } = useLimits();
  const { data: orgMembership } = trpc.org.getMyOrganization.useQuery();

  return {
    orgRole: orgMembership?.role,
    isDmsEnabled: quota.dmsEnabled,
  };
};
