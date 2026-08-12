import { Trans } from '@lingui/react/macro';

import { Button, Column, Row, Section, Text } from '../components';

/**
 * The body of every approval email: request, reminder, escalation, and outcome.
 *
 * One component rather than five, because the four that carry a decision differ
 * only in their opening line — and when they were separate blocks of hand-written
 * HTML the buttons drifted apart between them.
 */
export type ApprovalEmailVariant =
  | 'request'
  | 'reminder'
  | 'escalation'
  | 'approved'
  | 'rejected';

export type TemplateApprovalProps = {
  variant: ApprovalEmailVariant;
  entityTitle: string;
  stepName?: string | null;
  requesterName?: string | null;
  amount?: string | null;
  priority?: string | null;
  comments?: string | null;
  /**
   * The decision page, carrying which control should be open on arrival.
   *
   * Deliberately not a link that performs the decision. A mail client or security
   * scanner that prefetches links would otherwise approve payments on the
   * approver's behalf, so the page still requires a click to commit — the intent
   * only decides what is already selected when they get there.
   */
  approveLink?: string;
  rejectLink?: string;
  /** In-app view, for a signed-in approver who wants the full context first. */
  viewLink: string;
};

/** A label/value pair. Row/Column render as a table, which Outlook honours. */
const SummaryRow = ({ label, value }: { label: React.ReactNode; value: string }) => (
  <Row className="mb-1">
    <Column className="w-32 align-top text-sm text-slate-400">{label}</Column>
    <Column className="align-top text-sm font-semibold text-slate-900">{value}</Column>
  </Row>
);

export const TemplateApproval = ({
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
}: TemplateApprovalProps) => {
  const isDecision = variant === 'request' || variant === 'reminder' || variant === 'escalation';

  return (
    <Section className="p-2 text-slate-500">
      <Text className="text-center text-lg font-medium text-black">
        {variant === 'request' && <Trans>Approval requested</Trans>}
        {variant === 'reminder' && <Trans>Approval still pending</Trans>}
        {variant === 'escalation' && <Trans>Approval escalated</Trans>}
        {variant === 'approved' && <Trans>Approved</Trans>}
        {variant === 'rejected' && <Trans>Declined</Trans>}
      </Text>

      <Text className="my-1 text-center text-base">
        {variant === 'request' &&
          (stepName ? (
            <Trans>
              You have an approval request waiting for the{' '}
              <span className="font-semibold text-slate-900">{stepName}</span> step.
            </Trans>
          ) : (
            <Trans>You have an approval request waiting on you.</Trans>
          ))}
        {variant === 'reminder' && <Trans>This approval has not been decided yet.</Trans>}
        {variant === 'escalation' && (
          <Trans>This approval has passed its deadline and is still waiting on a decision.</Trans>
        )}
        {variant === 'approved' && (
          <Trans>
            Your request for{' '}
            <span className="font-semibold text-slate-900">{entityTitle}</span> was approved.
          </Trans>
        )}
        {variant === 'rejected' && (
          <Trans>
            Your request for{' '}
            <span className="font-semibold text-slate-900">{entityTitle}</span> was declined.
          </Trans>
        )}
      </Text>

      {/* The outcome mails name the document in the sentence above, so repeating
          it in a summary block would say it twice. */}
      {isDecision && (
        <Section className="mx-auto mt-6 max-w-sm rounded-lg bg-slate-50 p-4">
          <SummaryRow label={<Trans>Document</Trans>} value={entityTitle} />
          {stepName && <SummaryRow label={<Trans>Step</Trans>} value={stepName} />}
          {requesterName && (
            <SummaryRow label={<Trans>Requested by</Trans>} value={requesterName} />
          )}
          {amount && <SummaryRow label={<Trans>Amount</Trans>} value={amount} />}
          {priority && <SummaryRow label={<Trans>Priority</Trans>} value={priority} />}
        </Section>
      )}

      {comments && (
        <Text className="mx-auto mt-4 max-w-sm rounded-lg bg-slate-50 p-4 text-sm">
          <span className="text-slate-400">
            <Trans>Comments</Trans>
          </span>
          <br />
          {comments}
        </Text>
      )}

      {isDecision && approveLink && rejectLink ? (
        <>
          <Section className="mb-2 mt-8 text-center">
            <Button
              className="mr-4 inline-flex items-center justify-center rounded-lg bg-red-500 px-6 py-3 text-center text-sm font-medium text-black no-underline"
              href={rejectLink}
            >
              <Trans>Decline</Trans>
            </Button>

            <Button
              className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
              href={approveLink}
            >
              <Trans>Approve</Trans>
            </Button>
          </Section>

          <Text className="mb-6 mt-2 text-center text-xs text-slate-400">
            <Trans>
              Both buttons open the review page, where you confirm the decision. Nothing is recorded
              until you do.
            </Trans>
          </Text>
        </>
      ) : (
        <Section className="mb-6 mt-8 text-center">
          <Button
            className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
            href={viewLink}
          >
            <Trans>View details</Trans>
          </Button>
        </Section>
      )}
    </Section>
  );
};

export default TemplateApproval;
