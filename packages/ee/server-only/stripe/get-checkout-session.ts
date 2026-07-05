import type Stripe from 'stripe';

import { stripe } from '@documenso/lib/server-only/stripe';

export type GetCheckoutSessionOptions = {
  customerId: string;
  priceId: string;
  returnUrl: string;
  subscriptionMetadata?: Stripe.Metadata;
};

export const getCheckoutSession = async ({
  customerId,
  priceId,
  returnUrl,
  subscriptionMetadata,
}: GetCheckoutSessionOptions) => {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${returnUrl}?success=true`,
    cancel_url: `${returnUrl}?canceled=true`,
    subscription_data: {
      metadata: subscriptionMetadata,
    },
  });

  return session.url;
};

export type GetEmbeddedCheckoutSessionOptions = {
  customerId: string;
  priceId: string;
  returnUrl: string;
  subscriptionMetadata?: Stripe.Metadata;
};

/**
 * Creates a Stripe Checkout Session in embedded mode, returning a client
 * secret so the caller can render Stripe's embedded checkout form inline
 * instead of redirecting to a Stripe-hosted page.
 *
 * `ui_mode`/`return_url` (request) and `client_secret` (response) aren't
 * declared in the installed stripe SDK's types yet, though the account's
 * live API supports Embedded Checkout — hence the type assertions below.
 */
export const getEmbeddedCheckoutSession = async ({
  customerId,
  priceId,
  returnUrl,
  subscriptionMetadata,
}: GetEmbeddedCheckoutSessionOptions) => {
  const sessionParams = {
    customer: customerId,
    mode: 'subscription' as const,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: subscriptionMetadata,
    },
    ui_mode: 'embedded',
    return_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
  };

  const session = await stripe.checkout.sessions.create(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    sessionParams as unknown as Stripe.Checkout.SessionCreateParams,
  );

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const clientSecret = (session as unknown as { client_secret: string | null }).client_secret;

  if (!clientSecret) {
    throw new Error('Missing client secret from embedded checkout session');
  }

  return clientSecret;
};
