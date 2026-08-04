import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { DateTime } from 'luxon';

import { mailer } from '@documenso/email/mailer';
import SubscriptionPurchaseConfirmationTemplate from '@documenso/email/templates/subscription-purchase-confirmation';

import { getI18nInstance } from '../../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../../constants/app';
import { FROM_ADDRESS, FROM_NAME } from '../../../constants/email';
import { renderEmailWithI18N } from '../../../utils/render-email-with-i18n';
import type { JobRunIO } from '../../client/_internal/job';
import type { TSendSubscriptionPurchaseConfirmationEmailJobDefinition } from './send-subscription-purchase-confirmation-email';

export const run = async ({
  payload,
  io,
}: {
  payload: TSendSubscriptionPurchaseConfirmationEmailJobDefinition;
  io: JobRunIO;
}) => {
  const { email, name, planName, priceFormatted, periodEnd, billingUrl } = payload;

  const i18n = await getI18nInstance();

  const periodEndFormatted = periodEnd
    ? DateTime.fromISO(periodEnd).toUTC().toFormat('MMMM d, yyyy')
    : null;

  await io.runTask('send-purchase-confirmation-email', async () => {
    const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL();

    const template = createElement(SubscriptionPurchaseConfirmationTemplate, {
      assetBaseUrl,
      name: name || 'there',
      planName,
      priceFormatted,
      periodEndFormatted,
      billingUrl,
    });

    const [html, text] = await Promise.all([
      renderEmailWithI18N(template),
      renderEmailWithI18N(template, { plainText: true }),
    ]);

    await mailer.sendMail({
      to: {
        name: name || '',
        address: email,
      },
      from: {
        name: FROM_NAME,
        address: FROM_ADDRESS,
      },
      subject: i18n._(msg`Your ${planName} plan is active`),
      html,
      text,
    });
  });
};
