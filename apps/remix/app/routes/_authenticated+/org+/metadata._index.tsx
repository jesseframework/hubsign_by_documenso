import { useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  DatabaseIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import Papa, { type ParseResult } from 'papaparse';

import {
  MAX_METADATA_IMPORT_ROWS,
  METADATA_IMPORT_HEADER_ALIASES,
  buildMetadataTemplateCsv,
  parseKeywordsCell,
} from '@documenso/lib/universal/metadata-import';
import {
  DEFAULT_SIGNING_ORDER,
  type MetadataSigner,
  type MetadataSigningOrder,
  parseSignersCell,
  readRecordSigners,
  readRecordSigningOrder,
  writeRecordSigners,
} from '@documenso/lib/universal/metadata-signers';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { SignerChainEditor } from '~/components/general/metadata/signer-chain-editor';
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
  const [ocrTemplateId, setOcrTemplateId] = useState('');
  // Who signs documents from this vendor — kept on the same record so one row
  // drives both the confirmation email and the signature request. An ordered
  // list, because an approval chain is the normal case, not the exception.
  const [signers, setSigners] = useState<MetadataSigner[]>([]);
  const [signingOrder, setSigningOrder] = useState<MetadataSigningOrder>(DEFAULT_SIGNING_ORDER);
  // Turnaround targets in business hours; blank = inherit the org default.
  const [slaInternalHours, setSlaInternalHours] = useState('');
  const [slaEndToEndHours, setSlaEndToEndHours] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Extraction templates, so a vendor can be pinned to one — invoices from that
  // sender then OCR with it instead of falling back to generic extraction.
  const { data: ocrTemplates } = trpc.inbox.ocrTemplates.useQuery();

  const resetForm = () => {
    setEditingId(null);
    setCategory('vendor');
    setName('');
    setContactName('');
    setEmail('');
    setRole('');
    setPhone('');
    setKeywords('');
    setOcrTemplateId('');
    setSigners([]);
    setSigningOrder(DEFAULT_SIGNING_ORDER);
    setSlaInternalHours('');
    setSlaEndToEndHours('');
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

  // ---------------------------------------------------------------- import --

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<
    { row?: number; label: string; message: string }[]
  >([]);

  const bulkUpsert = trpc.metadata.bulkUpsert.useMutation({
    onSuccess: ({ created, updated, errors }) => {
      void utils.metadata.list.invalidate();

      // Append rather than replace — the parser's own row errors were recorded
      // before this ever reached the server.
      setImportErrors((previous) => [...previous, ...errors]);

      const skipped = errors.length;
      const nothingLanded = created === 0 && updated === 0;

      toast({
        title: _(msg`Import finished`),
        description: skipped
          ? _(msg`${created} added, ${updated} updated, ${skipped} skipped.`)
          : _(msg`${created} added, ${updated} updated.`),
        variant: nothingLanded ? 'destructive' : undefined,
      });
    },
    onError: (e) => toast({ title: _(msg`Import failed`), description: e.message, variant: 'destructive' }),
  });

  const downloadTemplate = () => {
    const blob = new Blob([buildMetadataTemplateCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = 'hubsign-metadata-template.csv';
    anchor.click();

    URL.revokeObjectURL(url);
  };

  const onImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    // Let the same file be re-picked after a failed attempt.
    event.target.value = '';

    if (!file) {
      return;
    }

    // Parsing the binary .xlsx container would mean pulling in a spreadsheet
    // library; say so plainly instead of failing with a garbled parse error.
    if (/\.xlsx?$/i.test(file.name)) {
      toast({
        title: _(msg`Save the file as CSV first`),
        description: _(
          msg`Excel workbooks (.xlsx) aren't supported. In Excel choose File → Save As → CSV UTF-8, then upload that file.`,
        ),
        variant: 'destructive',
      });
      return;
    }

    setImportErrors([]);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // Map the sheet's headers onto our field names; unknown columns keep a
      // normalized name and are simply never read.
      transformHeader: (header) => {
        const normalized = header.trim().toLowerCase();
        return METADATA_IMPORT_HEADER_ALIASES[normalized] ?? normalized;
      },
      complete: (results: ParseResult<Record<string, string>>) => {
        const records: {
          category: string;
          label: string;
          email: string | null;
          data?: Record<string, unknown>;
          ocrTemplate?: string;
          row: number;
        }[] = [];
        const localErrors: { row?: number; label: string; message: string }[] = [];

        results.data.forEach((raw, index) => {
          // +2: one for the header line, one to count from 1 like a spreadsheet.
          const row = index + 2;

          const value = (field: string) => (raw[field] ?? '').toString().trim();

          const label = value('label');
          const category = value('category').toLowerCase() || 'vendor';

          if (!label) {
            // A blank name on an otherwise-populated line is a mistake worth
            // reporting; a fully blank line is just spreadsheet padding.
            const hasAnyValue = [
              'contactName',
              'email',
              'role',
              'phone',
              'keywords',
              'ocrTemplate',
              'signers',
              'signerName',
              'signerEmail',
              'signerRole',
              'slaInternalHours',
              'slaEndToEndHours',
            ].some((f) => value(f));

            if (hasAnyValue) {
              localErrors.push({ row, label: '—', message: 'Name is required.' });
            }
            return;
          }

          const extra: Record<string, unknown> = {};
          const contactNameValue = value('contactName');
          const roleValue = value('role');
          const phoneValue = value('phone');
          const keywordValues = parseKeywordsCell(value('keywords'));

          if (contactNameValue) extra.contactName = contactNameValue;
          if (roleValue) extra.role = roleValue.toUpperCase();
          if (phoneValue) extra.phone = phoneValue;
          if (keywordValues.length) extra.keywords = keywordValues;

          // The whole chain from one cell. A file saved before this column
          // existed still carries the three single-signer columns, so those are
          // read as a one-entry chain rather than ignored.
          const signersCell = value('signers');
          const legacySigner = value('signerEmail');

          const parsedSigners = signersCell
            ? parseSignersCell(signersCell)
            : parseSignersCell(
                legacySigner
                  ? [legacySigner, value('signerRole'), value('signerName')]
                      .filter(Boolean)
                      .join('|')
                  : '',
              );

          // Reported per row, not thrown: a mistyped role in one row of two
          // hundred should not cost the whole import. The row still lands with a
          // usable address and the warning says what was assumed.
          for (const warning of parsedSigners.warnings) {
            localErrors.push({ row, label, message: warning });
          }

          if (parsedSigners.signers.length) {
            Object.assign(extra, writeRecordSigners(parsedSigners.signers));
          }

          const slaInternal = Number(value('slaInternalHours'));
          const slaEndToEnd = Number(value('slaEndToEndHours'));
          if (Number.isFinite(slaInternal) && slaInternal > 0) extra.slaInternalHours = slaInternal;
          if (Number.isFinite(slaEndToEnd) && slaEndToEnd > 0) extra.slaEndToEndHours = slaEndToEnd;

          records.push({
            category,
            label,
            email: value('email') || null,
            data: Object.keys(extra).length ? extra : undefined,
            // Sent as the name; the server resolves it to the BMS ML id.
            ocrTemplate: value('ocrTemplate') || undefined,
            row,
          });
        });

        if (records.length === 0) {
          setImportErrors(localErrors);
          toast({
            title: _(msg`Nothing to import`),
            description: _(
              msg`No rows with a Name were found. Download the template to check the expected columns.`,
            ),
            variant: 'destructive',
          });
          return;
        }

        if (records.length > MAX_METADATA_IMPORT_ROWS) {
          toast({
            title: _(msg`Too many rows`),
            description: _(
              msg`This file has ${records.length} rows; the limit is ${MAX_METADATA_IMPORT_ROWS} per import. Split it into smaller files.`,
            ),
            variant: 'destructive',
          });
          return;
        }

        setImportErrors(localErrors);
        bulkUpsert.mutate({ records });
      },
      error: (err: Error) => {
        toast({
          title: _(msg`Could not read the file`),
          description: err.message,
          variant: 'destructive',
        });
      },
    });
  };

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
    setOcrTemplateId(typeof d.ocrTemplateId === 'number' ? String(d.ocrTemplateId) : '');
    // Reads the legacy single-signer shape too, so an untouched record opens as
    // a one-entry chain rather than losing its signer.
    setSigners(readRecordSigners(d));
    setSigningOrder(readRecordSigningOrder(d));
    setSlaInternalHours(typeof d.slaInternalHours === 'number' ? String(d.slaInternalHours) : '');
    setSlaEndToEndHours(typeof d.slaEndToEndHours === 'number' ? String(d.slaEndToEndHours) : '');
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
    // Blank rows are the natural residue of an "Add signer" click that was
    // thought better of; drop them rather than saving an empty recipient.
    const cleanSigners = signers
      .map((s) => ({ ...s, email: s.email.trim().toLowerCase(), name: s.name?.trim() || undefined }))
      .filter((s) => s.email);

    Object.assign(extra, writeRecordSigners(cleanSigners, signingOrder));
    if (Number(slaInternalHours) > 0) extra.slaInternalHours = Number(slaInternalHours);
    if (Number(slaEndToEndHours) > 0) extra.slaEndToEndHours = Number(slaEndToEndHours);

    if (ocrTemplateId) {
      const chosen = ocrTemplates?.templates.find((t) => String(t.id) === ocrTemplateId);
      extra.ocrTemplateId = Number(ocrTemplateId);
      if (chosen) extra.ocrTemplateName = chosen.name;
    }

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
      <div className="flex flex-wrap items-start justify-between gap-3">
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

        <div className="flex flex-shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={downloadTemplate}>
            <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
            <Trans>Download template</Trans>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpsert.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon className="mr-1.5 h-3.5 w-3.5" />
            {bulkUpsert.isPending ? <Trans>Importing…</Trans> : <Trans>Import CSV</Trans>}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onImportFile}
          />
        </div>
      </div>

      {importErrors.length > 0 && (
        <div className="rounded-[var(--r)] border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] font-medium text-destructive">
              <Trans>{importErrors.length} row(s) were skipped</Trans>
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              onClick={() => setImportErrors([])}
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {importErrors.slice(0, 10).map((error, index) => (
              <li key={`${error.row ?? index}-${index}`} className="text-[11px] text-muted-foreground">
                {error.row ? `Row ${error.row}` : 'Row ?'}
                {error.label && error.label !== '—' ? ` (${error.label})` : ''} — {error.message}
              </li>
            ))}
          </ul>
          {importErrors.length > 10 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <Trans>…and {importErrors.length - 10} more.</Trans>
            </p>
          )}
        </div>
      )}

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
          <div className="w-[110px]">
            <label className={label}>
              <Trans>SLA internal</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              type="number"
              min={1}
              value={slaInternalHours}
              onChange={(e) => setSlaInternalHours(e.target.value)}
              placeholder="hours"
              title={_(msg`Business hours from email received to sent for signature. Blank uses the org default.`)}
            />
          </div>
          <div className="w-[110px]">
            <label className={label}>
              <Trans>SLA end-to-end</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              type="number"
              min={1}
              value={slaEndToEndHours}
              onChange={(e) => setSlaEndToEndHours(e.target.value)}
              placeholder="hours"
              title={_(msg`Business hours from email received to fully signed. Blank uses the org default.`)}
            />
          </div>
          {Boolean(ocrTemplates?.templates.length) && (
            <div className="w-[170px]">
              <label className={label}>
                <Trans>OCR template</Trans>
              </label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                value={ocrTemplateId}
                onChange={(e) => setOcrTemplateId(e.target.value)}
                title={_(msg`Invoices from this vendor's email extract with this template.`)}
              >
                <option value="">{_(msg`None`)}</option>
                {ocrTemplates?.templates.map((template) => (
                  <option key={template.id} value={String(template.id)}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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

        <div className="mt-3">
          <SignerChainEditor
            signers={signers}
            onChange={setSigners}
            signingOrder={signingOrder}
            onSigningOrderChange={setSigningOrder}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <Trans>
            Only Category + Name are required. <strong>Name identifies the record and must be
            unique within its category</strong> — two people cannot share one name, so give each
            signee their own (put a job title in Role, not in Name). Name match is
            case-insensitive. Keywords let a workflow auto-route by scanning the invoice's OCR data
            — if any keyword appears, this record's signee/vendor is used (e.g. to trigger a sign
            request).
          </Trans>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          <Trans>
            One vendor record covers the whole invoice flow — <strong>Email</strong> receives the
            "we received your invoice" confirmation, and the <strong>Signers</strong> list below is
            who the document is then sent to. Add as many as the approval chain needs; with "In
            order" they are asked one at a time, top to bottom, and each is only invited once the
            one above has signed. Leave the list empty to send only the confirmation.
          </Trans>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          <Trans>
            Adding a lot at once? Download the template, fill it in with Excel or Google Sheets,
            save it as CSV, then use Import. Re-importing an edited file updates the matching
            records instead of duplicating them. Rows that repeat a name already used in the same
            category are skipped and reported rather than overwriting the earlier row.
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
                const templateLabel =
                  typeof d.ocrTemplateName === 'string'
                    ? d.ocrTemplateName
                    : typeof d.ocrTemplateId === 'number'
                      ? `Template #${d.ocrTemplateId}`
                      : null;
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
                      {templateLabel && (
                        <p
                          className="mt-1 text-[10px] text-muted-foreground"
                          title={_(msg`Invoices from this email extract with this template.`)}
                        >
                          OCR: {templateLabel}
                        </p>
                      )}
                      {(typeof d.slaInternalHours === 'number' ||
                        typeof d.slaEndToEndHours === 'number') && (
                        <p
                          className="mt-1 text-[10px] text-muted-foreground"
                          title={_(msg`Turnaround targets in business hours.`)}
                        >
                          SLA:{' '}
                          {typeof d.slaInternalHours === 'number' ? `${d.slaInternalHours}h` : '—'}
                          {' / '}
                          {typeof d.slaEndToEndHours === 'number' ? `${d.slaEndToEndHours}h` : '—'}
                        </p>
                      )}
                      {(() => {
                        // Shown as the chain it is, in order, so the approval
                        // route is readable from the list without opening the
                        // record. Reads legacy single-signer records too.
                        const chain = readRecordSigners(d);
                        if (chain.length === 0) return null;

                        const ordered = readRecordSigningOrder(d) === 'SEQUENTIAL';

                        return (
                          <p
                            className="mt-1 text-[10px] text-muted-foreground"
                            title={_(
                              ordered
                                ? msg`Asked to sign one at a time, in this order.`
                                : msg`All asked to sign at the same time.`,
                            )}
                          >
                            {chain.map((signer, i) => (
                              <span key={signer.email}>
                                {i > 0 && <span className="mx-1">{ordered ? '→' : '+'}</span>}
                                <span className="opacity-70">{signer.role.toLowerCase()}:</span>{' '}
                                {signer.name || signer.email}
                              </span>
                            ))}
                          </p>
                        );
                      })()}
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
