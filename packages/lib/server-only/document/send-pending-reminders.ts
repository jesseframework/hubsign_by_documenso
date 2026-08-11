import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { DocumentStatus, ReminderKind, SendStatus, SigningStatus } from '@prisma/client';

import { mailer } from '@documenso/email/mailer';
import { DocumentReminderEmailTemplate } from '@documenso/email/templates/document-reminder';
import { prisma } from '@documenso/prisma';

import { getI18nInstance } from '../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { env } from '../../utils/env';
import { renderEmailWithI18N } from '../../utils/render-email-with-i18n';

export type SendPendingRemindersResult = {
  scanned: number;
  sent: number;
  errors: number;
};

/**
 * Scan all orgs that have sign reminders enabled and send reminder emails to
 * recipients who haven't signed yet past the org's threshold.
 *
 * Designed to be called periodically (e.g. once per hour) from an external
 * scheduler (cloud cron, GitHub Actions, etc.). Idempotent: each recipient
 * is only reminded once per `signReminderDays` window, up to a max count.
 */
export const sendPendingReminders = async (): Promise<SendPendingRemindersResult> => {
  const result: SendPendingRemindersResult = { scanned: 0, sent: 0, errors: 0 };

  // Find orgs with reminders enabled.
  const orgs = await prisma.organization.findMany({
    where: { signReminderEnabled: true },
    select: {
      id: true,
      name: true,
      signReminderDays: true,
      signReminderMaxCount: true,
      members: { select: { userId: true } },
    },
  });

  const senderName = env('NEXT_PRIVATE_SMTP_FROM_NAME') || 'HubSign';
  const senderAddress = env('NEXT_PRIVATE_SMTP_FROM_ADDRESS') || 'noreply@hubsign.io';
  const baseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';
  const i18n = await getI18nInstance();

  for (const org of orgs) {
    const memberUserIds = org.members.map((m) => m.userId);
    if (memberUserIds.length === 0) continue;

    const thresholdMs = org.signReminderDays * 24 * 60 * 60 * 1000;
    const threshold = new Date(Date.now() - thresholdMs);

    // Find pending recipients on documents owned by this org's members where
    // the document is past the threshold and the recipient hasn't signed,
    // and either no reminder yet or the last reminder is past threshold,
    // and we haven't exceeded max reminders.
    const recipients = await prisma.recipient.findMany({
      where: {
        sendStatus: SendStatus.SENT,
        signingStatus: SigningStatus.NOT_SIGNED,
        remindersSent: { lt: org.signReminderMaxCount },
        document: {
          status: DocumentStatus.PENDING,
          createdAt: { lt: threshold },
          userId: { in: memberUserIds },
        },
        OR: [
          { lastReminderAt: null },
          { lastReminderAt: { lt: threshold } },
        ],
      },
      include: {
        document: {
          select: { id: true, title: true, createdAt: true, userId: true },
        },
      },
      take: 200, // safety cap per run
    });

    // Pre-fetch document owners for personalising the email.
    const ownerIds = Array.from(new Set(recipients.map((r) => r.document?.userId).filter((u): u is number => typeof u === 'number')));
    const owners = await prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, name: true, email: true },
    });
    const ownerById = new Map(owners.map((u) => [u.id, u]));

    for (const recipient of recipients) {
      result.scanned += 1;
      if (!recipient.document) continue;

      const owner = ownerById.get(recipient.document.userId);
      const inviterName = owner?.name || owner?.email || 'A HubSign user';
      const signingLink = `${baseUrl}/sign/${recipient.token}`;

      const ageMs = Date.now() - new Date(recipient.document.createdAt).getTime();
      const daysWaiting = Math.max(1, Math.floor(ageMs / (24 * 60 * 60 * 1000)));

      const tpl = createElement(DocumentReminderEmailTemplate, {
        assetBaseUrl: baseUrl,
        baseUrl,
        recipientName: recipient.name || '',
        documentName: recipient.document.title,
        inviterName,
        signingLink,
        daysWaiting,
      });

      try {
        const [html, text] = await Promise.all([
          renderEmailWithI18N(tpl),
          renderEmailWithI18N(tpl, { plainText: true }),
        ]);

        await mailer.sendMail({
          to: { address: recipient.email, name: recipient.name || '' },
          from: { name: senderName, address: senderAddress },
          subject: i18n._(msg`Reminder: please sign "${recipient.document.title}"`),
          html,
          text,
        });

        const sentAt = new Date();

        // Counter and log written together. The scheduler reads the counter to
        // decide whether to send again; the inbox reads the log to say when the
        // nudges went out. If the two drifted apart, a row would either claim a
        // reminder it can't date or hide one it did send.
        await prisma.$transaction([
          prisma.recipient.update({
            where: { id: recipient.id },
            data: {
              remindersSent: { increment: 1 },
              lastReminderAt: sentAt,
            },
          }),
          prisma.recipientReminder.create({
            data: {
              recipientId: recipient.id,
              documentId: recipient.document.id,
              sentAt,
              kind: ReminderKind.AUTOMATIC,
            },
          }),
        ]);

        result.sent += 1;
      } catch (err) {
        console.error(
          `[send-pending-reminders] Failed to send reminder to recipient ${recipient.id}:`,
          err,
        );
        result.errors += 1;
      }
    }
  }

  return result;
};
