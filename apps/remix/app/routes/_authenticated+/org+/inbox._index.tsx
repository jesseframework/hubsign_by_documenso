import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArchiveIcon, InboxIcon, RefreshCwIcon, ScanLineIcon } from 'lucide-react';
import { Link } from 'react-router';

import { INBOUND_EMAIL_DOMAIN } from '@documenso/lib/constants/app';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Signature Inbox');
}

const ocrBadge = (status: string): string => {
  switch (status) {
    case 'OCR_PROCESSING':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'OCR_FAILED':
      return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'READY':
    case 'OCR_COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'SENT_FOR_SIGNATURE':
      return 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300';
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'ARCHIVED':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  }
};

export default function SignatureInboxPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: items, isLoading } = trpc.inbox.list.useQuery({ limit: 100 });
  const { data: membership } = trpc.org.getMyOrganization.useQuery();
  const org = membership?.organization;
  const inboxAddress =
    org?.inboxEmail || (org?.slug ? `${org.slug}@${INBOUND_EMAIL_DOMAIN()}` : null);

  const reprocess = trpc.inbox.reprocessOcr.useMutation({
    onSuccess: () => {
      void utils.inbox.list.invalidate();
      toast({ title: _(msg`Re-running OCR…`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });
  const archive = trpc.inbox.archive.useMutation({
    onSuccess: () => void utils.inbox.list.invalidate(),
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  const fetchNow = trpc.inbox.fetchNow.useMutation({
    onSuccess: (r) => {
      void utils.inbox.list.invalidate();
      toast({
        title: r.configured
          ? _(msg`Imported ${r.imported}, skipped ${r.skipped}`)
          : _(msg`WorkHub inbox not configured`),
      });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Signature Inbox</Trans>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Documents emailed in for signature. Each is read by OCR (BMS ML) so you can review the
              data, then send it off to sign.
            </Trans>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0"
          disabled={fetchNow.isPending}
          onClick={() => fetchNow.mutate()}
        >
          <RefreshCwIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>Fetch from WorkHub</Trans>
        </Button>
      </div>

      {inboxAddress && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r)] border border-border bg-muted/30 px-4 py-3 text-[12px]">
          <span className="text-muted-foreground">
            <Trans>Email PDFs to your organization's inbox:</Trans>
          </span>
          <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[12px] font-medium">
            {inboxAddress}
          </code>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => {
              void navigator.clipboard?.writeText(inboxAddress);
              toast({ title: _(msg`Copied`) });
            }}
          >
            <Trans>Copy</Trans>
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <InboxIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>Your inbox is empty</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
            <Trans>
              Email a PDF to your org's inbox alias to see it here. Enable email-to-sign and OCR in
              Organization settings.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Document</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>From</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>OCR</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Status</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Actions</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to={`/org/inbox/${item.id}`}
                      className="text-[13px] font-medium hover:text-primary hover:underline"
                    >
                      {item.document.title}
                    </Link>
                    {item.documentType && (
                      <p className="text-[11px] text-muted-foreground">{item.documentType}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {item.senderEmail ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${ocrBadge(item.status)}`}>
                        {item.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      {item.ocrProcessed && item.ocrConfidence != null && (
                        <span className="text-[11px] text-muted-foreground">
                          {Math.round(item.ocrConfidence * 100)}%
                        </span>
                      )}
                      {item.needsReview && (
                        <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          review
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] text-muted-foreground">
                      {item.document.status.toLowerCase()} · {item.document._count.recipients}{' '}
                      {item.document._count.recipients === 1 ? 'signer' : 'signers'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link to={`/org/inbox/${item.id}`}>
                        <Button size="sm" className="h-7 text-[11px]">
                          <ScanLineIcon className="mr-1 h-3.5 w-3.5" />
                          <Trans>Review</Trans>
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        title={_(msg`Re-run OCR`)}
                        disabled={reprocess.isPending}
                        onClick={() => reprocess.mutate({ id: item.id })}
                      >
                        <RefreshCwIcon className="h-3.5 w-3.5" />
                      </Button>
                      {item.status !== 'ARCHIVED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px] text-muted-foreground"
                          title={_(msg`Archive`)}
                          onClick={() => archive.mutate({ id: item.id })}
                        >
                          <ArchiveIcon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
