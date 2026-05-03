import { isCommunityPlan } from '@documenso/ee/server-only/util/is-community-plan';

import { IS_BILLING_ENABLED } from '../../constants/app';
import { getActiveSubscriptionsByUserId } from '../subscription/get-active-subscriptions-by-user-id';

export type HasPremiumStampsOptions = {
  userId: number;
  teamId?: number | null;
};

/**
 * Whether the given user (or team) is allowed to create / use custom stamps.
 *
 * Stamps are a paid feature — gated to anything above the community plan.
 * If billing is disabled for the deployment we treat the feature as free
 * for everyone (matches how other paid features behave in self-hosted setups).
 */
export const hasPremiumStamps = async ({
  userId,
  teamId,
}: HasPremiumStampsOptions): Promise<boolean> => {
  if (!IS_BILLING_ENABLED()) return true;

  // The community plan check already accounts for team subs (it walks to the
  // team owner's subscriptions when teamId is set).
  if (await isCommunityPlan({ userId, teamId: teamId ?? undefined })) return false;

  const subscriptions = await getActiveSubscriptionsByUserId({ userId });
  return subscriptions.length > 0;
};
