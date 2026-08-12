import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { DocumentSource } from '@prisma/client';

import { mailer } from '@documenso/email/mailer';
import { DocumentCompletedEmailTemplate } from '@documenso/email/templates/document-completed';
import { prisma } from '@documenso/prisma';

import { getI18nInstance } from '../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import { extractDerivedDocumentEmailSettings } from '../../types/document-email';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { resolveOcrVendorName } from '../../universal/ocr-fields';
import { getFileServerSide } from '../../universal/upload/get-file.server';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import { env } from '../../utils/env';
import { renderCustomEmailTemplate } from '../../utils/render-custom-email-template';
import { renderEmailWithI18N } from '../../utils/render-email-with-i18n';
import { teamGlobalSettingsToBranding } from '../../utils/team-global-settings-to-branding';
import { formatDocumentsPath } from '../../utils/teams';

/** Longest vendor name allowed into a subject line. */
const MAX_SUBJECT_VENDOR_LENGTH = 60;

export interface SendDocumentOptions {
  documentId: number;
  requestMetadata?: RequestMetadata;
}

export const sendCompletedEmail = async ({ documentId, requestMetadata }: SendDocumentOptions) => {
  const document = await prisma.document.findUnique({
    where: {
      id: documentId,
    },
    include: {
      documentData: true,
      documentMeta: true,
      recipients: true,
      user: true,
      team: {
        select: {
          id: true,
          url: true,
          teamGlobalSettings: true,
        },
      },
      /*
        What OCR read, for documents that arrived through the signature inbox. Only
        the extraction, and only to name the counterparty in the subject line.
      */
      inboxItem: { select: { extractedData: true } },
    },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  const isDirectTemplate = document?.source === DocumentSource.TEMPLATE_DIRECT_LINK;

  if (document.recipients.length === 0) {
    throw new Error('Document has no recipients');
  }

  const { user: owner } = document;

  const completedDocument = await getFileServerSide(document.documentData);

  const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';

  let documentOwnerDownloadLink = `${NEXT_PUBLIC_WEBAPP_URL()}${formatDocumentsPath(
    document.team?.url,
  )}/${document.id}`;

  if (document.team?.url) {
    documentOwnerDownloadLink = `${NEXT_PUBLIC_WEBAPP_URL()}/t/${document.team.url}/documents/${
      document.id
    }`;
  }

  const i18n = await getI18nInstance(document.documentMeta?.language);

  /*
    Subject line, naming the counterparty when we know it.

    "Signing Complete!" tells an AP clerk with forty of these in their inbox
    nothing at all. The vendor name is the one word that makes the mail findable
    later and identifiable at a glance — so it goes in when OCR read one, and the
    subject falls back to the plain form when it did not. Hand-uploaded documents
    never have one, which is why this cannot be unconditional.

    The phrase "Signing Complete" is preserved verbatim at the start. An
    organization may have configured it as a blocked inbox subject to stop
    completion mail (which carries the signed PDF as an attachment) being ingested
    as a fresh invoice; that filter is a substring match, so appending to the
    phrase keeps the guard working while replacing it would silently re-open the
    feedback loop.
  */
  const vendorName = resolveOcrVendorName(document.inboxItem?.extractedData ?? null);

  // Capped: a subject is not a place for a paragraph, and an extraction that
  // grabbed half an address block would otherwise land there in full.
  const subjectVendor =
    vendorName && vendorName.trim().length > 0
      ? vendorName.trim().slice(0, MAX_SUBJECT_VENDOR_LENGTH)
      : null;

  const completedSubject = subjectVendor
    ? i18n._(msg`Signing Complete for ${subjectVendor}`)
    : i18n._(msg`Signing Complete!`);

  const emailSettings = extractDerivedDocumentEmailSettings(document.documentMeta);
  const isDocumentCompletedEmailEnabled = emailSettings.documentCompleted;
  const isOwnerDocumentCompletedEmailEnabled = emailSettings.ownerDocumentCompleted;

  // Send email to document owner if:
  // 1. Owner document completed emails are enabled AND
  // 2. Either:
  //    - The owner is not a recipient, OR
  //    - Recipient emails are disabled
  if (
    isOwnerDocumentCompletedEmailEnabled &&
    (!document.recipients.find((recipient) => recipient.email === owner.email) ||
      !isDocumentCompletedEmailEnabled)
  ) {
    const template = createElement(DocumentCompletedEmailTemplate, {
      documentName: document.title,
      assetBaseUrl,
      downloadLink: documentOwnerDownloadLink,
    });

    const branding = document.team?.teamGlobalSettings
      ? teamGlobalSettingsToBranding(document.team.teamGlobalSettings)
      : undefined;

    const [html, text] = await Promise.all([
      renderEmailWithI18N(template, { lang: document.documentMeta?.language, branding }),
      renderEmailWithI18N(template, {
        lang: document.documentMeta?.language,
        branding,
        plainText: true,
      }),
    ]);

    await mailer.sendMail({
      to: [
        {
          name: owner.name || '',
          address: owner.email,
        },
      ],
      from: {
        name: env('NEXT_PRIVATE_SMTP_FROM_NAME') || 'HubSign',
        address: env('NEXT_PRIVATE_SMTP_FROM_ADDRESS') || 'noreply@hubsign.io',
      },
      subject: completedSubject,
      html,
      text,
      attachments: [
        {
          filename: document.title.endsWith('.pdf') ? document.title : document.title + '.pdf',
          content: Buffer.from(completedDocument),
        },
      ],
    });

    await prisma.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT,
        documentId: document.id,
        user: null,
        requestMetadata,
        data: {
          emailType: 'DOCUMENT_COMPLETED',
          recipientEmail: owner.email,
          recipientName: owner.name ?? '',
          recipientId: owner.id,
          recipientRole: 'OWNER',
          isResending: false,
        },
      }),
    });
  }

  if (!isDocumentCompletedEmailEnabled) {
    return;
  }

  await Promise.all(
    document.recipients.map(async (recipient) => {
      const customEmailTemplate = {
        'signer.name': recipient.name,
        'signer.email': recipient.email,
        'document.name': document.title,
      };

      const downloadLink = `${NEXT_PUBLIC_WEBAPP_URL()}/sign/${recipient.token}/complete`;

      const template = createElement(DocumentCompletedEmailTemplate, {
        documentName: document.title,
        assetBaseUrl,
        downloadLink: recipient.email === owner.email ? documentOwnerDownloadLink : downloadLink,
        customBody:
          isDirectTemplate && document.documentMeta?.message
            ? renderCustomEmailTemplate(document.documentMeta.message, customEmailTemplate)
            : undefined,
      });

      const branding = document.team?.teamGlobalSettings
        ? teamGlobalSettingsToBranding(document.team.teamGlobalSettings)
        : undefined;

      const [html, text] = await Promise.all([
        renderEmailWithI18N(template, { lang: document.documentMeta?.language, branding }),
        renderEmailWithI18N(template, {
          lang: document.documentMeta?.language,
          branding,
          plainText: true,
        }),
      ]);

      await mailer.sendMail({
        to: [
          {
            name: recipient.name,
            address: recipient.email,
          },
        ],
        from: {
          name: env('NEXT_PRIVATE_SMTP_FROM_NAME') || 'HubSign',
          address: env('NEXT_PRIVATE_SMTP_FROM_ADDRESS') || 'noreply@hubsign.io',
        },
        subject:
          isDirectTemplate && document.documentMeta?.subject
            ? renderCustomEmailTemplate(document.documentMeta.subject, customEmailTemplate)
            : completedSubject,
        html,
        text,
        attachments: [
          {
            filename: document.title.endsWith('.pdf') ? document.title : document.title + '.pdf',
            content: Buffer.from(completedDocument),
          },
        ],
      });

      await prisma.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT,
          documentId: document.id,
          user: null,
          requestMetadata,
          data: {
            emailType: 'DOCUMENT_COMPLETED',
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            recipientId: recipient.id,
            recipientRole: recipient.role,
            isResending: false,
          },
        }),
      });
    }),
  );

  // Best-effort push notifications to the owner + any recipient who is a
  // HubSign user with the preference enabled.
  try {
    const { sendFcmNotificationToUser } = await import(
      '../push-notifications/fcm-client'
    );

    const recipientEmails = document.recipients.map((r) => r.email);
    const pushTargets = await prisma.user.findMany({
      where: { email: { in: [owner.email, ...recipientEmails] } },
      select: {
        id: true,
        email: true,
        pushNotifPrefs: { select: { documentCompleted: true } },
      },
    });

    await Promise.all(
      pushTargets
        .filter((u) => u.pushNotifPrefs?.documentCompleted !== false)
        .map((u) =>
          sendFcmNotificationToUser(u.id, {
            title: `"${document.title}" is complete`,
            body: 'All recipients have signed the document.',
            link:
              u.email === owner.email
                ? documentOwnerDownloadLink
                : `${NEXT_PUBLIC_WEBAPP_URL()}/documents/${document.id}`,
            data: { documentId: String(document.id) },
          }),
        ),
    );
  } catch (err) {
    console.error('[send-completed-email] push failed (non-fatal):', err);
  }
};
