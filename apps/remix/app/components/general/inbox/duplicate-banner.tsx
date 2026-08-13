import { Trans } from '@lingui/react/macro';
import { CopyIcon } from 'lucide-react';
import { Link } from 'react-router';

/**
 * Says, at the top of the review screen, that this invoice has arrived before —
 * or that copies of it arrived afterwards.
 *
 * Both directions are shown because this screen is where someone decides to send
 * an invoice for signature, and "we already have this" is only useful before that
 * click. The two halves are deliberately weighted differently: a copy is a
 * warning, an original with copies behind it is a note. The original is a real
 * invoice and nothing about it needs stopping.
 */

type DuplicateRef = {
  id: string;
  subject: string | null;
  createdAt: Date | string;
  status?: string;
  senderEmail?: string | null;
  document: { title: string };
};

export type DuplicateBannerProps = {
  duplicateOf: DuplicateRef | null;
  duplicates: DuplicateRef[];
  matchedOn: string | null;
};

const nameOf = (ref: DuplicateRef) => ref.subject || ref.document.title;
const dateOf = (ref: DuplicateRef) => new Date(ref.createdAt).toLocaleString();

/** Statuses meaning the earlier copy has already been acted on, not just received. */
const ACTED_ON = new Set(['SENT_FOR_SIGNATURE', 'COMPLETED']);

export function DuplicateBanner({ duplicateOf, duplicates, matchedOn }: DuplicateBannerProps) {
  if (!duplicateOf && duplicates.length === 0) {
    return null;
  }

  return (
    <>
      {duplicateOf && (
        <div className="rounded-[var(--r)] border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/50">
          <div className="flex items-start gap-2">
            <CopyIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-300" />
            <div className="min-w-0 text-[13px] text-red-900 dark:text-red-200">
              <p className="font-semibold">
                <Trans>You already have this invoice</Trans>
              </p>
              <p className="mt-0.5">
                {/*
                  What matched is stated rather than implied. "Duplicate" alone
                  invites the reader to trust a machine; naming the evidence lets
                  them disagree with it, which they sometimes should — the vendor
                  and total are OCR readings.
                */}
                {matchedOn === 'invoice-number' ? (
                  <Trans>
                    Same vendor, total and invoice number as an earlier item in this queue.
                  </Trans>
                ) : (
                  <Trans>
                    Same vendor, total and invoice date as an earlier item in this queue — no invoice
                    number was extracted from one of them.
                  </Trans>
                )}
              </p>
              <p className="mt-1.5">
                <Link
                  to={`/org/inbox/${duplicateOf.id}`}
                  className="font-medium underline underline-offset-2"
                >
                  {nameOf(duplicateOf)}
                </Link>
                <span className="text-red-800/80 dark:text-red-300/80">
                  {' · '}
                  <Trans>received {dateOf(duplicateOf)}</Trans>
                  {duplicateOf.senderEmail ? ` · ${duplicateOf.senderEmail}` : ''}
                </span>
              </p>
              {duplicateOf.status && ACTED_ON.has(duplicateOf.status) && (
                <p className="mt-1.5 font-semibold">
                  {/* The expensive case: the first copy is already in flight. */}
                  <Trans>
                    That copy has already gone out for signature. Sending this one risks paying the
                    same invoice twice.
                  </Trans>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="rounded-[var(--r)] border border-border bg-muted/30 p-3 text-[13px]">
          <p className="font-medium">
            <Trans>This is the first copy received.</Trans>{' '}
            <span className="text-muted-foreground">
              <Trans>Later copies of the same invoice arrived:</Trans>
            </span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {duplicates.map((copy) => (
              <li key={copy.id} className="text-muted-foreground">
                <Link
                  to={`/org/inbox/${copy.id}`}
                  className="text-foreground underline underline-offset-2"
                >
                  {nameOf(copy)}
                </Link>
                {' · '}
                {dateOf(copy)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
