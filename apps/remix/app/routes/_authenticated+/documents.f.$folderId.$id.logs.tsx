import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import type { Recipient } from '@prisma/client';
import { ChevronLeft } from 'lucide-react';
import { DateTime } from 'luxon';
import { Link, redirect } from 'react-router';

import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { getDocumentById } from '@documenso/lib/server-only/document/get-document-by-id';
import { getRecipientsForDocument } from '@documenso/lib/server-only/recipient/get-recipients-for-document';
import { type TGetTeamByUrlResponse, getTeamByUrl } from '@documenso/lib/server-only/team/get-team';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';


import { DocumentAuditLogDownloadButton } from '~/components/general/document/document-audit-log-download-button';
import { DocumentCertificateDownloadButton } from '~/components/general/document/document-certificate-download-button';
import {
  DocumentStatus as DocumentStatusComponent,
  FRIENDLY_STATUS_MAP,
} from '~/components/general/document/document-status';
import { DocumentLogsTable } from '~/components/tables/document-logs-table';

import type { Route } from './+types/documents.f.$folderId.$id.logs';

export async function loader({ params, request }: Route.LoaderArgs) {
  const { user } = await getSession(request);

  let team: TGetTeamByUrlResponse | null = null;

  if (params.teamUrl) {
    team = await getTeamByUrl({ userId: user.id, teamUrl: params.teamUrl });
  }

  const { id, folderId } = params;

  const documentId = Number(id);

  const documentRootPath = formatDocumentsPath(team?.url);

  if (!documentId || Number.isNaN(documentId)) {
    throw redirect(folderId ? `${documentRootPath}/f/${folderId}` : documentRootPath);
  }

  if (!folderId) {
    throw redirect(documentRootPath);
  }

  // Todo: Get full document instead?
  const [document, recipients] = await Promise.all([
    getDocumentById({
      documentId,
      userId: user.id,
      teamId: team?.id,
      folderId,
    }).catch(() => null),
    getRecipientsForDocument({
      documentId,
      userId: user.id,
      teamId: team?.id,
    }),
  ]);

  if (!document || !document.documentData) {
    throw redirect(folderId ? `${documentRootPath}/f/${folderId}` : documentRootPath);
  }

  if (document.folderId !== folderId) {
    throw redirect(documentRootPath);
  }

  return {
    document,
    documentRootPath,
    recipients,
    folderId,
  };
}

export default function DocumentsLogsPage({ loaderData }: Route.ComponentProps) {
  const { document, documentRootPath, recipients, folderId } = loaderData;

  const { _, i18n } = useLingui();

  const documentInformation: { description: MessageDescriptor; value: string }[] = [
    {
      description: msg`Document title`,
      value: document.title,
    },
    {
      description: msg`Document ID`,
      value: document.id.toString(),
    },
    {
      description: msg`Document status`,
      value: _(FRIENDLY_STATUS_MAP[document.status].label),
    },
    {
      description: msg`Created by`,
      value: document.user.name
        ? `${document.user.name} (${document.user.email})`
        : document.user.email,
    },
    {
      description: msg`Date created`,
      value: DateTime.fromJSDate(document.createdAt)
        .setLocale(i18n.locales?.[0] || i18n.locale)
        .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS),
    },
    {
      description: msg`Last updated`,
      value: DateTime.fromJSDate(document.updatedAt)
        .setLocale(i18n.locales?.[0] || i18n.locale)
        .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS),
    },
    {
      description: msg`Time zone`,
      value: document.documentMeta?.timezone ?? 'N/A',
    },
  ];

  const formatRecipientText = (recipient: Recipient) => {
    let text = recipient.email;

    if (recipient.name) {
      text = `${recipient.name} (${recipient.email})`;
    }

    return `[${recipient.role}] ${text}`;
  };

  return (
    <div className="w-full">
      <Link
        to={`${documentRootPath}/f/${folderId}/${document.id}`}
        className="flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="mr-1 inline-block h-4 w-4" />
        <Trans>Document</Trans>
      </Link>

      <div className="mt-3 flex flex-col">
        <h1
          className="block max-w-[20rem] truncate text-xl font-semibold tracking-tight md:max-w-[30rem] md:text-2xl"
          title={document.title}
        >
          {document.title}
        </h1>

        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <DocumentStatusComponent asBadge status={document.status} />

          <div className="flex gap-2">
            <DocumentCertificateDownloadButton
              documentId={document.id}
              documentStatus={document.status}
            />
            <DocumentAuditLogDownloadButton documentId={document.id} />
          </div>
        </div>
      </div>

      <section className="mt-5">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {documentInformation.map((info, i) => (
              <div key={i}>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  {_(info.description)}
                </h3>
                <p className="mt-0.5 truncate text-[13px] text-foreground">{info.value}</p>
              </div>
            ))}

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                <Trans>Recipients</Trans>
              </h3>
              <ul className="mt-0.5 space-y-0.5">
                {recipients.map((recipient) => (
                  <li key={`recipient-${recipient.id}`} className="truncate text-[13px] text-foreground">
                    {formatRecipientText(recipient)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <DocumentLogsTable documentId={document.id} />
      </section>
    </div>
  );
}
