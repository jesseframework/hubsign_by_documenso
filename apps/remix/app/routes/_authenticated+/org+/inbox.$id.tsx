import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Inbox Document');
}

const looksLikeEmail = (v: unknown): v is string =>
  typeof v === 'string' && /\S+@\S+\.\S+/.test(v);

export default function InboxItemPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const id = params.id ?? '';
  const utils = trpc.useUtils();

  const { data: item, isLoading, error } = trpc.inbox.get.useQuery({ id }, { enabled: !!id });

  const [rows, setRows] = useState<Array<{ name: string; email: string }>>([{ name: '', email: '' }]);
  const [prefilled, setPrefilled] = useState(false);
  const [showOcrText, setShowOcrText] = useState(false);

  // Prefill the first signer's email from OCR data when available.
  useEffect(() => {
    if (prefilled || !item) return;
    const data = (item.extractedData ?? {}) as Record<string, unknown>;
    const email = Object.values(data).find(looksLikeEmail);
    if (email) setRows([{ name: '', email }]);
    setPrefilled(true);
  }, [item, prefilled]);

  const send = trpc.inbox.sendForSignature.useMutation({
    onSuccess: () => {
      void utils.inbox.get.invalidate({ id });
      void utils.inbox.list.invalidate();
      toast({ title: _(msg`Sent for signature`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });
  const reprocess = trpc.inbox.reprocessOcr.useMutation({
    onSuccess: () => {
      void utils.inbox.get.invalidate({ id });
      toast({ title: _(msg`Re-running OCR…`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (error || !item) {
    return <div className="py-12 text-center text-muted-foreground">{error?.message ?? 'Not found'}</div>;
  }

  const extracted = (item.extractedData ?? {}) as Record<string, unknown>;
  const extractedEntries = Object.entries(extracted);
  const alreadySent = item.status === 'SENT_FOR_SIGNATURE' || item.document.status !== 'DRAFT';
  const label = 'block text-[11px] font-medium text-muted-foreground mb-1';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/org/inbox" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-lg font-semibold">{item.document.title}</h2>
            <p className="text-[12px] text-muted-foreground">
              {item.senderEmail ? `From ${item.senderEmail} · ` : ''}
              {item.status.replace(/_/g, ' ').toLowerCase()}
              {item.documentType ? ` · ${item.documentType}` : ''}
            </p>
          </div>
        </div>
        <a href={`/documents/${item.document.id}/edit`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline">
            <ExternalLinkIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Open in editor</Trans>
          </Button>
        </a>
      </div>

      {item.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950 dark:text-red-300">
          {item.error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* OCR extracted data */}
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">
              <Trans>Extracted data (OCR)</Trans>
            </h3>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => reprocess.mutate({ id })}>
              <Trans>Re-run OCR</Trans>
            </Button>
          </div>

          {!item.ocrProcessed ? (
            <p className="text-[12px] text-muted-foreground">
              {item.status === 'OCR_PROCESSING' ? (
                <Trans>OCR is running…</Trans>
              ) : item.status === 'OCR_FAILED' ? (
                <Trans>OCR failed — you can re-run it or proceed manually.</Trans>
              ) : (
                <Trans>No OCR data (engine not configured). You can still send for signature.</Trans>
              )}
            </p>
          ) : extractedEntries.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              <Trans>OCR ran but found no structured fields.</Trans>
            </p>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {extractedEntries.map(([k, v]) => (
                  <tr key={k} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-muted-foreground">{k}</td>
                    <td className="py-1.5 font-medium">{v == null ? '—' : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {item.ocrText && (
            <div className="mt-3">
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                onClick={() => setShowOcrText((s) => !s)}
              >
                {showOcrText ? '− Hide raw OCR text' : '+ Show raw OCR text'}
              </button>
              {showOcrText && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
                  {item.ocrText}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Send for signature */}
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <h3 className="mb-2 text-[14px] font-semibold">
            <Trans>Send for signature</Trans>
          </h3>

          {item.document.recipients.length > 0 && (
            <div className="mb-3">
              <p className={label}>
                <Trans>Existing signers</Trans>
              </p>
              <ul className="space-y-1">
                {item.document.recipients.map((r) => (
                  <li key={r.id} className="text-[12px]">
                    {r.name || r.email}{' '}
                    <span className="text-muted-foreground">
                      ({r.email}) · {r.signingStatus.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alreadySent ? (
            <p className="rounded-md bg-violet-50 px-3 py-2 text-[12px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              <Trans>This document has been sent for signature.</Trans>
            </p>
          ) : (
            <>
              <p className={label}>
                <Trans>Add signer(s)</Trans>
              </p>
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      className="h-8 flex-1 text-[13px]"
                      placeholder="Name"
                      value={row.name}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))
                      }
                    />
                    <Input
                      className="h-8 flex-1 text-[13px]"
                      placeholder="email@company.com"
                      value={row.email}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, email: e.target.value } : r)))
                      }
                    />
                    {rows.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive"
                        onClick={() => setRows((prev) => prev.filter((_r, idx) => idx !== i))}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 text-[11px]"
                onClick={() => setRows((prev) => [...prev, { name: '', email: '' }])}
              >
                <PlusIcon className="mr-1 h-3.5 w-3.5" />
                <Trans>Add another signer</Trans>
              </Button>

              <div className="mt-4">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={send.isPending}
                  onClick={() => {
                    const recipients = rows
                      .filter((r) => /\S+@\S+\.\S+/.test(r.email))
                      .map((r) => ({ name: r.name || undefined, email: r.email.trim() }));
                    if (recipients.length === 0 && item.document.recipients.length === 0) {
                      toast({ title: _(msg`Add at least one signer`), variant: 'destructive' });
                      return;
                    }
                    send.mutate({ id, recipients });
                  }}
                >
                  <SendIcon className="mr-1.5 h-4 w-4" />
                  <Trans>Send for signature</Trans>
                </Button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <Trans>
                    Need to place signature fields precisely? Use "Open in editor" for the full
                    preparation flow.
                  </Trans>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
