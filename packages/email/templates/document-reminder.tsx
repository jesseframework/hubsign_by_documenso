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

export type DocumentReminderEmailProps = {
  assetBaseUrl: string;
  baseUrl: string;
  recipientName: string;
  documentName: string;
  inviterName: string;
  signingLink: string;
  daysWaiting: number;
};

export const DocumentReminderEmailTemplate = ({
  assetBaseUrl = 'http://localhost:3002',
  baseUrl = 'https://app.hubsign.io',
  recipientName = 'John Doe',
  documentName = 'Contract.pdf',
  inviterName = 'Jane',
  signingLink = '',
  daysWaiting = 3,
}: DocumentReminderEmailProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = msg`Reminder: please sign "${documentName}"`;

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
                <Trans>Reminder: please sign "{documentName}"</Trans>
              </Text>

              <Text className="my-1 text-center text-base">
                <Trans>
                  Hi {recipientName || 'there'}, this is a friendly reminder that{' '}
                  <span className="text-slate-900">{inviterName}</span> is still waiting for your
                  signature on this document. It's been waiting <strong>{daysWaiting} days</strong>.
                </Trans>
              </Text>

              <Section className="mb-6 mt-6 text-center">
                <Button
                  className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
                  href={signingLink}
                >
                  <Trans>Sign the document</Trans>
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

export default DocumentReminderEmailTemplate;
