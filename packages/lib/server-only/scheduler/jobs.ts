/**
 * The recurring work this deployment runs, and how often.
 *
 * Each entry mirrors an `/api/cron/*` endpoint. Those endpoints stay for manual
 * triggering and for platforms that supply their own scheduler; this file is
 * what makes the work actually happen by default.
 *
 * Handlers are imported lazily so that merely starting the scheduler doesn't
 * pull the billing/Stripe and OCR module graphs into memory on boot.
 */

import { IS_BILLING_ENABLED } from '../../constants/app';
import type { ScheduledJob } from './scheduler';
import { SCHEDULER_LOCK_KEYS } from './scheduler';

const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;

export const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    id: 'inbox-poll',
    lockKey: SCHEDULER_LOCK_KEYS.inboxPoll,
    // The docs on the endpoint suggest 1–5 minutes; 2 keeps inbound invoices
    // feeling prompt without hammering the WorkHub API quota.
    intervalMs: 2 * ONE_MINUTE,
    run: async () => {
      const { pollAllOrgInboxes } = await import('../inbox/poll-workhub-inbox');
      return pollAllOrgInboxes();
    },
  },
  {
    id: 'workflows-due',
    lockKey: SCHEDULER_LOCK_KEYS.workflows,
    // Workflow cron expressions have minute granularity, so this must tick at
    // least once a minute or a schedule could be skipped entirely.
    intervalMs: ONE_MINUTE,
    run: async () => {
      const { runDueScheduledWorkflows } = await import('../workflow/run-due-scheduled');
      return runDueScheduledWorkflows();
    },
  },
  {
    id: 'sign-reminders',
    lockKey: SCHEDULER_LOCK_KEYS.signReminders,
    // Reminder cadence is configured in days, so hourly is ample resolution.
    intervalMs: ONE_HOUR,
    run: async () => {
      const { sendPendingReminders } = await import('../document/send-pending-reminders');
      return sendPendingReminders();
    },
  },
  {
    id: 'approval-reminders',
    lockKey: SCHEDULER_LOCK_KEYS.approvalReminders,
    intervalMs: ONE_HOUR,
    run: async () => {
      const { runDueApprovalReminders } = await import('../approval/run-due-reminders');
      return runDueApprovalReminders();
    },
  },
  {
    id: 'subscription-renewals',
    lockKey: SCHEDULER_LOCK_KEYS.subscriptionRenewals,
    intervalMs: 12 * ONE_HOUR,
    // Pointless work on a self-hosted install with no Stripe configured.
    enabled: () => IS_BILLING_ENABLED(),
    run: async () => {
      const { runDueSubscriptionRenewalReminders } = await import(
        '../billing/run-due-renewal-reminders'
      );
      return runDueSubscriptionRenewalReminders();
    },
  },
];
