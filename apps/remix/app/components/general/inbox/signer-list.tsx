import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowRightLeftIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { RecipientEmailAutocomplete } from '@documenso/ui/primitives/recipient-email-autocomplete';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * Who a document is with, and the means to move it.
 *
 * A signing request lands on the wrong person often enough that it needs an
 * answer on the screen where you find out: the invoice was sent to a colleague
 * who has left, is on leave, or has said to send it to their manager instead.
 * The alternative before this was the admin recipient editor, which is not open
 * to the people who work the inbox and which only relabels the row — it leaves
 * the previous signer's link live.
 */

export type Signer = {
  id: number;
  name: string;
  email: string;
  role: string;
  signingStatus: string;
};

export function SignerList({
  inboxItemId,
  documentStatus,
  signers,
}: {
  inboxItemId: string;
  documentStatus: string;
  signers: Signer[];
}) {
  const [reassigning, setReassigning] = useState<Signer | null>(null);

  // Nothing can be moved once the document is finished, one way or the other.
  const canReassign = documentStatus === 'DRAFT' || documentStatus === 'PENDING';

  return (
    <>
      <ul className="space-y-1">
        {signers.map((signer) => {
          const signed = signer.signingStatus === 'SIGNED';

          return (
            <li key={signer.id} className="flex items-start justify-between gap-2 text-[12px]">
              <span className="min-w-0">
                {signer.name || signer.email}{' '}
                <span className="text-muted-foreground">
                  ({signer.email}) · {signer.signingStatus.toLowerCase().replace(/_/g, ' ')}
                </span>
              </span>

              {canReassign && !signed && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="-my-1 h-6 flex-shrink-0 px-1.5 text-[11px]"
                  onClick={() => setReassigning(signer)}
                >
                  <ArrowRightLeftIcon className="mr-1 h-3 w-3" />
                  <Trans>Reassign</Trans>
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {reassigning && (
        <ReassignSignerDialog
          inboxItemId={inboxItemId}
          documentStatus={documentStatus}
          signer={reassigning}
          onClose={() => setReassigning(null)}
        />
      )}
    </>
  );
}

function ReassignSignerDialog({
  inboxItemId,
  documentStatus,
  signer,
  onClose,
}: {
  inboxItemId: string;
  documentStatus: string;
  signer: Signer;
  onClose: () => void;
}) {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // A fresh pair of fields per signer, so reopening the dialog on someone else
  // can't submit the address typed for the previous one.
  useEffect(() => {
    setName('');
    setEmail('');
  }, [signer.id]);

  const reassign = trpc.inbox.reassignRecipient.useMutation({
    onSuccess: (result) => {
      void utils.inbox.get.invalidate({ id: inboxItemId });
      void utils.inbox.timeline.invalidate({ inboxItemId });
      void utils.inbox.list.invalidate();

      toast({
        title: _(msg`Reassigned to ${result.recipient.email}`),
        description: result.emailed
          ? _(msg`They have been emailed the signing request. ${result.previous.email} can no longer open it.`)
          : _(msg`${result.previous.email} can no longer open it. Nothing has been emailed yet.`),
      });

      onClose();
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  const trimmed = email.trim();
  const valid = /\S+@\S+\.\S+/.test(trimmed) && trimmed.toLowerCase() !== signer.email.toLowerCase();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/*
        Nothing is focused on open. The name field is an autocomplete that opens
        its member list on focus, so letting the dialog autofocus it would bury
        the three consequences below under a dropdown the moment it appeared.
      */}
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            <Trans>Reassign this signing request</Trans>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            <Trans>
              Currently with <span className="text-foreground">{signer.name || signer.email}</span> (
              {signer.email}).
            </Trans>
          </p>

          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-muted-foreground">
              <Trans>Send it to</Trans>
            </label>

            {/*
              Both halves search the org directory, matching the send box above —
              a reassignment is usually to a colleague, and typing a non-member
              still works so an external signer isn't locked out.
            */}
            <div className="flex gap-2">
              <RecipientEmailAutocomplete
                field="name"
                className="flex-1"
                // `--input` and `--background` share the same lightness in this
                // theme, so the default border is invisible against a dialog.
                inputClassName="h-9 border-border bg-card text-[13px]"
                placeholder={_(msg`Name`)}
                value={name}
                onChange={setName}
                onSelectMember={(m) => {
                  setName(m.name || m.email);
                  setEmail(m.email);
                }}
              />
              <RecipientEmailAutocomplete
                className="flex-1"
                inputClassName="h-9 border-border bg-card text-[13px]"
                placeholder="email@company.com"
                value={email}
                onChange={setEmail}
                onSelectMember={(m) => {
                  setEmail(m.email);
                  setName((current) => current || m.name || '');
                }}
              />
            </div>
          </div>

          {/*
            Said plainly, because two of these three are irreversible and none of
            them is what "change the email address" sounds like it does.
          */}
          <ul className="list-disc space-y-1 rounded-[var(--r-sm)] bg-muted/40 py-2 pl-7 pr-3 text-[11px] text-muted-foreground">
            <li>
              <Trans>{signer.email}'s signing link stops working immediately.</Trans>
            </li>
            <li>
              <Trans>Anything they had filled in or signed on this document is cleared.</Trans>
            </li>
            <li>
              {documentStatus === 'PENDING' ? (
                <Trans>The new signer is emailed the signing request now.</Trans>
              ) : (
                <Trans>
                  Nothing is emailed — this document has not been sent for signature yet.
                </Trans>
              )}
            </li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={reassign.isPending}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            loading={reassign.isPending}
            disabled={!valid}
            onClick={() =>
              reassign.mutate({
                id: inboxItemId,
                recipientId: signer.id,
                email: trimmed,
                name: name.trim() || undefined,
              })
            }
          >
            <Trans>Reassign</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
