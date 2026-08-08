import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import type { Document, Recipient, Team, User } from '@prisma/client';
import { DocumentStatus, RecipientRole, SigningStatus } from '@prisma/client';
import { CheckCircle, ChevronDown, Download, EyeIcon, FileText, Pencil } from 'lucide-react';
import { Link } from 'react-router';
import { match } from 'ts-pattern';

import { downloadPDF } from '@documenso/lib/client-only/download-pdf';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { trpc as trpcClient } from '@documenso/trpc/client';
import { Button } from '@documenso/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type DocumentPageViewButtonProps = {
  document: Document & {
    user: Pick<User, 'id' | 'name' | 'email'>;
    recipients: Recipient[];
    team: Pick<Team, 'id' | 'url'> | null;
  };
};

export const DocumentPageViewButton = ({ document }: DocumentPageViewButtonProps) => {
  const { user } = useSession();

  const { toast } = useToast();
  const { _ } = useLingui();

  const recipient = document.recipients.find((recipient) => recipient.email === user.email);

  const isRecipient = !!recipient;
  const isPending = document.status === DocumentStatus.PENDING;
  const isComplete = isDocumentCompleted(document);
  const isSigned = recipient?.signingStatus === SigningStatus.SIGNED;
  const role = recipient?.role;

  // Trailing pages of the sealed PDF that are the audit certificate. 0 for
  // documents sealed before this was recorded, and for orgs that turned the
  // certificate off — either way there is nothing to strip.
  const certificatePageCount = document.certificatePageCount ?? 0;

  const documentsPath = formatDocumentsPath(document.team?.url);
  const formatPath = document.folderId
    ? `${documentsPath}/f/${document.folderId}/${document.id}/edit`
    : `${documentsPath}/${document.id}/edit`;

  /**
   * @param stripTrailingPages Pages to slice off the end — the audit certificate.
   */
  const onDownloadClick = async (stripTrailingPages = 0) => {
    try {
      const documentWithData = await trpcClient.document.getDocumentById.query(
        {
          documentId: document.id,
        },
        {
          context: {
            teamId: document.team?.id?.toString(),
          },
        },
      );

      const documentData = documentWithData?.documentData;

      if (!documentData) {
        throw new Error('No document available');
      }

      await downloadPDF({ documentData, fileName: documentWithData.title, stripTrailingPages });
    } catch (err) {
      toast({
        title: _(msg`Something went wrong`),
        description: _(msg`An error occurred while downloading your document.`),
        variant: 'destructive',
      });
    }
  };

  return match({
    isRecipient,
    isPending,
    isComplete,
    isSigned,
  })
    .with({ isRecipient: true, isPending: true, isSigned: false }, () => (
      <Button className="w-full" asChild>
        <Link to={`/sign/${recipient?.token}`}>
          {match(role)
            .with(RecipientRole.SIGNER, () => (
              <>
                <Pencil className="-ml-1 mr-2 h-4 w-4" />
                <Trans>Sign</Trans>
              </>
            ))
            .with(RecipientRole.APPROVER, () => (
              <>
                <CheckCircle className="-ml-1 mr-2 h-4 w-4" />
                <Trans>Approve</Trans>
              </>
            ))
            .otherwise(() => (
              <>
                <EyeIcon className="-ml-1 mr-2 h-4 w-4" />
                <Trans>View</Trans>
              </>
            ))}
        </Link>
      </Button>
    ))
    .with({ isComplete: false }, () => (
      <Button className="w-full" asChild>
        <Link to={formatPath}>
          <Trans>Edit</Trans>
        </Link>
      </Button>
    ))
    .with({ isComplete: true }, () => {
      // Nothing to opt out of when the sealed PDF has no certificate pages, so
      // keep the plain single button rather than showing an empty choice.
      if (certificatePageCount === 0) {
        return (
          <Button className="w-full" onClick={() => void onDownloadClick()}>
            <Download className="-ml-1 mr-2 inline h-4 w-4" />
            <Trans>Download</Trans>
          </Button>
        );
      }

      // Split button: the main action keeps the historical behaviour (full PDF,
      // certificate included) so the common path is unchanged and one click; the
      // chevron offers the signed pages on their own for internal circulation.
      return (
        <div className="flex w-full">
          <Button className="flex-1 rounded-r-none" onClick={() => void onDownloadClick()}>
            <Download className="-ml-1 mr-2 inline h-4 w-4" />
            <Trans>Download</Trans>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="rounded-l-none border-l border-l-white/20 px-2"
                aria-label={_(msg`Download options`)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => void onDownloadClick()}>
                <Download className="mr-2 h-4 w-4 flex-shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm">
                    <Trans>Download with audit certificate</Trans>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <Trans>The full signed record</Trans>
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => void onDownloadClick(certificatePageCount)}>
                <FileText className="mr-2 h-4 w-4 flex-shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm">
                    <Trans>Download without audit certificate</Trans>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <Trans>Signed pages only, for internal use</Trans>
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    })
    .otherwise(() => null);
};
