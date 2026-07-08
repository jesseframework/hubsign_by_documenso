import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '../components';
import { useBranding } from '../providers/branding';
import { TemplateFooter } from '../template-components/template-footer';
import TemplateImage from '../template-components/template-image';

export type SubscriptionPurchaseConfirmationEmailProps = {
  assetBaseUrl: string;
  name: string;
  planName: string;
  priceFormatted: string;
  periodEndFormatted?: string | null;
  billingUrl: string;
};

export const SubscriptionPurchaseConfirmationEmailTemplate = ({
  assetBaseUrl = 'http://localhost:3002',
  name = 'there',
  planName = 'Pro',
  priceFormatted = '$45.00/month',
  periodEndFormatted = null,
  billingUrl = 'https://app.hubsign.io/settings/billing',
}: SubscriptionPurchaseConfirmationEmailProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = msg`Your ${planName} plan is active — thanks for subscribing to HubSign`;

  return (
    <Html>
      <Head />
      <Preview>{_(previewText)}</Preview>

      <Body className="mx-auto my-auto font-sans">
        <Section className="bg-white text-slate-500">
          <Container className="mx-auto mb-2 mt-8 max-w-xl rounded-lg border border-solid border-slate-200 p-2 backdrop-blur-sm">
            {branding.brandingEnabled && branding.brandingLogo ? (
              <Img src={branding.brandingLogo} alt="Branding Logo" className="mb-4 h-6 p-2" />
            ) : (
              <TemplateImage
                assetBaseUrl={assetBaseUrl}
                className="mb-4 h-6 p-2"
                staticAsset="logo.png"
              />
            )}

            <Section>
              <TemplateImage
                className="mx-auto"
                assetBaseUrl={assetBaseUrl}
                staticAsset="completed.png"
              />
            </Section>

            <Section className="p-2 text-slate-500">
              <Text className="text-center text-lg font-medium text-black">
                <Trans>Thanks for subscribing, {name}!</Trans>
              </Text>

              <Text className="my-1 text-center text-base">
                <Trans>
                  Your <span className="font-semibold text-slate-900">{planName}</span> plan is
                  now active at{' '}
                  <span className="font-semibold text-slate-900">{priceFormatted}</span>.
                </Trans>
              </Text>

              {periodEndFormatted && (
                <Text className="my-1 text-center text-base">
                  <Trans>Your plan will renew on {periodEndFormatted}.</Trans>
                </Text>
              )}

              <Section className="mb-6 mt-6 text-center">
                <Button
                  className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
                  href={billingUrl}
                >
                  <Trans>View Billing</Trans>
                </Button>
              </Section>

              <Text className="mt-4 text-center text-xs text-slate-400">
                <Trans>
                  Questions about your plan? Manage or cancel anytime from your{' '}
                  <a href={billingUrl} className="text-slate-600">
                    billing settings
                  </a>
                  .
                </Trans>
              </Text>
            </Section>
          </Container>

          <Hr className="mx-auto mt-12 max-w-xl" />

          <Container className="mx-auto max-w-xl">
            <TemplateFooter isDocument={false} />
          </Container>
        </Section>
      </Body>
    </Html>
  );
};

export default SubscriptionPurchaseConfirmationEmailTemplate;
