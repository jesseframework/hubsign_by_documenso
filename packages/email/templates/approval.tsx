import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';

import { Body, Container, Head, Hr, Html, Img, Link, Preview, Section, Text } from '../components';
import { useBranding } from '../providers/branding';
import type { TemplateApprovalProps } from '../template-components/template-approval';
import { TemplateApproval } from '../template-components/template-approval';
import { TemplateFooter } from '../template-components/template-footer';
import { TemplateImage } from '../template-components/template-image';

export type ApprovalEmailTemplateProps = TemplateApprovalProps & {
  assetBaseUrl?: string;
};

/**
 * Approval emails, on the same shell as every other HubSign email.
 *
 * These were hand-written HTML strings assembled in `approval-email.ts`: no logo,
 * no card, no footer, and no way for an organization's branding to reach them. An
 * approval request asks someone to authorise a payment, which is precisely the mail
 * that should look unmistakably like it came from the same place as the signing
 * request that preceded it.
 */
export const ApprovalEmailTemplate = ({
  variant,
  entityTitle,
  stepName,
  requesterName,
  amount,
  priority,
  comments,
  approveLink,
  rejectLink,
  viewLink,
  assetBaseUrl = 'http://localhost:3000',
}: ApprovalEmailTemplateProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = {
    request: msg`Approval requested: ${entityTitle}`,
    reminder: msg`Still waiting on your approval: ${entityTitle}`,
    escalation: msg`Escalated — approval overdue: ${entityTitle}`,
    approved: msg`Approved: ${entityTitle}`,
    rejected: msg`Declined: ${entityTitle}`,
  }[variant];

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

            {/*
              The icon above the heading, as every other notification in this
              family has one: clock for pending, completed for success, and the
              alert envelope for the two that need attention. Matched to the same
              assets the document emails already use for those meanings.
            */}
            <Section>
              <TemplateImage
                className="mx-auto"
                assetBaseUrl={assetBaseUrl}
                staticAsset={
                  {
                    request: 'review.png',
                    reminder: 'clock.png',
                    // Also a clock, not the alert envelope: an envelope with a red
                    // cross on it reads as "this was declined", which is the one
                    // thing an escalation has not happened yet.
                    escalation: 'clock.png',
                    approved: 'completed.png',
                    rejected: 'mail-open-alert.png',
                  }[variant]
                }
              />
            </Section>

            <TemplateApproval
              variant={variant}
              entityTitle={entityTitle}
              stepName={stepName}
              requesterName={requesterName}
              amount={amount}
              priority={priority}
              comments={comments}
              approveLink={approveLink}
              rejectLink={rejectLink}
              viewLink={viewLink}
            />
          </Container>

          <Container className="mx-auto max-w-xl">
            <Text className="text-center text-xs text-slate-400">
              <Trans>
                Prefer the full history?{' '}
                <Link className="text-slate-500 underline" href={viewLink}>
                  Open it in HubSign
                </Link>
                .
              </Trans>
            </Text>
          </Container>

          <Hr className="mx-auto mt-8 max-w-xl" />

          <Container className="mx-auto max-w-xl">
            {/* `isDocument={false}`: this is a workflow notification, not the
                delivery of a document, so the "sent using HubSign" line that
                belongs on a signing request would be wrong here. */}
            <TemplateFooter isDocument={false} />
          </Container>
        </Section>
      </Body>
    </Html>
  );
};

export default ApprovalEmailTemplate;
