import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { DocumentStatus, RecipientRole, SigningStatus } from '@prisma/client';
import { CheckCircle, Download, Edit, EyeIcon, Pencil } from 'lucide-react';
import { Link } from 'react-router';
import { match } from 'ts-pattern';

import { downloadPDF } from '@documenso/lib/client-only/download-pdf';
import { useSession } from '@documenso/lib/client-only/providers/session';
import type { TDocumentMany as TDocumentRow } from '@documenso/lib/types/document';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { trpc as trpcClient } from '@documenso/trpc/client';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useOptionalCurrentTeam } from '~/providers/team';

export type DocumentsTableActionButtonProps = {
  row: TDocumentRow;
};

const actionBtnClass =
  'inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer';

const accentLight = `${actionBtnClass} bg-primary/10 text-primary hover:bg-primary/15`;
const inboxLight = `${actionBtnClass} bg-status-inbox-bg text-status-inbox-text hover:bg-status-inbox-bg/80`;

export const DocumentsTableActionButton = ({ row }: DocumentsTableActionButtonProps) => {
  const { user } = useSession();
  const { toast } = useToast();
  const { _ } = useLingui();

  const team = useOptionalCurrentTeam();

  const recipient = row.recipients.find((recipient) => recipient.email === user.email);

  const isOwner = row.user.id === user.id;
  const isRecipient = !!recipient;
  const isDraft = row.status === DocumentStatus.DRAFT;
  const isPending = row.status === DocumentStatus.PENDING;
  const isComplete = isDocumentCompleted(row.status);
  const isSigned = recipient?.signingStatus === SigningStatus.SIGNED;
  const role = recipient?.role;
  const isCurrentTeamDocument = team && row.team?.url === team.url;

  const documentsPath = formatDocumentsPath(team?.url);
  const formatPath = row.folderId
    ? `${documentsPath}/f/${row.folderId}/${row.id}/edit`
    : `${documentsPath}/${row.id}/edit`;

  const onDownloadClick = async () => {
    try {
      const document = !recipient
        ? await trpcClient.document.getDocumentById.query(
            {
              documentId: row.id,
            },
            {
              context: {
                teamId: team?.id?.toString(),
              },
            },
          )
        : await trpcClient.document.getDocumentByToken.query({
            token: recipient.token,
          });

      const documentData = document?.documentData;

      if (!documentData) {
        throw Error('No document available');
      }

      await downloadPDF({ documentData, fileName: row.title });
    } catch (err) {
      toast({
        title: _(msg`Something went wrong`),
        description: _(msg`An error occurred while downloading your document.`),
        variant: 'destructive',
      });
    }
  };

  // TODO: Consider if want to keep this logic for hiding viewing for CC'ers
  if (recipient?.role === RecipientRole.CC && isComplete === false) {
    return null;
  }

  return match({
    isOwner,
    isRecipient,
    isDraft,
    isPending,
    isComplete,
    isSigned,
    isCurrentTeamDocument,
  })
    .with(
      isOwner ? { isDraft: true, isOwner: true } : { isDraft: true, isCurrentTeamDocument: true },
      () => (
        <Link to={formatPath} className={accentLight}>
          <Edit className="h-3 w-3" />
          <Trans>Edit</Trans>
        </Link>
      ),
    )
    .with({ isRecipient: true, isPending: true, isSigned: false }, () => (
      <Link to={`/sign/${recipient?.token}`} className={inboxLight}>
        {match(role)
          .with(RecipientRole.SIGNER, () => (
            <>
              <Pencil className="h-3 w-3" />
              <Trans>Sign</Trans>
            </>
          ))
          .with(RecipientRole.APPROVER, () => (
            <>
              <CheckCircle className="h-3 w-3" />
              <Trans>Approve</Trans>
            </>
          ))
          .otherwise(() => (
            <>
              <EyeIcon className="h-3 w-3" />
              <Trans>View</Trans>
            </>
          ))}
      </Link>
    ))
    .with({ isPending: true, isSigned: true }, () => (
      <span className={`${accentLight} opacity-50 cursor-default`}>
        <EyeIcon className="h-3 w-3" />
        <Trans>View</Trans>
      </span>
    ))
    .with({ isComplete: true }, () => (
      <button className={accentLight} onClick={onDownloadClick}>
        <Download className="h-3 w-3" />
        <Trans>Download</Trans>
      </button>
    ))
    .otherwise(() => <div></div>);
};
