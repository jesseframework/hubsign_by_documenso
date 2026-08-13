import { useEffect } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { type Document, DocumentStatus, FieldType, RecipientRole } from '@prisma/client';
import { ArrowLeft, BanIcon, CheckIcon, Clock8, FileSearch } from 'lucide-react';
import { Link, useRevalidator } from 'react-router';
import { match } from 'ts-pattern';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { useOptionalSession } from '@documenso/lib/client-only/providers/session';
import { getDocumentAndSenderByToken } from '@documenso/lib/server-only/document/get-document-by-token';
import { isRecipientAuthorized } from '@documenso/lib/server-only/document/is-recipient-authorized';
import { getFieldsForToken } from '@documenso/lib/server-only/field/get-fields-for-token';
import { getRecipientByToken } from '@documenso/lib/server-only/recipient/get-recipient-by-token';
import { getRecipientSignatures } from '@documenso/lib/server-only/recipient/get-recipient-signatures';
import { getUserByEmail } from '@documenso/lib/server-only/user/get-user-by-email';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { env } from '@documenso/lib/utils/env';
import DocumentDialog from '@documenso/ui/components/document/document-dialog';
import { DocumentDownloadButton } from '@documenso/ui/components/document/document-download-button';
import { Button } from '@documenso/ui/primitives/button';

import { ClaimAccount } from '~/components/general/claim-account';
import { DocumentSigningAuthPageView } from '~/components/general/document-signing/document-signing-auth-page';
import {
  DocumentTitleRow,
  OutcomeCard,
  SignaturePanel,
} from '~/components/general/document-signing/signing-outcome-card';

import type { Route } from './+types/complete';

export async function loader({ params, request }: Route.LoaderArgs) {
  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const document = await getDocumentAndSenderByToken({
    token,
    requireAccessAuth: false,
  }).catch(() => null);

  if (!document || !document.documentData) {
    throw new Response('Not Found', { status: 404 });
  }

  const [fields, recipient] = await Promise.all([
    getFieldsForToken({ token }),
    getRecipientByToken({ token }).catch(() => null),
  ]);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const isDocumentAccessValid = await isRecipientAuthorized({
    type: 'ACCESS',
    documentAuthOptions: document.authOptions,
    recipient,
    userId: user?.id,
  });

  if (!isDocumentAccessValid) {
    return {
      isDocumentAccessValid: false,
      recipientEmail: recipient.email,
    } as const;
  }

  const signatures = await getRecipientSignatures({ recipientId: recipient.id });
  const isExistingUser = await getUserByEmail({ email: recipient.email })
    .then((u) => !!u)
    .catch(() => false);

  const recipientName =
    recipient.name ||
    fields.find((field) => field.type === FieldType.NAME)?.customText ||
    recipient.email;

  const canSignUp = !isExistingUser && env('NEXT_PUBLIC_DISABLE_SIGNUP') !== 'true';

  return {
    isDocumentAccessValid: true,
    canSignUp,
    // Distinguishes "no sign-up panel because they already have an account"
    // from "no sign-up panel because sign-up is switched off" — the page offers
    // a different next step for each.
    isExistingUser,
    recipientName,
    recipientEmail: recipient.email,
    signatures,
    document,
    recipient,
  };
}

export default function CompletedSigningPage({ loaderData }: Route.ComponentProps) {
  const { _ } = useLingui();

  const { sessionData } = useOptionalSession();
  const user = sessionData?.user;

  const {
    isDocumentAccessValid,
    canSignUp,
    isExistingUser,
    recipientName,
    signatures,
    document,
    recipient,
    recipientEmail,
  } = loaderData;

  if (!isDocumentAccessValid) {
    return <DocumentSigningAuthPageView email={recipientEmail} />;
  }

  /**
   * One description of the outcome, rather than the same `match` written twice.
   *
   * The icon, the chip and the explanation all answer the same question, and
   * when they were three separate branches it was possible to change the wording
   * in one and leave the others saying something different.
   */
  const outcome = match({ status: document.status, deletedAt: document.deletedAt })
    .with({ status: DocumentStatus.COMPLETED }, () => ({
      icon: CheckIcon,
      tone: 'bg-status-complete-bg text-status-complete-text',
      label: <Trans>Everyone has signed</Trans>,
      detail: <Trans>A copy of the signed document is on its way to your inbox.</Trans>,
    }))
    .with({ deletedAt: null }, () => ({
      icon: Clock8,
      tone: 'bg-status-pending-bg text-status-pending-text',
      label: <Trans>Waiting for others to sign</Trans>,
      detail: (
        <Trans>
          You are done. We will email you a copy of the signed document once everyone else has
          signed.
        </Trans>
      ),
    }))
    .otherwise(() => ({
      icon: BanIcon,
      tone: 'bg-destructive/10 text-destructive',
      label: <Trans>No longer available to sign</Trans>,
      detail: (
        <Trans>The owner cancelled this document, so it is no longer available to others.</Trans>
      ),
    }));

  return (
    <div className="flex w-full flex-col items-center px-4 py-10 sm:py-14">
      {/*
        One centred column, stacked — not two side by side.

        Side by side only balances when the second panel is the tall sign-up
        form. For a signer who already has an account it is a three-line card,
        which left a card-sized hole beside a much taller one. Stacking is right
        in every case and needs no breakpoint to hold it together.
      */}
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        {/*
          The confirmation itself, as one card.

          Previously this was a loose stack — floating badge, 3D card, oversized
          heading, status line, paragraph — centred on an empty page with up to
          11rem of top padding. Grouping it states what the page is actually
          saying: this document, this signature, this outcome, and the one action
          that follows from it.
        */}
        <OutcomeCard
          icon={outcome.icon}
          tone={outcome.tone}
          chip={outcome.label}
          detail={outcome.detail}
          title={
            <>
              {recipient.role === RecipientRole.SIGNER && <Trans>Document signed</Trans>}
              {recipient.role === RecipientRole.VIEWER && <Trans>Document viewed</Trans>}
              {recipient.role === RecipientRole.APPROVER && <Trans>Document approved</Trans>}
            </>
          }
        >
          <DocumentTitleRow title={document.title} />

          <div className="mt-3">
            <SignaturePanel name={recipientName} signature={signatures.at(0)} />
          </div>

          <div className="mt-6">
            {isDocumentCompleted(document.status) ? (
              <DocumentDownloadButton
                // `w-full` alone only widens the wrapper: the split variant is an
                // inline-flex of button + dropdown, so the button keeps its own
                // width and sits left of a full-width box. The child rule makes it
                // take the space, leaving the chevron at the right edge.
                className="w-full [&>button:first-child]:flex-1"
                // Downloading the signed copy is why most people are on this
                // page; an outline button on a white card does not say so.
                variant="default"
                fileName={document.title}
                documentData={document.documentData}
                certificatePageCount={document.certificatePageCount}
                disabled={!isDocumentCompleted(document.status)}
              />
            ) : (
              <DocumentDialog
                documentData={document.documentData}
                trigger={
                  <Button
                    className="w-full"
                    variant="outline"
                    title={_(msg`Signatures will appear once the document has been completed`)}
                  >
                    <FileSearch className="mr-2 h-4 w-4" strokeWidth={1.7} />
                    <Trans>View original document</Trans>
                  </Button>
                }
              />
            )}
          </div>
        </OutcomeCard>

        <div className="flex w-full flex-col items-center">
          {/*
            A signer who already has an account gets no sign-up panel
            (`canSignUp` is false for them), so without this there is nothing
            here at all and no way onward.

            The other case this used to cover — no account, sign-up switched off
            — had only a line saying a copy would be emailed. The outcome card
            now says that itself, so repeating it two inches lower added nothing.
          */}
          {!canSignUp && !user && isExistingUser && (
            <div className="w-full rounded-[var(--r-lg)] border border-border bg-card p-6 text-center">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <Trans>
                  You already have a HubSign account. Sign in to keep this document and your
                  signature with the rest of your records.
                </Trans>
              </p>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link to={`/signin?email=${encodeURIComponent(recipient.email)}`}>
                  <Trans>Sign in to save your signature</Trans>
                </Link>
              </Button>
            </div>
          )}

          {canSignUp && (
            <div className="w-full rounded-[var(--r-lg)] border border-border bg-card p-6 sm:p-8">
              <h2 className="text-center text-lg font-semibold tracking-tight">
                <Trans>Need to sign documents?</Trans>
              </h2>

              <p className="mt-2 text-center text-[13px] leading-relaxed text-muted-foreground">
                <Trans>Create a free HubSign account and keep your signed documents together.</Trans>
              </p>

              <ClaimAccount defaultName={recipientName} defaultEmail={recipient.email} />
            </div>
          )}

          {user && (
            <Button asChild variant="ghost" className="text-[13px] text-muted-foreground">
              <Link to="/documents">
                <ArrowLeft className="mr-2 h-4 w-4" />
                <Trans>Back to my documents</Trans>
              </Link>
            </Button>
          )}
        </div>
      </div>

      <PollUntilDocumentCompleted document={document} />
    </div>
  );
}

export type PollUntilDocumentCompletedProps = {
  document: Pick<Document, 'id' | 'status' | 'deletedAt'>;
};

export const PollUntilDocumentCompleted = ({ document }: PollUntilDocumentCompletedProps) => {
  const { revalidate } = useRevalidator();

  useEffect(() => {
    if (isDocumentCompleted(document.status)) {
      return;
    }

    const interval = setInterval(() => {
      if (window.document.hasFocus()) {
        void revalidate();
      }
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.status]);

  return <></>;
};
