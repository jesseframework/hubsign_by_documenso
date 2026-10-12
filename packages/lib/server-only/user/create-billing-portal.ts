import type { User } from '@prisma/client';

import { getStripeCustomerByUser } from '@documenso/ee/server-only/stripe/get-customer';
import { getPortalSession } from '@documenso/ee/server-only/stripe/get-portal-session';
import { IS_BILLING_ENABLED, NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';

import { AppError, AppErrorCode } from '../../errors/app-error';

export type CreateBillingPortalOptions = {
  user: Pick<User, 'id' | 'customerId' | 'email' | 'name'>;
};

export const createBillingPortal = async ({ user }: CreateBillingPortalOptions) => {
  if (!IS_BILLING_ENABLED()) {
    // A plain `Error` surfaces to the client as an unhandled 500
    // INTERNAL_SERVER_ERROR — this is an expected, named state (billing
    // disabled for this deployment, see G7/F-19), not a server fault.
    // `org.setupBilling` already no-ops gracefully for the same condition;
    // this at least gives the client a clean 400 to handle instead of a
    // raw crash.
    throw new AppError(AppErrorCode.NOT_SETUP, { message: 'Billing is not enabled' });
  }

  const { stripeCustomer } = await getStripeCustomerByUser(user);

  return getPortalSession({
    customerId: stripeCustomer.id,
    returnUrl: `${NEXT_PUBLIC_WEBAPP_URL()}/settings/billing`,
  });
};
