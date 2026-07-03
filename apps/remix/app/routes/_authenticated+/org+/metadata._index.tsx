import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { DatabaseIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Metadata');
}

/** Common categories — free text is still allowed via the datalist. */
const CATEGORY_PRESETS = ['vendor', 'signee', 'recipient', 'customer', 'approver', 'department'];
/** Signing roles for signee/recipient records. */
const ROLE_PRESETS = ['SIGNER', 'APPROVER', 'CC', 'VIEWER'];

const dataOf = (record: { data?: unknown }): Record<string, unknown> =>
  record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {};

const label = 'mb-1 block text-[11px] font-medium text-muted-foreground';

export default function MetadataPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: records, isLoading } = trpc.metadata.list.useQuery();

  const [category, setCategory] = useState('vendor');
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [keywords, setKeywords] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setCategory('vendor');
    setName('');
    setContactName('');
    setEmail('');
    setRole('');
    setPhone('');
    setKeywords('');
  };

  const upsert = trpc.metadata.upsert.useMutation({
    onSuccess: () => {
      void utils.metadata.list.invalidate();
      resetForm();
      toast({ title: _(msg`Saved`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });
  const update = trpc.metadata.update.useMutation({
    onSuccess: () => {
      void utils.metadata.list.invalidate();
      resetForm();
      toast({ title: _(msg`Updated`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });
  const remove = trpc.metadata.delete.useMutation({
    onSuccess: () => {
      void utils.metadata.list.invalidate();
      toast({ title: _(msg`Deleted`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  const startEdit = (r: {
    id: string;
    category: string;
    label?: string | null;
    email?: string | null;
    data?: unknown;
  }) => {
    const d = dataOf(r);
    setEditingId(r.id);
    setCategory(r.category);
    setName(r.label ?? '');
    setContactName(typeof d.contactName === 'string' ? d.contactName : '');
    setEmail(r.email ?? '');
    setRole(typeof d.role === 'string' ? d.role : '');
    setPhone(typeof d.phone === 'string' ? d.phone : '');
    setKeywords(
      Array.isArray(d.keywords)
        ? (d.keywords as unknown[]).map(String).join(', ')
        : typeof d.keywords === 'string'
          ? d.keywords
          : '',
    );
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onSave = () => {
    if (!name.trim()) {
      toast({ title: _(msg`Name is required`), variant: 'destructive' });
      return;
    }
    // Extra fields go into the flexible `data` object — the workflow lookup
    // exposes them as {{vars.<saveAs>.contactName}}, {{vars.<saveAs>.role}}, etc.
    const extra: Record<string, unknown> = {};
    if (contactName.trim()) extra.contactName = contactName.trim();
    if (role.trim()) extra.role = role.trim();
    if (phone.trim()) extra.phone = phone.trim();
    const kw = keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (kw.length) extra.keywords = kw;

    const payload = {
      category: category.trim() || 'vendor',
      label: name.trim(),
      email: email.trim() || null,
      data: Object.keys(extra).length ? extra : undefined,
    };
    if (editingId) {
      update.mutate({ id: editingId, ...payload });
    } else {
      upsert.mutate(payload);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          <Trans>Metadata</Trans>
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>
            A lookup directory that workflows resolve at runtime — e.g. a vendor → email, or a
            signee/recipient (the person who will sign) → their email & role. Use the "Look up
            metadata" workflow action to find a record by name, then notify or send it to sign.
          </Trans>
        </p>
      </div>

      {/* Add / update form */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">
          {editingId ? <Trans>Edit record</Trans> : <Trans>Add a record</Trans>}
        </p>
        <datalist id="metadata-categories">
          {CATEGORY_PRESETS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="metadata-roles">
          {ROLE_PRESETS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[150px]">
            <label className={label}>
              <Trans>Category</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              list="metadata-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="vendor / signee"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className={label}>
              <Trans>Name (lookup key)</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Skidd View Ltd."
            />
          </div>
          <div className="min-w-[160px] flex-1">
            <label className={label}>
              <Trans>Contact name</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className={label}>
              <Trans>Email</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@company.com"
            />
          </div>
          <div className="w-[120px]">
            <label className={label}>
              <Trans>Role</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              list="metadata-roles"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="SIGNER"
            />
          </div>
          <div className="w-[130px]">
            <label className={label}>
              <Trans>Phone</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="min-w-[240px] flex-1">
            <label className={label}>
              <Trans>Keywords (comma-separated)</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. northgate, consulting, IT services"
            />
          </div>
          <Button size="sm" disabled={upsert.isPending || update.isPending} onClick={onSave}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            {editingId ? <Trans>Update</Trans> : <Trans>Save</Trans>}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={resetForm}>
              <XIcon className="mr-1 h-3.5 w-3.5" />
              <Trans>Cancel</Trans>
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <Trans>
            Only Category + Name are required. Name match is case-insensitive. Keywords let a
            workflow auto-route by scanning the invoice's OCR data — if any keyword appears, this
            record's signee/vendor is used (e.g. to trigger a sign request).
          </Trans>
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !records || records.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <DatabaseIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>No metadata yet</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
            <Trans>
              Add a record above (e.g. a vendor, or a signee who should sign) so workflows can look
              them up.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Category</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Name / Contact</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Email / Phone</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Role</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Actions</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const d = dataOf(r);
                const contact = typeof d.contactName === 'string' ? d.contactName : '';
                const roleVal = typeof d.role === 'string' ? d.role : '';
                const phoneVal = typeof d.phone === 'string' ? d.phone : '';
                const kw = Array.isArray(d.keywords)
                  ? (d.keywords as unknown[]).map(String)
                  : typeof d.keywords === 'string'
                    ? d.keywords.split(',').map((k) => k.trim()).filter(Boolean)
                    : [];
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 align-top">
                      <span className="rounded bg-muted/60 px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                        {r.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="text-[13px] font-medium">{r.label}</p>
                      {contact && <p className="text-[11px] text-muted-foreground">{contact}</p>}
                      {kw.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {kw.map((k) => (
                            <span
                              key={k}
                              className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-[12px] text-muted-foreground">
                      <p>{r.email ?? '—'}</p>
                      {phoneVal && <p className="text-[11px]">{phoneVal}</p>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {roleVal ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                          {roleVal}
                        </span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          title={_(msg`Edit`)}
                          onClick={() => startEdit(r)}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive"
                          title={_(msg`Delete`)}
                          onClick={() => remove.mutate({ id: r.id })}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
