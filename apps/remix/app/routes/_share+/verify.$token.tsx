import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { DocumentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { redirect } from 'react-router';

import { APP_I18N_OPTIONS } from '@documenso/lib/constants/i18n';
import { prisma } from '@documenso/prisma';
import { Card, CardContent } from '@documenso/ui/primitives/card';

import type { Route } from './+types/verify.$token';

export function meta() {
  return [{ title: 'HubSign — Document verification' }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const { token } = params;

  if (!token) {
    throw redirect('/');
  }

  // Public lookup: only the qrToken is exposed via the audit certificate.
  // Return a deliberately narrow projection — no signature images, no field
  // contents, no message bodies. The verify page is for proof-of-signature
  // only, never for content disclosure.
  const document = await prisma.document.findFirst({
    where: { qrToken: token },
    select: {
      title: true,
      status: true,
      createdAt: true,
      completedAt: true,
      signatureHash: true,
      user: { select: { name: true, email: true } },
      recipients: {
        select: {
          name: true,
          email: true,
          role: true,
          signingStatus: true,
          signedAt: true,
        },
      },
    },
  });

  return { document };
}

export default function VerifyDocument({ loaderData }: Route.ComponentProps) {
  const { document } = loaderData;
  useLingui();

  // Token didn't match — generic "not found" so we don't leak whether the
  // token has ever existed.
  if (!document) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <ShieldAlert className="text-muted-foreground mx-auto h-16 w-16" />
        <h1 className="mt-4 text-2xl font-semibold">
          <Trans>Document not found</Trans>
        </h1>
        <p className="text-muted-foreground mt-2">
          <Trans>
            We couldn't find a verifiable document for that link. Double-check the URL or scan the
            QR code from the audit certificate again.
          </Trans>
        </p>
      </div>
    );
  }

  const isVerified = document.status === DocumentStatus.COMPLETED;
  const isRejected = document.status === DocumentStatus.REJECTED;
  const fmt = (d: Date | null | undefined) =>
    d
      ? DateTime.fromJSDate(d)
          .setLocale(APP_I18N_OPTIONS.defaultLocale)
          .toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')
      : '—';

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Verdict header */}
      <div className="text-center">
        {isVerified ? (
          <>
            <div className="bg-green-50 mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-green-700">
              <Trans>Verified</Trans>
            </h1>
            <p className="text-muted-foreground mt-2">
              <Trans>This document was signed on HubSign and has not been tampered with.</Trans>
            </p>
          </>
        ) : isRejected ? (
          <>
            <div className="bg-red-50 mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full">
              <XCircle className="h-12 w-12 text-red-600" />
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-red-700">
              <Trans>Rejected</Trans>
            </h1>
            <p className="text-muted-foreground mt-2">
              <Trans>This document was rejected by a signer and is not a completed agreement.</Trans>
            </p>
          </>
        ) : (
          <>
            <div className="bg-yellow-50 mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full">
              <ShieldAlert className="h-12 w-12 text-yellow-600" />
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-yellow-700">
              <Trans>In progress</Trans>
            </h1>
            <p className="text-muted-foreground mt-2">
              <Trans>This document has not yet been completed by all signers.</Trans>
            </p>
          </>
        )}
      </div>

      {/* Document summary */}
      <Card className="mt-8">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold">{document.title}</h2>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                <Trans>Created by</Trans>
              </dt>
              <dd className="text-right">
                {document.user.name
                  ? `${document.user.name} (${document.user.email})`
                  : document.user.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                <Trans>Created at</Trans>
              </dt>
              <dd className="text-right">{fmt(document.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                <Trans>Completed at</Trans>
              </dt>
              <dd className="text-right">{fmt(document.completedAt)}</dd>
            </div>
          </dl>

          {/* Signature hash — the actual proof. Anyone can recompute SHA-256
              of their downloaded copy and match it against this. */}
          {document.signatureHash && (
            <div className="mt-6 border-t pt-4">
              <div className="flex items-start gap-2">
                <ShieldCheck className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <Trans>Document fingerprint (SHA-256)</Trans>
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    <Trans>
                      Recompute this hash from your downloaded copy with
                      <span className="font-mono"> shasum -a 256 file.pdf </span>
                      to confirm the file is unchanged.
                    </Trans>
                  </p>
                  <p className="mt-2 break-all font-mono text-xs">{document.signatureHash}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signers — names + emails + status only. No signature images, no
          field contents, no document content. */}
      <Card className="mt-6">
        <CardContent className="p-6">
          <h3 className="text-sm font-medium">
            <Trans>Signers</Trans>
          </h3>
          <ul className="mt-4 space-y-3">
            {document.recipients.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.name || r.email}</p>
                  {r.name && <p className="text-muted-foreground text-xs">{r.email}</p>}
                  <p className="text-muted-foreground mt-1 text-xs uppercase tracking-wide">
                    {r.role}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p
                    className={
                      r.signingStatus === 'SIGNED'
                        ? 'text-green-600'
                        : r.signingStatus === 'REJECTED'
                          ? 'text-red-600'
                          : 'text-muted-foreground'
                    }
                  >
                    {r.signingStatus}
                  </p>
                  <p className="text-muted-foreground mt-0.5">{fmt(r.signedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        <Trans>
          This is a public verification page. It does not show the document contents or signatures.
        </Trans>
      </p>
    </div>
  );
}
