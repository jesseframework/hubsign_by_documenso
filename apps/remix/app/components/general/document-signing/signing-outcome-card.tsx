import { Trans } from '@lingui/react/macro';
import { P, match } from 'ts-pattern';

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
