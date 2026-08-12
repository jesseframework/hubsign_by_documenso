/**
 * Approval emails — request, reminder/escalation, and outcome notifications.
 *
 * Rendered through the same pipeline as every other HubSign email: a React Email
 * template in `@documenso/email/templates`, rendered by `renderEmailWithI18N` so it
 * is translated and can carry an organization's branding. They used to be HTML
 * strings assembled here, which is why they arrived with no logo, no card and no
 * footer while the signing request that preceded them had all three.
 *
 * Approve/reject happens on an anonymous page at `/approve/<token>` (explicit
 * buttons, not a one-click GET, to avoid accidental approval by link prefetch).
 * A "view in app" deep link is included for signed-in users.
 */

import { createElement } from 'react';

import { mailer } from '@documenso/email/mailer';
import type { ApprovalEmailVariant } from '@documenso/email/template-components/template-approval';
import { ApprovalEmailTemplate } from '@documenso/email/templates/approval';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { FROM_ADDRESS, FROM_NAME } from '../../constants/email';
import { renderEmailWithI18N } from '../../utils/render-email-with-i18n';

const baseUrl = () => NEXT_PUBLIC_WEBAPP_URL();

type ApprovalEmailContent = {
  variant: ApprovalEmailVariant;
  entityTitle: string;
  requestId: string;
  /** Absent on outcome mails, which carry no decision. */
  token?: string;
  stepName?: string | null;
  requesterName?: string | null;
  amount?: number | null;
  priority?: string | null;
  comments?: string | null;
};

const SUBJECTS: Record<ApprovalEmailVariant, (title: string) => string> = {
  request: (title) => `Approval requested: ${title}`,
  reminder: (title) => `Reminder: approval pending: ${title}`,
  escalation: (title) => `[Escalation] Approval overdue: ${title}`,
  approved: (title) => `Approval approved: ${title}`,
  rejected: (title) => `Approval rejected: ${title}`,
};

/**
 * Builds an approval email without sending it.
 *
 * Exported so the markup can be rendered and looked at — an email whose only route
 * to a human eye is a live SMTP server is an email nobody checks before shipping.
 */
export const renderApprovalEmail = async (content: ApprovalEmailContent) => {
  const viewLink = `${baseUrl()}/org/approvals/${content.requestId}`;
  const decisionLink = content.token ? `${baseUrl()}/approve/${content.token}` : undefined;

  const template = createElement(ApprovalEmailTemplate, {
    variant: content.variant,
    entityTitle: content.entityTitle,
    stepName: content.stepName,
    requesterName: content.requesterName,
    amount: content.amount != null ? String(content.amount) : null,
    priority: content.priority,
    comments: content.comments,
    approveLink: decisionLink ? `${decisionLink}?intent=approve` : undefined,
    rejectLink: decisionLink ? `${decisionLink}?intent=reject` : undefined,
    viewLink,
    assetBaseUrl: baseUrl(),
  });

  const [html, text] = await Promise.all([
    renderEmailWithI18N(template),
    renderEmailWithI18N(template, { plainText: true }),
  ]);

  return { subject: SUBJECTS[content.variant](content.entityTitle), html, text };
};

const send = async (
  to: { name?: string | null; email: string },
  content: ApprovalEmailContent,
  cc?: string[],
) => {
  const { subject, html, text } = await renderApprovalEmail(content);

  await mailer.sendMail({
    to: { name: to.name ?? '', address: to.email },
    ...(cc && cc.length > 0 ? { cc } : {}),
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject,
    html,
    text,
  });
};

export type SendApprovalRequestEmailInput = {
  to: { name?: string | null; email: string };
  entityTitle: string;
  requestId: string;
  token: string;
  stepName?: string | null;
  requesterName?: string | null;
  amount?: number | null;
  priority?: string | null;
};

export const sendApprovalRequestEmail = async (input: SendApprovalRequestEmailInput) =>
  send(input.to, { ...input, variant: 'request' });

export type SendApprovalReminderEmailInput = SendApprovalRequestEmailInput & {
  reminderType: string;
  ccEmails?: string[];
};

export const sendApprovalReminderEmail = async (input: SendApprovalReminderEmailInput) =>
  send(
    input.to,
    { ...input, variant: input.reminderType === 'Escalation' ? 'escalation' : 'reminder' },
    input.ccEmails,
  );

export type SendApprovalOutcomeEmailInput = {
  to: { name?: string | null; email: string };
  entityTitle: string;
  requestId: string;
  approved: boolean;
  comments?: string | null;
};

export const sendApprovalOutcomeEmail = async (input: SendApprovalOutcomeEmailInput) =>
  send(input.to, {
    variant: input.approved ? 'approved' : 'rejected',
    entityTitle: input.entityTitle,
    requestId: input.requestId,
    comments: input.comments,
  });
