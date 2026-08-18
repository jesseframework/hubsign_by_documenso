import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { RecipientEmailAutocomplete } from '@documenso/ui/primitives/recipient-email-autocomplete';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { AttachmentOcrPanel } from '~/components/general/inbox/attachment-ocr-panel';
import {
  DocumentTimeline,
  SigningStatusBanner,
} from '~/components/general/inbox/document-timeline';
import { DuplicateBanner } from '~/components/general/inbox/duplicate-banner';
import { ExtractedFields } from '~/components/general/inbox/extracted-fields';
import { SignerList } from '~/components/general/inbox/signer-list';
import { useInboxEvents } from '~/hooks/use-inbox-events';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Inbox Document');
}

const looksLikeEmail = (v: unknown): v is string =>
  typeof v === 'string' && /\S+@\S+\.\S+/.test(v);

/** A single field the ML extracted — shape mirrors BMS ML `field_extractions`. */
type FieldExtraction = {
  field_name: string;
  extracted_value: unknown;
  confidence_score: number;
  field_type?: string;
  extraction_method?: string;
  template_name?: string;
  ai_fallback_used?: boolean;
  requires_review?: boolean;
};

const pct = (c: number) => Math.round((c <= 1 ? c * 100 : c));

export default function InboxItemPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const id = params.id ?? '';
  const utils = trpc.useUtils();

  const { data: item, isLoading, error } = trpc.inbox.get.useQuery({ id }, { enabled: !!id });

  // Live-refresh this item (and the list) when its OCR finishes (SSE).
  useInboxEvents(id);

  // `get` marks the item read as a side effect — invalidate the list/unread
  // count so they don't keep showing it as unread from a stale cache once
  // the user navigates back.
  useEffect(() => {
    if (!item) return;
    void utils.inbox.list.invalidate();
    void utils.inbox.unreadCount.invalidate();
  }, [item, utils]);

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
  // BMS ML extraction templates — picking the right one is what lifts the
  // extraction rate; without one the service extracts generically.
  const { data: ocrTemplates } = trpc.inbox.ocrTemplates.useQuery();
  const [templateChoice, setTemplateChoice] = useState<string>('');
  const [rememberTemplate, setRememberTemplate] = useState(true);

  const reprocess = trpc.inbox.reprocessOcr.useMutation({
    onSuccess: ({ remembered }) => {
      void utils.inbox.get.invalidate({ id });
      toast({
        title: _(msg`Re-running OCR…`),
        description: remembered
          ? _(msg`Future invoices from ${remembered} will use this template.`)
          : undefined,
      });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (error || !item) {
    return <div className="py-12 text-center text-muted-foreground">{error?.message ?? 'Not found'}</div>;
  }

  const alreadySent = item.status === 'SENT_FOR_SIGNATURE' || item.document.status !== 'DRAFT';
  const label = 'block text-[11px] font-medium text-muted-foreground mb-1';

  // Whatever the ML returned, rendered dynamically (fields vary by template).
  const ocrMeta = (item.ocrMeta ?? {}) as {
    fieldExtractions?: FieldExtraction[];
    completeness?: { score?: number } | null;
    template?: {
      id?: number | null;
      name?: string | null;
      source?: 'override' | 'vendor-email' | 'vendor-domain' | 'org-default' | 'none';
      vendor?: string | null;
      matched?: unknown;
    } | null;
  };
  const fields = ocrMeta.fieldExtractions ?? [];

  // What the rules actually read. Shown in preference to the extractor's own
  // reported value, so a correction is visible the moment it is saved.
  const extractedMap =
    item.extractedData && typeof item.extractedData === 'object' && !Array.isArray(item.extractedData)
      ? (item.extractedData as Record<string, unknown>)
      : {};
  const usedTemplate = ocrMeta.template ?? null;
  const templateName = usedTemplate?.name || fields.find((f) => f.template_name)?.template_name;

  /** Plain-language explanation of why this template was used. */
  const templateSourceLabel = (() => {
    switch (usedTemplate?.source) {
      case 'override':
        return _(msg`chosen manually`);
      case 'vendor-email':
        return _(msg`matched ${usedTemplate.vendor ?? 'vendor'} by sender email`);
      case 'vendor-domain':
        return _(msg`matched ${usedTemplate.vendor ?? 'vendor'} by sender domain`);
      case 'org-default':
        return _(msg`organization default`);
      default:
        return null;
    }
  })();
  const completeness = typeof ocrMeta.completeness?.score === 'number' ? ocrMeta.completeness.score : null;

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

      {/* Above the extracted data, because it changes whether to read it at all. */}
      <DuplicateBanner
        duplicateOf={item.duplicateOf}
        duplicates={item.duplicates}
        matchedOn={item.duplicateMatchedOn}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* OCR results — fields are whatever the ML template extracted */}
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">
              <Trans>Extracted data (OCR)</Trans>
            </h3>
            {templateName ? (
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {templateName}
                {templateSourceLabel ? ` · ${templateSourceLabel}` : ''}
              </span>
            ) : item.ocrProcessed ? (
              <span
                className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                title={_(msg`Generic extraction — accuracy is much lower without a template.`)}
              >
                <Trans>No template</Trans>
              </span>
            ) : null}
          </div>

          {/* Template picker — the lever on extraction accuracy. */}
          <div className="mb-3 rounded border border-border bg-muted/20 p-2.5">
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              <Trans>Extraction template</Trans>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-8 min-w-[190px] flex-1 rounded-md border border-input bg-background px-2 text-[13px]"
                value={templateChoice}
                onChange={(e) => setTemplateChoice(e.target.value)}
              >
                <option value="">
                  {ocrTemplates?.templates.length
                    ? _(msg`Auto (match vendor by sender)`)
                    : _(msg`No templates available`)}
                </option>
                {ocrTemplates?.templates.map((template) => (
                  <option key={template.id} value={String(template.id)}>
                    {template.name}
                    {template.id === ocrTemplates.defaultTemplateId ? ' (org default)' : ''}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[11px]"
                disabled={reprocess.isPending || item.status === 'OCR_PROCESSING'}
                onClick={() =>
                  reprocess.mutate({
                    id,
                    templateId: templateChoice ? Number(templateChoice) : null,
                    rememberForSender: Boolean(templateChoice) && rememberTemplate,
                  })
                }
              >
                {reprocess.isPending || item.status === 'OCR_PROCESSING' ? (
                  <Trans>Running…</Trans>
                ) : (
                  <Trans>Re-run OCR</Trans>
                )}
              </Button>
            </div>
            {templateChoice && item.senderEmail && (
              <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={rememberTemplate}
                  onChange={(e) => setRememberTemplate(e.target.checked)}
                />
                <Trans>Always use this template for {item.senderEmail}</Trans>
              </label>
            )}
          </div>

          {!item.ocrProcessed ? (
            <p className="text-[12px] text-muted-foreground">
              {item.status === 'OCR_PROCESSING' ? (
                <Trans>OCR is running…</Trans>
              ) : item.status === 'OCR_QUEUED' ? (
                <>
                  <Trans>
                    Smart OCR paused — no pages left in this organization's plan this period.
                  </Trans>{' '}
                  <Trans>
                    You can still send for signature. This will process automatically once quota
                    frees up, or{' '}
                    <Link className="underline underline-offset-4" to="/org/billing">
                      upgrade your plan
                    </Link>
                    .
                  </Trans>
                </>
              ) : item.status === 'OCR_FAILED' ? (
                <Trans>OCR failed — you can re-run it or proceed manually.</Trans>
              ) : (
                <Trans>No OCR data (engine not configured). You can still send for signature.</Trans>
              )}
            </p>
          ) : (
            <>
              {/* Summary: document type + overall confidence + completeness bar */}
              <div className="mb-3 rounded border border-border bg-muted/20 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                    <Trans>OCR results</Trans>
                  </span>
                  <div className="flex items-center gap-2">
                    {item.documentType && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {item.documentType}
                      </span>
                    )}
                    {item.ocrConfidence != null && (
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          item.ocrConfidence >= 0.8
                            ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                            : item.ocrConfidence >= 0.5
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                        }`}
                      >
                        {pct(item.ocrConfidence)}% <Trans>confidence</Trans>
                      </span>
                    )}
                  </div>
                </div>
                {completeness != null && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${completeness >= 0.7 ? 'bg-green-500' : 'bg-amber-500'}`}
                      style={{ width: `${completeness * 100}%` }}
                    />
                  </div>
                )}
              </div>

              {fields.length > 0 || Object.keys(extractedMap).length > 0 ? (
                <ExtractedFields
                  inboxItemId={id}
                  fields={fields}
                  extractedData={extractedMap}
                  fieldEdits={item.fieldEdits ?? []}
                  templateName={templateName}
                  readOnly={item.document.status === 'COMPLETED'}
                />
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  <Trans>OCR ran but the template extracted no fields.</Trans>
                </p>
              )}

              {item.ocrText && (
                <div className="mt-3 border-t border-border pt-2">
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setShowOcrText((s) => !s)}
                  >
                    {showOcrText ? '− Hide OCR content' : '+ Show OCR content'}
                  </button>
                  {showOcrText && (
                    <>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
                        {item.ocrText}
                      </pre>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {item.ocrText.length} <Trans>characters extracted</Trans>
                      </p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right column: the send box, then the document's history beneath it. */}
        <div className="space-y-4">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <h3 className="mb-2 text-[14px] font-semibold">
            <Trans>Send for signature</Trans>
          </h3>

          {item.document.recipients.length > 0 && (
            <div className="mb-3">
              <p className={label}>
                <Trans>Existing signers</Trans>
              </p>
              <SignerList
                inboxItemId={id}
                documentStatus={item.document.status}
                signers={item.document.recipients}
              />
            </div>
          )}

          {alreadySent ? (
            <SigningStatusBanner
              documentStatus={item.document.status}
              recipients={item.document.recipients}
              completedAt={item.document.completedAt}
            />
          ) : (
            <>
              <p className={label}>
                <Trans>Add signer(s)</Trans>
              </p>
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    {/*
                      Both halves search the same org directory, so a signer can
                      be found by whichever identifier the sender happens to
                      know. Picking a member from either side fills the whole
                      row, and typing a non-member still works — these stay free
                      text so external signers are not locked out.
                    */}
                    <RecipientEmailAutocomplete
                      field="name"
                      className="flex-1"
                      inputClassName="h-8 text-[13px]"
                      placeholder="Name"
                      value={row.name}
                      onChange={(value) =>
                        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, name: value } : r)))
                      }
                      onSelectMember={(m) =>
                        setRows((prev) =>
                          prev.map((r, idx) =>
                            idx === i ? { ...r, name: m.name || m.email, email: m.email } : r,
                          ),
                        )
                      }
                    />
                    <RecipientEmailAutocomplete
                      className="flex-1"
                      inputClassName="h-8 text-[13px]"
                      placeholder="email@company.com"
                      value={row.email}
                      onChange={(value) =>
                        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, email: value } : r)))
                      }
                      onSelectMember={(m) =>
                        setRows((prev) =>
                          prev.map((r, idx) =>
                            // Don't clobber a name the sender already typed.
                            idx === i
                              ? { ...r, email: m.email, name: r.name || m.name || '' }
                              : r,
                          ),
                        )
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
                {/*
                  Withheld while OCR is reading. This page is reachable by URL and
                  can already be open when a re-read starts, so guarding the list's
                  Review button is not enough on its own — and sending is the
                  consequential action: it puts an invoice in front of a signer
                  before anyone could have checked the figures it was read as.
                */}
                <Button
                  size="sm"
                  className="w-full"
                  disabled={send.isPending || item.status === 'OCR_PROCESSING'}
                  title={
                    item.status === 'OCR_PROCESSING'
                      ? _(msg`Wait for OCR to finish before sending`)
                      : undefined
                  }
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
                {item.status === 'OCR_PROCESSING' && (
                  <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                    <Trans>
                      OCR is still reading this document. The extracted figures may be
                      incomplete until it finishes.
                    </Trans>
                  </p>
                )}
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

        {/*
          The history goes under the send box rather than beside it: once a
          document has been sent, the send box collapses to a one-line status
          and this column is otherwise empty, which is exactly when someone is
          looking for what happened to it.
        */}
        <AttachmentOcrPanel
          inboxItemId={id}
          files={item.document.supportingFiles ?? []}
        />

        <DocumentTimeline inboxItemId={id} />
        </div>
      </div>
    </div>
  );
}
