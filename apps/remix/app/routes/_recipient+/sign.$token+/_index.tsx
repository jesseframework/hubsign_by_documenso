import { Trans } from '@lingui/react/macro';
import { DocumentSigningOrder, DocumentStatus, RecipientRole, SigningStatus } from '@prisma/client';
import { BanIcon, XCircleIcon } from 'lucide-react';
import { Link, redirect } from 'react-router';
import { getOptionalLoaderContext } from 'server/utils/get-loader-session';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { useOptionalSession } from '@documenso/lib/client-only/providers/session';
import { getDocumentAndSenderByToken } from '@documenso/lib/server-only/document/get-document-by-token';
import { isRecipientAuthorized } from '@documenso/lib/server-only/document/is-recipient-authorized';
import { getVendorSpendMeter } from '@documenso/lib/server-only/document/vendor-spend-meter';
import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';
import { getCompletedFieldsForToken } from '@documenso/lib/server-only/field/get-completed-fields-for-token';
import { getFieldsForToken } from '@documenso/lib/server-only/field/get-fields-for-token';
import { getIsRecipientsTurnToSign } from '@documenso/lib/server-only/recipient/get-is-recipient-turn';
import { getNextPendingRecipient } from '@documenso/lib/server-only/recipient/get-next-pending-recipient';
import { getRecipientByToken } from '@documenso/lib/server-only/recipient/get-recipient-by-token';
import { getRecipientsForAssistant } from '@documenso/lib/server-only/recipient/get-recipients-for-assistant';
import { getStampPlacementsForToken } from '@documenso/lib/server-only/stamps/get-stamp-placements-for-token';
import { getUserByEmail } from '@documenso/lib/server-only/user/get-user-by-email';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import { Button } from '@documenso/ui/primitives/button';

import { DocumentSigningAuthPageView } from '~/components/general/document-signing/document-signing-auth-page';
import { DocumentSigningAuthProvider } from '~/components/general/document-signing/document-signing-auth-provider';
import { DocumentSigningPageView } from '~/components/general/document-signing/document-signing-page-view';
import { DocumentSigningProvider } from '~/components/general/document-signing/document-signing-provider';
import {
  DocumentTitleRow,
  OutcomeCard,
} from '~/components/general/document-signing/signing-outcome-card';
import { superLoaderJson, useSuperLoaderData } from '~/utils/super-json-loader';

import type { Route } from './+types/_index';

export async function loader({ params, request }: Route.LoaderArgs) {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [document, recipient, fields, completedFields] = await Promise.all([
    getDocumentAndSenderByToken({
      token,
      userId: user?.id,
      requireAccessAuth: false,
    }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
    getFieldsForToken({ token }),
    getCompletedFieldsForToken({ token }),
  ]);

  if (
    !document ||
    !document.documentData ||
    !recipient ||
    document.status === DocumentStatus.DRAFT
  ) {
    throw new Response('Not Found', { status: 404 });
  }

  const recipientWithFields = { ...recipient, fields };

  const isRecipientsTurn = await getIsRecipientsTurnToSign({ token });

  if (!isRecipientsTurn) {
    throw redirect(`/sign/${token}/waiting`);
  }

  const allRecipients =
    recipient.role === RecipientRole.ASSISTANT
      ? await getRecipientsForAssistant({
          token,
        })
      : [recipient];

  if (
    document.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL &&
    recipient.role !== RecipientRole.ASSISTANT
  ) {
    const nextPendingRecipient = await getNextPendingRecipient({
      documentId: document.id,
      currentRecipientId: recipient.id,
    });

    if (nextPendingRecipient) {
      allRecipients.push({
        ...nextPendingRecipient,
        fields: [],
      });
    }
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: document.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isDocumentAccessValid = await isRecipientAuthorized({
    type: 'ACCESS',
    documentAuthOptions: document.authOptions,
    recipient,
    userId: user?.id,
  });

  let recipientHasAccount: boolean | null = null;

  if (!isDocumentAccessValid) {
    recipientHasAccount = await getUserByEmail({ email: recipient.email })
      .then((user) => !!user)
      .catch(() => false);

    return superLoaderJson({
      isDocumentAccessValid: false,
      recipientEmail: recipient.email,
      recipientHasAccount,
    } as const);
  }

  await viewedDocument({
    token,
    requestMetadata,
    recipientAccessAuth: derivedRecipientAccessAuth,
  }).catch(() => null);

  const { documentMeta } = document;

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    throw redirect(`/sign/${token}/rejected`);
  }

  if (
    document.status === DocumentStatus.COMPLETED ||
    recipient.signingStatus === SigningStatus.SIGNED
  ) {
    throw redirect(documentMeta?.redirectUrl || `/sign/${token}/complete`);
  }

  const stampPlacements = await getStampPlacementsForToken({ token });

  /**
   * The vendor spend meter, for organization members only.
   *
   * Resolved here rather than fetched by the panel, so it does not exist in the
   * browser at all unless the server decided this viewer may see it. A signing
   * link works for anyone holding the token, and the person signing a vendor's
   * invoice may well work for that vendor — a client-side query gated on the
   * same condition would still have shipped the figures to them.
   *
   * `getVendorSpendMeter` makes the membership check itself; passing the viewer
   * is the whole of this caller's responsibility.
   */
  const spendMeter = document.organizationId
    ? await getVendorSpendMeter({
        organizationId: document.organizationId,
        documentId: document.id,
        viewerUserId: user?.id,
      })
        // A meter that fails to compute must not take down the page someone is
        // trying to sign on.
        .catch(() => null)
    : null;

  return superLoaderJson({
    isDocumentAccessValid: true,
    document,
    fields,
    recipient,
    recipientWithFields,
    allRecipients,
    completedFields,
    isRecipientsTurn,
    stampPlacements,
    spendMeter,
  } as const);
}

export default function SigningPage() {
  const data = useSuperLoaderData<typeof loader>();

  const { sessionData } = useOptionalSession();
  const user = sessionData?.user;

  if (!data.isDocumentAccessValid) {
    return (
      <DocumentSigningAuthPageView
        email={data.recipientEmail}
        emailHasAccount={!!data.recipientHasAccount}
      />
    );
  }

  const {
    document,
    fields,
    recipient,
    completedFields,
    isRecipientsTurn,
    allRecipients,
    recipientWithFields,
    stampPlacements,
    spendMeter,
  } = data;

  if (document.deletedAt || document.status === DocumentStatus.REJECTED) {
    /**
     * Rejected and cancelled are not the same event, and saying so matters.
     *
     * This branch catches both, but the copy only ever described a cancellation
     * — so a signer arriving at a document another signer had DECLINED was told
     * the owner had cancelled it. That sends them to the wrong person to ask
     * about it.
     *
     * The rejector's `rejectionReason` would be better still, but it lives on
     * their recipient row rather than this one and would need another query.
     */
    const wasRejected = document.status === DocumentStatus.REJECTED;

    return (
      <div className="flex w-full flex-col items-center px-4 py-10 sm:py-14">
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <OutcomeCard
            icon={wasRejected ? XCircleIcon : BanIcon}
            tone="bg-destructive/10 text-destructive"
            title={
              wasRejected ? (
                <Trans>Signing was declined</Trans>
              ) : (
                <Trans>No longer available to sign</Trans>
              )
            }
            chip={wasRejected ? <Trans>Declined</Trans> : <Trans>Cancelled</Trans>}
            detail={
              wasRejected ? (
                <Trans>
                  One of the signers declined to sign this document, so it can no longer be
                  completed. The sender can tell you why and start it again if it was a mistake.
                </Trans>
              ) : (
                <Trans>
                  The owner cancelled this document, so it is no longer available to sign.
                </Trans>
              )
            }
          >
            <DocumentTitleRow title={document.title} />

            {user && (
              <Button asChild variant="outline" className="mt-6 w-full">
                <Link to="/documents">
                  <Trans>Back to my documents</Trans>
                </Link>
              </Button>
            )}
          </OutcomeCard>

          {/*
            The upstream version put this promo 9rem below the message, which on
            a short page left it stranded on its own screenful. It belongs with
            the card, and only for someone who has no account to go back to.
          */}
          {!user && (
            <p className="text-muted-foreground text-center text-[12px]">
              <Trans>
                Want to send signing links like this one?{' '}
                <Link to="https://hubsign.io" className="text-primary hover:underline">
                  Take a look at HubSign.
                </Link>
              </Trans>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <DocumentSigningProvider
      email={recipient.email}
      fullName={user?.email === recipient.email ? user?.name : recipient.name}
      signature={user?.email === recipient.email ? user?.signature : undefined}
      typedSignatureEnabled={document.documentMeta?.typedSignatureEnabled}
      uploadSignatureEnabled={document.documentMeta?.uploadSignatureEnabled}
      drawSignatureEnabled={document.documentMeta?.drawSignatureEnabled}
    >
      <DocumentSigningAuthProvider
        documentAuthOptions={document.authOptions}
        recipient={recipient}
        user={user}
      >
        <DocumentSigningPageView
          recipient={recipientWithFields}
          document={document}
          fields={fields}
          completedFields={completedFields}
          isRecipientsTurn={isRecipientsTurn}
          allRecipients={allRecipients}
          stampPlacements={stampPlacements}
          spendMeter={spendMeter}
        />
      </DocumentSigningAuthProvider>
    </DocumentSigningProvider>
  );
}
