import { Trans } from '@lingui/react/macro';
import type { Signature } from '@prisma/client';
import { CheckIcon } from 'lucide-react';

import { OutcomeCard, SignaturePanel } from '../general/document-signing/signing-outcome-card';

export type EmbedDocumentCompletedPageProps = {
  name?: string;
  signature?: Signature;
};

/**
 * Shown inside the host application's iframe once signing is done.
 *
 * Same card as the standalone completion screen, so a signer who sees one and
 * then the other is not looking at two different products. What it deliberately
 * does NOT carry is a download button or any link out: this is embedded, the
 * parent application owns what happens next, and a link here would navigate
 * inside somebody else's frame.
 */
export const EmbedDocumentCompleted = ({ name, signature }: EmbedDocumentCompletedPageProps) => {
  return (
    <div className="embed--DocumentCompleted flex min-h-[100dvh] flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <OutcomeCard
          icon={CheckIcon}
          tone="bg-status-complete-bg text-status-complete-text"
          title={<Trans>Document completed</Trans>}
          chip={<Trans>Everyone has signed</Trans>}
          detail={
            <Trans>
              This document is complete. Follow any instructions shown in the application you
              started from.
            </Trans>
          }
        >
          <div className="mt-6">
            <SignaturePanel name={name || 'HubSign'} signature={signature} />
          </div>
        </OutcomeCard>
      </div>
    </div>
  );
};
