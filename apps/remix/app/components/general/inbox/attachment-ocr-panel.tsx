import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon, PaperclipIcon, ScanLineIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * Attachments the signer sent, and the ability to read one with OCR.
 *
 * Reading is a button rather than something the upload triggers. Supporting
 * files arrive from whoever holds a signing token — no account behind them — so
 * forwarding those bytes to an external extraction service is a decision
 * somebody in the organization makes on purpose.
 */

type SupportingFile = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date | string;
  ocrRanAt: Date | string | null;
  ocrError: string | null;
  ocrDocumentType: string | null;
  extractedData: unknown;
  ocrRanBy: { name: string | null; email: string } | null;
  recipient: { name: string; email: string } | null;
};

const READABLE = /\.(pdf|png|jpe?g|tiff?)$/i;

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The handful of fields worth showing inline once an attachment is read. */
const HIGHLIGHT = ['po_number', 'purchase_order', 'order_number', 'vendor_name', 'merchant_name', 'total_amount', 'total'];

export function AttachmentOcrPanel({
  inboxItemId,
  files,
}: {
  inboxItemId: string;
  files: SupportingFile[];
}) {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const read = trpc.inbox.readAttachment.useMutation({
    onSuccess: async (result) => {
      await utils.inbox.get.invalidate({ id: inboxItemId });
      await utils.inbox.timeline.invalidate({ inboxItemId });

      if (!result.ok) {
        toast({
          title: _(msg`Could not read the attachment`),
          description: result.error ?? undefined,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: _(msg`Attachment read`),
        description:
          result.fieldCount > 0
            ? _(msg`${result.fieldCount} field(s) extracted from ${result.fileName}.`)
            : _(msg`No fields could be extracted from ${result.fileName}.`),
      });
    },
    onError: (e) =>
      toast({ title: _(msg`Could not read the attachment`), description: e.message, variant: 'destructive' }),
  });

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[var(--r)] border border-border bg-card p-4">
      <h3 className="mb-1 text-[14px] font-semibold">
        <Trans>Attachments from the signer</Trans>
      </h3>
      <p className="mb-3 text-[11px] text-muted-foreground">
        <Trans>
          Read a purchase order here to make its fields available to business rules. Sent by
          whoever signed, so nothing is read automatically.
        </Trans>
      </p>

      <div className="space-y-2">
        {files.map((file) => {
          const extracted =
            file.extractedData && typeof file.extractedData === 'object' && !Array.isArray(file.extractedData)
              ? (file.extractedData as Record<string, unknown>)
              : {};
          const highlights = HIGHLIGHT.filter(
            (key) => extracted[key] !== undefined && extracted[key] !== null && String(extracted[key]) !== '',
          );
          const readable = READABLE.test(file.fileName);
          const isPending = read.isPending && read.variables?.supportingFileId === file.id;

          /*
            Mirrors the rule provider's own check: a total below its own subtotal
            cannot be a real total, because tax and charges only add. Shown here
            because the figure is displayed either way, and an org reading
            "Total Amount 28.95" off this panel has no other way to know the
            amount comparison was withheld rather than passed.
          */
          const num = (value: unknown) => {
            const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
            if (!/\d/.test(cleaned)) return null;
            const parsed = Number(cleaned);

            return Number.isFinite(parsed) ? parsed : null;
          };
          const totalRead = num(extracted.total_amount ?? extracted.total);
          const subtotalRead = num(extracted.subtotal ?? extracted.sub_total);
          const totalUnreliable =
            totalRead !== null && subtotalRead !== null && totalRead < subtotalRead;

          return (
            <div key={file.id} className="rounded-[var(--r-sm)] border border-border bg-muted/20 p-2.5">
              <div className="flex items-start gap-2">
                <PaperclipIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{file.fileName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {kb(file.sizeBytes)}
                    {file.recipient && (
                      <>
                        {' · '}
                        <Trans>from {file.recipient.name || file.recipient.email}</Trans>
                      </>
                    )}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-shrink-0 text-[11px]"
                  disabled={!readable || isPending}
                  title={
                    readable
                      ? undefined
                      : _(msg`OCR can only read PDF and image attachments.`)
                  }
                  onClick={() => read.mutate({ supportingFileId: file.id })}
                >
                  <ScanLineIcon className={`mr-1 h-3.5 w-3.5 ${isPending ? 'animate-pulse' : ''}`} />
                  {file.ocrRanAt ? <Trans>Read again</Trans> : <Trans>Read with OCR</Trans>}
                </Button>
              </div>

              {file.ocrError && (
                <p className="mt-1.5 flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400">
                  <AlertTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  {file.ocrError}
                </p>
              )}

              {file.ocrRanAt && !file.ocrError && (
                <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5">
                  <p className="text-[10px] text-muted-foreground">
                    <Trans>
                      Read {new Date(file.ocrRanAt).toLocaleString()} by{' '}
                      {file.ocrRanBy?.name || file.ocrRanBy?.email || 'a user'}
                    </Trans>
                    {file.ocrDocumentType && (
                      <>
                        {' · '}
                        <Trans>classified as {file.ocrDocumentType}</Trans>
                      </>
                    )}
                  </p>

                  {highlights.length > 0 ? (
                    <dl className="space-y-0.5">
                      {highlights.map((key) => (
                        <div key={key} className="flex items-baseline gap-2 text-[11px]">
                          <dt className="min-w-[86px] capitalize text-muted-foreground">
                            {key.replace(/_/g, ' ')}
                          </dt>
                          <dd className="font-medium">{String(extracted[key])}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      <Trans>No purchase-order fields were found in this attachment.</Trans>
                    </p>
                  )}

                  {totalUnreliable && (
                    <p className="mt-1 flex items-start gap-1 rounded-[var(--r-sm)] bg-status-pending-bg p-1.5 text-[10px] text-status-pending-text">
                      <AlertTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>
                        <Trans>
                          The total read ({String(totalRead)}) is less than the subtotal (
                          {String(subtotalRead)}), which no real document can be — the extractor has
                          most likely picked up a line-item price. The amount comparison was skipped
                          for this attachment, so an amount rule did not check it. The PO number is
                          unaffected.
                        </Trans>
                      </span>
                    </p>
                  )}

                  <p className="pt-0.5 text-[10px] text-muted-foreground/80">
                    <Trans>
                      Available to rules as attachedPo.po_number, attachedPo.vendor_name and
                      attachedPo.total_amount.
                    </Trans>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
