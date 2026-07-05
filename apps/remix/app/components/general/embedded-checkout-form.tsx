import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

import { env } from '@documenso/lib/utils/env';

let stripePromise: ReturnType<typeof loadStripe> | null = null;

const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(env('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY') ?? '');
  }

  return stripePromise;
};

export type EmbeddedCheckoutFormProps = {
  clientSecret: string;
};

export const EmbeddedCheckoutForm = ({ clientSecret }: EmbeddedCheckoutFormProps) => {
  return (
    <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
};
