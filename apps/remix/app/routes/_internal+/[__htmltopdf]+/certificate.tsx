import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { FieldType, SigningStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { CheckCircle2, FileText, Mail, MailOpen, PenLine, XCircle } from 'lucide-react';
import { redirect } from 'react-router';
import { match } from 'ts-pattern';
import { UAParser } from 'ua-parser-js';
import { renderSVG } from 'uqr';

import { isDocumentPlatform } from '@documenso/ee/server-only/util/is-document-platform';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { APP_I18N_OPTIONS, ZSupportedLanguageCodeSchema } from '@documenso/lib/constants/i18n';
import {
  RECIPIENT_ROLES_DESCRIPTION,
  RECIPIENT_ROLE_SIGNING_REASONS,
} from '@documenso/lib/constants/recipient-roles';
import { getEntireDocument } from '@documenso/lib/server-only/admin/get-entire-document';
import { decryptSecondaryData } from '@documenso/lib/server-only/crypto/decrypt';
import { getDocumentCertificateAuditLogs } from '@documenso/lib/server-only/document/get-document-certificate-audit-logs';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import { getTranslations } from '@documenso/lib/utils/i18n';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@documenso/ui/primitives/table';

import { BrandingLogo } from '~/components/general/branding-logo';

import type { Route } from './+types/certificate';

const FRIENDLY_SIGNING_REASONS = {
  ['__OWNER__']: msg`I am the owner of this document`,
  ...RECIPIENT_ROLE_SIGNING_REASONS,
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const d = url.searchParams.get('d');
  const statusHint = url.searchParams.get('status');

  if (typeof d !== 'string' || !d) {
    throw redirect('/');
  }

  const rawDocumentId = decryptSecondaryData(d);

  if (!rawDocumentId || isNaN(Number(rawDocumentId))) {
    throw redirect('/');
  }

  const documentId = Number(rawDocumentId);

  const document = await getEntireDocument({
    id: documentId,
  }).catch(() => null);

  if (!document) {
    throw redirect('/');
  }

  const isPlatformDocument = await isDocumentPlatform(document);

  const documentLanguage = ZSupportedLanguageCodeSchema.parse(document.documentMeta?.language);

  const auditLogs = await getDocumentCertificateAuditLogs({
    id: documentId,
  });

  const messages = await getTranslations(documentLanguage);

  return {
    document,
    documentLanguage,
    isPlatformDocument,
    auditLogs,
    messages,
    statusHint: statusHint === 'COMPLETED' || statusHint === 'REJECTED' ? statusHint : null,
  };
}

/**
/**
 * DO NOT USE TRANS. YOU MUST USE _ FOR THIS FILE AND ALL CHILDREN COMPONENTS.
 *
 * Cannot use dynamicActivate by itself to translate this specific page and all
 * children components because `not-found.tsx` page runs and overrides the i18n.
 *
 * Update: Maybe <Trans> tags work now after RR7 migration.
 */
export default function SigningCertificate({ loaderData }: Route.ComponentProps) {
  const { document, documentLanguage, isPlatformDocument, auditLogs, messages, statusHint } =
    loaderData;

  // The cert is generated mid-seal so the live `document.status` is still
  // PENDING. Use the status hint passed via URL when present.
  const displayStatus = (statusHint ?? document.status).toLowerCase();

  const { i18n, _ } = useLingui();

  i18n.loadAndActivate({ locale: documentLanguage, messages });

  const isOwner = (email: string) => {
    return email.toLowerCase() === document.user.email.toLowerCase();
  };

  const getDevice = (userAgent?: string | null) => {
    if (!userAgent) {
      return 'Unknown';
    }

    const parser = new UAParser(userAgent);

    parser.setUA(userAgent);

    const result = parser.getResult();

    return `${result.os.name} - ${result.browser.name} ${result.browser.version}`;
  };

  const getAuthenticationLevel = (recipientId: number) => {
    const recipient = document.recipients.find((recipient) => recipient.id === recipientId);

    if (!recipient) {
      return 'Unknown';
    }

    const extractedAuthMethods = extractDocumentAuthMethods({
      documentAuth: document.authOptions,
      recipientAuth: recipient.authOptions,
    });

    let authLevel = match(extractedAuthMethods.derivedRecipientActionAuth)
      .with('ACCOUNT', () => _(msg`Account Re-Authentication`))
      .with('TWO_FACTOR_AUTH', () => _(msg`Two-Factor Re-Authentication`))
      .with('PASSKEY', () => _(msg`Passkey Re-Authentication`))
      .with('EXPLICIT_NONE', () => _(msg`Email`))
      .with(null, () => null)
      .exhaustive();

    if (!authLevel) {
      authLevel = match(extractedAuthMethods.derivedRecipientAccessAuth)
        .with('ACCOUNT', () => _(msg`Account Authentication`))
        .with(null, () => _(msg`Email`))
        .exhaustive();
    }

    return authLevel;
  };

  const getRecipientAuditLogs = (recipientId: number) => {
    return {
      [DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT]: auditLogs[DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT].filter(
        (log) =>
          log.type === DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT && log.data.recipientId === recipientId,
      ),
      [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED]: auditLogs[
        DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED
      ].filter(
        (log) =>
          log.type === DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED &&
          log.data.recipientId === recipientId,
      ),
      [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED]: auditLogs[
        DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED
      ].filter(
        (log) =>
          log.type === DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED &&
          log.data.recipientId === recipientId,
      ),
      [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED]: auditLogs[
        DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED
      ].filter(
        (log) =>
          log.type === DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED &&
          log.data.recipientId === recipientId,
      ),
    };
  };

  const getRecipientSignatureField = (recipientId: number) => {
    return document.recipients
      .find((recipient) => recipient.id === recipientId)
      ?.fields.find(
        (field) => field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE,
      );
  };

  // Build a chronological "history" of every meaningful event for the
  // Final Audit Report timeline. Each entry maps to one row in the printed
  // history section.
  type HistoryEntry = {
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    title: string;
    timestamp: Date;
    detail?: string;
  };

  const history: HistoryEntry[] = [];
  history.push({
    icon: FileText,
    iconClass: 'text-orange-500',
    title: _(msg`Document created by ${document.user.name ?? document.user.email} (${document.user.email})`),
    timestamp: document.createdAt,
  });
  for (const log of auditLogs[DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT]) {
    if (log.type !== DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT) continue;
    history.push({
      icon: Mail,
      iconClass: 'text-blue-500',
      title: _(msg`Document emailed to ${log.data.recipientName || log.data.recipientEmail} (${log.data.recipientEmail}) for signature`),
      timestamp: log.createdAt,
    });
  }
  for (const log of auditLogs[DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED]) {
    if (log.type !== DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED) continue;
    const r = document.recipients.find((x) => x.id === log.data.recipientId);
    history.push({
      icon: MailOpen,
      iconClass: 'text-orange-500',
      title: _(msg`Email viewed by ${r?.name || r?.email || _(msg`Unknown`)} (${r?.email ?? ''})`),
      timestamp: log.createdAt,
    });
  }
  for (const log of auditLogs[DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED]) {
    if (log.type !== DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED) continue;
    const r = document.recipients.find((x) => x.id === log.data.recipientId);
    history.push({
      icon: PenLine,
      iconClass: 'text-green-600',
      title: _(msg`Document e-signed by ${r?.name || r?.email || _(msg`Unknown`)} (${r?.email ?? ''})`),
      timestamp: log.createdAt,
      detail: _(msg`Time Source: server`),
    });
  }
  for (const log of auditLogs[DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED]) {
    if (log.type !== DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED) continue;
    const r = document.recipients.find((x) => x.id === log.data.recipientId);
    history.push({
      icon: XCircle,
      iconClass: 'text-red-600',
      title: _(msg`Document rejected by ${r?.name || r?.email || _(msg`Unknown`)} (${r?.email ?? ''})`),
      timestamp: log.createdAt,
    });
  }
  if (document.completedAt) {
    history.push({
      icon: CheckCircle2,
      iconClass: 'text-green-600',
      title: document.status === 'REJECTED' ? _(msg`Agreement rejected.`) : _(msg`Agreement completed.`),
      timestamp: document.completedAt,
    });
  }
  history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const formatTs = (d: Date) =>
    DateTime.fromJSDate(d)
      .setLocale(APP_I18N_OPTIONS.defaultLocale)
      .toFormat('yyyy-MM-dd - HH:mm:ss ZZZZ');

  const reportDate = DateTime.fromJSDate(document.completedAt ?? new Date())
    .setLocale(APP_I18N_OPTIONS.defaultLocale)
    .toFormat('yyyy-MM-dd');

  const verifyUrl = document.qrToken
    ? `${NEXT_PUBLIC_WEBAPP_URL()}/verify/${document.qrToken}`
    : null;

  return (
    <div className="print-provider pointer-events-none mx-auto max-w-screen-md p-2">
      {/* Final Audit Report header */}
      <div className="border-b pb-4">
        <h1 className="text-primary text-3xl font-semibold">{document.title}</h1>
        <div className="mt-2 flex items-end justify-between text-muted-foreground">
          <p className="text-base">{_(msg`Final Audit Report`)}</p>
          <p className="text-sm">{reportDate}</p>
        </div>
      </div>

      {/* Summary box */}
      <div className="mt-6 rounded-md border bg-muted/30 p-4">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="w-48 py-1 align-top text-muted-foreground">{_(msg`Created`)}:</td>
              <td className="py-1">
                {DateTime.fromJSDate(document.createdAt)
                  .setLocale(APP_I18N_OPTIONS.defaultLocale)
                  .toFormat('yyyy-MM-dd')}
              </td>
            </tr>
            <tr>
              <td className="py-1 align-top text-muted-foreground">{_(msg`By`)}:</td>
              <td className="py-1">
                {document.user.name
                  ? `${document.user.name} (${document.user.email})`
                  : document.user.email}
              </td>
            </tr>
            <tr>
              <td className="py-1 align-top text-muted-foreground">{_(msg`Status`)}:</td>
              <td className="py-1 capitalize">{displayStatus}</td>
            </tr>
            <tr>
              <td className="py-1 align-top text-muted-foreground">{_(msg`Transaction ID`)}:</td>
              <td className="break-all py-1 font-mono text-xs">
                {document.qrToken ?? _(msg`N/A`)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Document History timeline */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold">{_(msg`"${document.title}" History`)}</h2>
        <ul className="mt-4 space-y-4">
          {history.map((entry, i) => {
            const Icon = entry.icon;
            return (
              <li key={i} className="flex items-start gap-3 print:break-inside-avoid">
                <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${entry.iconClass}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{entry.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatTs(entry.timestamp)}
                    {entry.detail ? ` - ${entry.detail}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Signer Details — rendered as a continuation of the report rather
          than a separate card so the whole page reads as one document. */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold">{_(msg`Signer Details`)}</h2>
        <div className="mt-3 overflow-hidden rounded-md border">
          <Table overflowHidden>
            <TableHeader>
              <TableRow>
                <TableHead>{_(msg`Signer Events`)}</TableHead>
                <TableHead>{_(msg`Signature`)}</TableHead>
                <TableHead>{_(msg`Details`)}</TableHead>
                {/* <TableHead>Security</TableHead> */}
              </TableRow>
            </TableHeader>

            <TableBody className="print:text-xs">
              {document.recipients.map((recipient, i) => {
                const logs = getRecipientAuditLogs(recipient.id);
                const signature = getRecipientSignatureField(recipient.id);

                return (
                  <TableRow key={i} className="print:break-inside-avoid">
                    <TableCell truncate={false} className="w-[min-content] max-w-[220px] align-top">
                      <div className="hyphens-auto break-words font-medium">{recipient.name}</div>
                      <div className="break-all">{recipient.email}</div>
                      <p className="text-muted-foreground mt-2 text-sm print:text-xs">
                        {_(RECIPIENT_ROLES_DESCRIPTION[recipient.role].roleName)}
                      </p>

                      <p className="text-muted-foreground mt-2 text-sm print:text-xs">
                        <span className="font-medium">{_(msg`Authentication Level`)}:</span>{' '}
                        <span className="block">{getAuthenticationLevel(recipient.id)}</span>
                      </p>
                    </TableCell>

                    <TableCell truncate={false} className="w-[min-content] align-top">
                      {signature ? (
                        <>
                          <div
                            className="inline-block rounded-lg p-1"
                            style={{
                              boxShadow: `0px 0px 0px 4.88px rgba(122, 196, 85, 0.1), 0px 0px 0px 1.22px rgba(122, 196, 85, 0.6), 0px 0px 0px 0.61px rgba(122, 196, 85, 1)`,
                            }}
                          >
                            {signature.signature?.signatureImageAsBase64 && (
                              <img
                                src={`${signature.signature?.signatureImageAsBase64}`}
                                alt="Signature"
                                className="max-h-12 max-w-full"
                              />
                            )}

                            {signature.signature?.typedSignature && (
                              <p className="font-signature text-center text-sm">
                                {signature.signature?.typedSignature}
                              </p>
                            )}
                          </div>

                          <p className="text-muted-foreground mt-2 text-sm print:text-xs">
                            <span className="font-medium">{_(msg`Signature ID`)}:</span>{' '}
                            <span className="block font-mono uppercase">
                              {signature.secondaryId}
                            </span>
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">N/A</p>
                      )}

                      <p className="text-muted-foreground mt-2 text-sm print:text-xs">
                        <span className="font-medium">{_(msg`IP Address`)}:</span>{' '}
                        <span className="inline-block">
                          {logs.DOCUMENT_RECIPIENT_COMPLETED[0]?.ipAddress ?? _(msg`Unknown`)}
                        </span>
                      </p>

                      <p className="text-muted-foreground mt-1 text-sm print:text-xs">
                        <span className="font-medium">{_(msg`Device`)}:</span>{' '}
                        <span className="inline-block">
                          {getDevice(logs.DOCUMENT_RECIPIENT_COMPLETED[0]?.userAgent)}
                        </span>
                      </p>
                    </TableCell>

                    <TableCell truncate={false} className="w-[min-content] align-top">
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-sm print:text-xs">
                          <span className="font-medium">{_(msg`Sent`)}:</span>{' '}
                          <span className="inline-block">
                            {logs.EMAIL_SENT[0]
                              ? DateTime.fromJSDate(logs.EMAIL_SENT[0].createdAt)
                                  .setLocale(APP_I18N_OPTIONS.defaultLocale)
                                  .toFormat('yyyy-MM-dd hh:mm:ss a (ZZZZ)')
                              : _(msg`Unknown`)}
                          </span>
                        </p>

                        <p className="text-muted-foreground text-sm print:text-xs">
                          <span className="font-medium">{_(msg`Viewed`)}:</span>{' '}
                          <span className="inline-block">
                            {logs.DOCUMENT_OPENED[0]
                              ? DateTime.fromJSDate(logs.DOCUMENT_OPENED[0].createdAt)
                                  .setLocale(APP_I18N_OPTIONS.defaultLocale)
                                  .toFormat('yyyy-MM-dd hh:mm:ss a (ZZZZ)')
                              : _(msg`Unknown`)}
                          </span>
                        </p>

                        {logs.DOCUMENT_RECIPIENT_REJECTED[0] ? (
                          <p className="text-muted-foreground text-sm print:text-xs">
                            <span className="font-medium">{_(msg`Rejected`)}:</span>{' '}
                            <span className="inline-block">
                              {logs.DOCUMENT_RECIPIENT_REJECTED[0]
                                ? DateTime.fromJSDate(logs.DOCUMENT_RECIPIENT_REJECTED[0].createdAt)
                                    .setLocale(APP_I18N_OPTIONS.defaultLocale)
                                    .toFormat('yyyy-MM-dd hh:mm:ss a (ZZZZ)')
                                : _(msg`Unknown`)}
                            </span>
                          </p>
                        ) : (
                          <p className="text-muted-foreground text-sm print:text-xs">
                            <span className="font-medium">{_(msg`Signed`)}:</span>{' '}
                            <span className="inline-block">
                              {logs.DOCUMENT_RECIPIENT_COMPLETED[0]
                                ? DateTime.fromJSDate(
                                    logs.DOCUMENT_RECIPIENT_COMPLETED[0].createdAt,
                                  )
                                    .setLocale(APP_I18N_OPTIONS.defaultLocale)
                                    .toFormat('yyyy-MM-dd hh:mm:ss a (ZZZZ)')
                                : _(msg`Unknown`)}
                            </span>
                          </p>
                        )}

                        <p className="text-muted-foreground text-sm print:text-xs">
                          <span className="font-medium">{_(msg`Reason`)}:</span>{' '}
                          <span className="inline-block">
                            {recipient.signingStatus === SigningStatus.REJECTED
                              ? recipient.rejectionReason
                              : _(
                                  isOwner(recipient.email)
                                    ? FRIENDLY_SIGNING_REASONS['__OWNER__']
                                    : FRIENDLY_SIGNING_REASONS[recipient.role],
                                )}
                          </span>
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Verification QR + signature hash — closing section of the report. */}
      {verifyUrl && (
        <div className="mt-8 flex items-start justify-between gap-6 rounded-md border p-4 print:break-inside-avoid">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{_(msg`Verify this document`)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {_(msg`Scan the QR code or visit the URL below to confirm this document is authentic.`)}
            </p>
            <p className="mt-2 break-all font-mono text-xs">{verifyUrl}</p>
            <p className="text-muted-foreground mt-2 text-xs">
              {_(
                msg`The verification page shows a SHA-256 fingerprint of this file that anyone can recompute from a downloaded copy.`,
              )}
            </p>
          </div>
          <div
            className="h-28 w-28 flex-shrink-0"
            dangerouslySetInnerHTML={{ __html: renderSVG(verifyUrl, { ecc: 'M' }) }}
          />
        </div>
      )}

      {isPlatformDocument && (
        <div className="mt-8 flex items-end justify-end gap-x-4 print:break-inside-avoid">
          <p className="flex-shrink-0 text-sm font-medium print:text-xs">
            {_(msg`Signing certificate provided by`)}:
          </p>
          <BrandingLogo className="max-h-6 print:max-h-4" />
        </div>
      )}
    </div>
  );
}
