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

export type OrgMemberWelcomeEmailProps = {
  assetBaseUrl: string;
  baseUrl: string;
  inviterName: string;
  orgName: string;
  role: string;
  welcomeMessage: string;
  setPasswordLink: string;
};

export const OrgMemberWelcomeEmailTemplate = ({
  assetBaseUrl = 'http://localhost:3002',
  baseUrl = 'https://app.hubsign.io',
  inviterName = 'Jane Admin',
  orgName = 'Acme Corp',
  role = 'Member',
  welcomeMessage = '',
  setPasswordLink = '',
}: OrgMemberWelcomeEmailProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = msg`Welcome to ${orgName} on HubSign — set your password to get started`;

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
                staticAsset="add-user.png"
              />
            </Section>

            <Section className="p-2 text-slate-500">
              <Text className="text-center text-lg font-medium text-black">
                <Trans>Welcome to {orgName}</Trans>
              </Text>

              <Text className="my-1 text-center text-base">
                <Trans>
                  <span className="text-slate-900">{inviterName}</span> has created an account for
                  you in <span className="font-semibold text-slate-900">{orgName}</span> as a{' '}
                  <span className="font-semibold">{role}</span>.
                </Trans>
              </Text>

              {welcomeMessage && welcomeMessage.trim().length > 0 && (
                <Section className="my-4 rounded-lg bg-gray-50 p-4 text-left">
                  <Text className="my-0 whitespace-pre-wrap text-sm text-slate-700">
                    {welcomeMessage}
                  </Text>
                </Section>
              )}

              <Text className="my-1 text-center text-base">
                <Trans>
                  To get started, set your password using the secure link below. This link expires
                  in 24 hours.
                </Trans>
              </Text>

              <Section className="mb-6 mt-6 text-center">
                <Button
                  className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
                  href={setPasswordLink}
                >
                  <Trans>Set Password & Sign In</Trans>
                </Button>
              </Section>

              <Text className="mt-4 text-center text-xs text-slate-400">
                <Trans>
                  Already have a password? You can sign in at{' '}
                  <a href={`${baseUrl}/signin`} className="text-slate-600">
                    {baseUrl}/signin
                  </a>
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

export default OrgMemberWelcomeEmailTemplate;
