import { z } from 'zod';

import { type JobDefinition } from '../../client/_internal/job';

const SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_ID =
  'send.subscription.renewal-reminder.email';

const SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_SCHEMA = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  planName: z.string(),
  priceFormatted: z.string(),
  periodEnd: z.string().datetime(),
  billingUrl: z.string(),
});

export type TSendSubscriptionRenewalReminderEmailJobDefinition = z.infer<
  typeof SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_SCHEMA
>;

export const SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION = {
  id: SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_ID,
  name: 'Send Subscription Renewal Reminder Email',
  version: '1.0.0',
  trigger: {
    name: SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_ID,
    schema: SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_SCHEMA,
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./send-subscription-renewal-reminder-email.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<
  typeof SEND_SUBSCRIPTION_RENEWAL_REMINDER_EMAIL_JOB_DEFINITION_ID,
  TSendSubscriptionRenewalReminderEmailJobDefinition
>;
