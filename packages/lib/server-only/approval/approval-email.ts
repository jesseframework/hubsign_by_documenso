/**
 * Approval emails — request, reminder/escalation, and outcome notifications.
 *
 * Approve/reject happens on an anonymous page at `/approve/<token>` (explicit
 * buttons, not a one-click GET, to avoid accidental approval by link prefetch).
 * A "view in app" deep link is included for signed-in users.
 */

import { mailer } from '@documenso/email/mailer';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { FROM_ADDRESS, FROM_NAME } from '../../constants/email';

const baseUrl = () => NEXT_PUBLIC_WEBAPP_URL();

type Action = { label: string; url: string; tone?: 'primary' | 'danger' | 'plain' };

const BUTTON: Record<NonNullable<Action['tone']>, string> = {
  primary: 'background:#7c5cfc;color:#fff;border:1px solid #7c5cfc',
  danger: 'background:#fff;color:#dc2626;border:1px solid #f0a8a8',
  plain: 'background:#fff;color:#111;border:1px solid #d9d9e3',
};

/**
 * One or more call-to-action buttons.
 *
 * Each is a link to the decision page carrying its intent, NOT a link that
 * performs the decision. That distinction is the whole safety story: a mail
 * client or scanner that prefetches links would otherwise approve payments on
 * the approver's behalf, so the page still requires a click to commit. The
 * intent only decides which control is already open when they arrive.
 *
 * Table-based layout because Outlook ignores flexbox and inline-block margins.
 */
const shell = (heading: string, bodyHtml: string, actions: Action[]) => `
  <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="font-size:18px;margin:0 0 12px">${heading}</h2>
    ${bodyHtml}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr>
      ${actions
        .map(
          (action) =>
            `<td style="padding-right:8px"><a href="${action.url}" style="${
              BUTTON[action.tone ?? 'primary']
            };text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600;font-size:14px">${action.label}</a></td>`,
        )
        .join('')}
    </tr></table>
  </div>`;

const summaryRow = (label: string, value?: string | null) =>
  value ? `<tr><td style="padding:2px 12px 2px 0;color:#666">${label}</td><td style="padding:2px 0"><b>${value}</b></td></tr>` : '';

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

export const sendApprovalRequestEmail = async (input: SendApprovalRequestEmailInput) => {
  const approveUrl = `${baseUrl()}/approve/${input.token}`;
  const appUrl = `${baseUrl()}/org/approvals/${input.requestId}`;

  const body = `
    <p>You have an approval request waiting${input.stepName ? ` for the <b>${input.stepName}</b> step` : ''}.</p>
    <table style="font-size:14px;border-collapse:collapse;margin:12px 0">
      ${summaryRow('Document', input.entityTitle)}
      ${summaryRow('Requested by', input.requesterName)}
      ${summaryRow('Amount', input.amount != null ? String(input.amount) : null)}
      ${summaryRow('Priority', input.priority)}
    </table>
    <p style="font-size:13px;color:#666">Both buttons open the review page, where you confirm the decision. <a href="${appUrl}">View in app</a>.</p>`;

  await mailer.sendMail({
    to: { name: input.to.name ?? '', address: input.to.email },
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject: `Approval requested: ${input.entityTitle}`,
    html: shell('Approval requested', body, [
      { label: 'Approve', url: `${approveUrl}?intent=approve`, tone: 'primary' },
      { label: 'Decline', url: `${approveUrl}?intent=reject`, tone: 'danger' },
    ]),
    text: `Approval requested for "${input.entityTitle}". Review and decide: ${approveUrl}`,
  });
};

export type SendApprovalReminderEmailInput = SendApprovalRequestEmailInput & {
  reminderType: string;
  ccEmails?: string[];
};

export const sendApprovalReminderEmail = async (input: SendApprovalReminderEmailInput) => {
  const approveUrl = `${baseUrl()}/approve/${input.token}`;
  const isEscalation = input.reminderType === 'Escalation';

  const body = `
    <p>${isEscalation ? 'This approval has been <b>escalated</b> — it is still pending.' : 'A friendly reminder: this approval is still pending.'}</p>
    <table style="font-size:14px;border-collapse:collapse;margin:12px 0">
      ${summaryRow('Document', input.entityTitle)}
      ${summaryRow('Step', input.stepName)}
      ${summaryRow('Requested by', input.requesterName)}
    </table>`;

  await mailer.sendMail({
    to: { name: input.to.name ?? '', address: input.to.email },
    ...(input.ccEmails && input.ccEmails.length > 0 ? { cc: input.ccEmails } : {}),
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject: `${isEscalation ? '[Escalation] ' : 'Reminder: '}Approval pending: ${input.entityTitle}`,
    html: shell(isEscalation ? 'Approval escalated' : 'Approval reminder', body, [
      { label: 'Approve', url: `${approveUrl}?intent=approve`, tone: 'primary' },
      { label: 'Decline', url: `${approveUrl}?intent=reject`, tone: 'danger' },
    ]),
    text: `Approval still pending for "${input.entityTitle}". Review: ${approveUrl}`,
  });
};

export type SendApprovalOutcomeEmailInput = {
  to: { name?: string | null; email: string };
  entityTitle: string;
  requestId: string;
  approved: boolean;
  comments?: string | null;
};

export const sendApprovalOutcomeEmail = async (input: SendApprovalOutcomeEmailInput) => {
  const appUrl = `${baseUrl()}/org/approvals/${input.requestId}`;
  const verb = input.approved ? 'approved' : 'rejected';

  const body = `
    <p>Your approval request for <b>${input.entityTitle}</b> was <b>${verb}</b>.</p>
    ${input.comments ? `<p style="font-size:13px;color:#666">Comments: ${input.comments}</p>` : ''}`;

  await mailer.sendMail({
    to: { name: input.to.name ?? '', address: input.to.email },
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject: `Approval ${verb}: ${input.entityTitle}`,
    html: shell(`Approval ${verb}`, body, [{ label: 'View details', url: appUrl, tone: 'plain' }]),
    text: `Your approval request for "${input.entityTitle}" was ${verb}. ${appUrl}`,
  });
};
