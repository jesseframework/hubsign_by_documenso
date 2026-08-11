import { useEffect, useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon, ArrowLeftIcon, SaveIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { RichTextEditor } from '@documenso/ui/primitives/rich-text-editor';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { OrgAdminGuard } from '~/components/general/org-admin-guard';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Edit Email Template');
}

/** Paths a workflow run exposes, for the reference panel beside the editor. */
const VARIABLE_HINTS = [
  ['{{payload.extractedData.invoice_number}}', 'An OCR-extracted field'],
  ['{{payload.document.title}}', 'Triggering document title'],
  ['{{vars.vendor.email}}', 'From a LOOKUP_METADATA step'],
  ['{{vars.vendor.label}}', 'Matched record display name'],
  ['{{organization.name}}', 'Your organization'],
  ['{{now}}', 'Run timestamp'],
];

const label = 'mb-1 block text-[11px] font-medium text-muted-foreground';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function EmailTemplateEditorPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: existing, isLoading } = trpc.emailTemplate.get.useQuery(
    { id: id ?? '' },
    { enabled: !isNew && Boolean(id) },
  );

  const [form, setForm] = useState({
    key: '',
    name: '',
    description: '',
    subject: '',
    html: '',
    text: '',
  });
  // Tracks whether the user has taken manual control of the key, so auto-slug
  // never overwrites a deliberate choice.
  const [keyTouched, setKeyTouched] = useState(false);

  useEffect(() => {
    if (existing) {
      setForm({
        key: existing.key,
        name: existing.name,
        description: existing.description ?? '',
        subject: existing.subject,
        html: existing.html,
        text: existing.text ?? '',
      });
      setKeyTouched(true);
    }
  }, [existing]);

  // Renaming a key orphans any step still referencing the old one, so surface
  // what depends on it before the author saves.
  const { data: usage } = trpc.emailTemplate.usage.useQuery(
    { key: existing?.key ?? '' },
    { enabled: Boolean(existing?.key) },
  );

  const keyChanged = Boolean(existing && form.key !== existing.key);

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const onSuccess = async () => {
    await utils.emailTemplate.list.invalidate();
    toast({ title: _(msg`Email template saved`) });
    navigate('/org/email-templates');
  };

  const onError = (error: { message: string }) =>
    toast({ title: error.message, variant: 'destructive' });

  const create = trpc.emailTemplate.create.useMutation({ onSuccess, onError });
  const update = trpc.emailTemplate.update.useMutation({ onSuccess, onError });
  const isSaving = create.isPending || update.isPending;

  const save = () => {
    const payload = {
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      subject: form.subject.trim(),
      html: form.html,
      text: form.text.trim() || null,
    };

    if (!payload.key || !payload.name || !payload.subject || !payload.html) {
      toast({
        title: _(msg`Name, key, subject and HTML body are all required`),
        variant: 'destructive',
      });
      return;
    }

    if (isNew) {
      create.mutate(payload);
    } else if (id) {
      update.mutate({ id, ...payload });
    }
  };

  // The preview renders the author's markup as-is so they see what recipients
  // get. `{{ }}` placeholders are left unresolved — there is no run context
  // here, and substituting fake values would misrepresent the output.
  const previewHtml = useMemo(() => form.html, [form.html]);

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-[13px] text-muted-foreground">
        <Trans>Loading...</Trans>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/org/email-templates" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <h2 className="text-lg font-semibold">
            {isNew ? <Trans>New email template</Trans> : <Trans>Edit email template</Trans>}
          </h2>
        </div>

        <Button size="sm" onClick={save} disabled={isSaving}>
          <SaveIcon className="mr-1.5 h-4 w-4" />
          <Trans>Save</Trans>
        </Button>
      </div>

      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className={label}>
              <Trans>Name</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              placeholder="Invoice received"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                set({ name, ...(!keyTouched && isNew ? { key: slugify(name) } : {}) });
              }}
            />
          </div>

          <div>
            <label className={label}>
              <Trans>Key — referenced from workflow steps</Trans>
            </label>
            <Input
              className="h-8 font-mono text-[13px]"
              placeholder="invoice-received"
              value={form.key}
              onChange={(e) => {
                setKeyTouched(true);
                set({ key: e.target.value });
              }}
            />
          </div>
        </div>

        <div className="mt-3">
          <label className={label}>
            <Trans>Description (optional)</Trans>
          </label>
          <Input
            className="h-8 text-[13px]"
            placeholder="Sent to a vendor when their invoice arrives"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>

        <div className="mt-3">
          <label className={label}>
            <Trans>Subject</Trans>
          </label>
          <Input
            className="h-8 text-[13px]"
            placeholder="We received your invoice {{payload.extractedData.invoice_number}}"
            value={form.subject}
            onChange={(e) => set({ subject: e.target.value })}
          />
        </div>
      </div>

      {keyChanged && usage && usage.length > 0 && (
        <div className="flex gap-3 rounded-[var(--r)] border border-status-pending-text/30 bg-status-pending-bg p-3">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-pending-text" />
          <div className="text-[12px]">
            <p className="font-medium text-status-pending-text">
              <Trans>Changing this key will break {usage.length} workflow step(s)</Trans>
            </p>
            <p className="mt-0.5 text-muted-foreground">
              <Trans>
                These workflows reference "{existing?.key}" and will stop sending until they're
                updated to the new key:
              </Trans>{' '}
              {usage.map((w) => w.name).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <label className={label}>
            <Trans>HTML body</Trans>
          </label>
          <RichTextEditor value={form.html} onChange={(html) => set({ html })} />

          <label className={`${label} mt-3`}>
            <Trans>Plain text fallback (optional)</Trans>
          </label>
          <textarea
            className="h-24 w-full resize-y rounded-[var(--r-sm)] border border-border bg-input p-3 font-mono text-[12px] outline-none focus:border-primary"
            placeholder={_(msg`Left blank, the HTML is used with tags stripped.`)}
            value={form.text}
            onChange={(e) => set({ text: e.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="space-y-3">
          <div className="rounded-[var(--r)] border border-border bg-card p-4">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              <Trans>Preview</Trans>
            </p>
            <div className="rounded-[var(--r-sm)] border border-border bg-white p-4">
              <p className="mb-2 border-b border-border pb-2 text-[12px] font-semibold text-black">
                {form.subject || _(msg`(no subject)`)}
              </p>
              {/*
                Rendered in a sandboxed iframe rather than via
                dangerouslySetInnerHTML. This is author-supplied markup that is
                persisted and later shown to other administrators, so injecting
                it into this document would be stored XSS running with the
                viewer's session — and the app ships no CSP to fall back on.
                An empty `sandbox` withholds every capability including scripts
                and same-origin access, so the worst a template can do is look
                wrong. It also isolates the markup from app CSS, which makes
                this a more honest preview of what a mail client will show.
              */}
              <iframe
                title={_(msg`Email preview`)}
                sandbox=""
                srcDoc={previewHtml}
                className="h-64 w-full border-0 bg-white"
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              <Trans>
                Placeholders are shown literally — they resolve against the run context when the
                workflow fires.
              </Trans>
            </p>
          </div>

          <div className="rounded-[var(--r)] border border-border bg-card p-4">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              <Trans>Available placeholders</Trans>
            </p>
            <ul className="space-y-1.5">
              {VARIABLE_HINTS.map(([token, hint]) => (
                <li key={token} className="flex items-baseline justify-between gap-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {token}
                  </code>
                  <span className="text-right text-[11px] text-muted-foreground">{hint}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function EmailTemplateEditorRoute() {
  return (
    <OrgAdminGuard>
      <EmailTemplateEditorPage />
    </OrgAdminGuard>
  );
}
