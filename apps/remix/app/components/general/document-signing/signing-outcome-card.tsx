import type { ReactNode } from 'react';

import { Trans } from '@lingui/react/macro';
import { FileTextIcon, type LucideIcon } from 'lucide-react';
import { P, match } from 'ts-pattern';

/**
 * The card every end-of-signing screen is built from.
 *
 * There are three of these screens — signed, cancelled/rejected, and the
 * embedded completion view — and before this they were three separate stacks of
 * markup that happened to look similar. They had drifted: different headings for
 * the same event, a status line the size of a heading on one and small text on
 * another, and a 9rem gap before the footer on one of them. One shell means a
 * change to the shape of the answer lands on all three.
 *
 * `tone` is a pair of background/text classes from the status palette, applied to
 * both the icon badge and the chip so they always agree.
 */
export const OutcomeCard = ({
  icon: Icon,
  tone,
  title,
  chip,
  detail,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  title: ReactNode;
  chip?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) => (
  <div className="w-full rounded-[var(--r-lg)] border border-border bg-card p-6 sm:p-8">
    <div className="flex flex-col items-center text-center">
      <span className={`flex h-11 w-11 items-center justify-center rounded-full ${tone}`}>
        <Icon className="h-5 w-5" strokeWidth={2.5} />
      </span>

      <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {title}
      </h1>

      {chip && (
        <span className={`mt-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
          {chip}
        </span>
      )}

      {detail && (
        <p className="mt-3 max-w-[42ch] text-[13px] leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
    </div>

    {children}
  </div>
);

/**
 * Which document this is about, named rather than left as a bare floating chip.
 *
 * `title` is on the element too: these are filenames, they are frequently longer
 * than the card, and truncating without a way to read the whole thing is how you
 * end up unable to tell two documents apart.
 */
export const DocumentTitleRow = ({ title }: { title: string }) => (
  <div className="mt-6 flex items-center gap-2.5 rounded-[var(--r)] bg-muted/50 px-3 py-2.5">
    <FileTextIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={title}>
      {title}
    </span>
  </div>
);

/**
 * The signature itself, shown flat on a clean surface.
 *
 * Replaces the mouse-tracking 3D card with its sheen and green celebration
 * glow. That treatment came from the upstream project's palette and read as
 * decoration on a page whose job is to confirm a legal act — and the parallax
 * only ever worked with a mouse, so on the phone most signers use it was an
 * effect nobody saw.
 *
 * The three cases are the same ones the signature model allows: a drawn image,
 * a typed name, or neither.
 */
export const SignaturePanel = ({
  name,
  signature,
}: {
  name: string;
  signature?: { signatureImageAsBase64?: string | null; typedSignature?: string | null } | null;
}) => (
  <div className="rounded-[var(--r)] border border-border bg-background px-4 py-6">
    <div className="flex h-24 items-center justify-center">
      {match(signature)
        .with({ signatureImageAsBase64: P.string }, (s) => (
          <img
            src={s.signatureImageAsBase64}
            alt=""
            className="max-h-24 max-w-full object-contain dark:invert"
          />
        ))
        .with({ typedSignature: P.string }, (s) => (
          <span className="font-signature break-all text-center text-3xl text-foreground sm:text-4xl">
            {s.typedSignature}
          </span>
        ))
        .otherwise(() => (
          <span className="font-signature break-all text-center text-3xl text-foreground sm:text-4xl">
            {name}
          </span>
        ))}
    </div>

    <p className="mt-4 border-t border-border pt-3 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
      <Trans>Signed by</Trans> <span className="font-medium text-foreground">{name}</span>
    </p>
  </div>
);
