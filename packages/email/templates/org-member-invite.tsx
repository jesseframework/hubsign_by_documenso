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

export type OrgMemberInviteEmailProps = {
  assetBaseUrl: string;
  baseUrl: string;
  inviterName: string;
  orgName: string;
  role: string;
};

export const OrgMemberInviteEmailTemplate = ({
  assetBaseUrl = 'http://localhost:3002',
  baseUrl = 'https://app.hubsign.io',
  inviterName = 'Jane Admin',
  orgName = 'Acme Corp',
  role = 'Member',
}: OrgMemberInviteEmailProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = msg`You've been added to ${orgName} on HubSign`;

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
                <Trans>You've been added to {orgName}</Trans>
              </Text>

              <Text className="my-1 text-center text-base">
                <Trans>
                  <span className="text-slate-900">{inviterName}</span> has added you to the
                  organization <span className="font-semibold text-slate-900">{orgName}</span> as a{' '}
                  <span className="font-semibold">{role}</span>.
                </Trans>
              </Text>

              <Text className="my-1 text-center text-base">
                <Trans>
                  You can now access the organization's documents, templates, and resources.
                </Trans>
              </Text>

              <Section className="mb-6 mt-6 text-center">
                <Button
                  className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
                  href={`${baseUrl}/documents`}
                >
                  <Trans>Go to HubSign</Trans>
                </Button>
              </Section>
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

export default OrgMemberInviteEmailTemplate;
