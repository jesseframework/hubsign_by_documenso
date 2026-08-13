import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { PencilIcon, PlusIcon, SlidersHorizontalIcon, Trash2Icon, XIcon } from 'lucide-react';

import {
  METADATA_FIELD_TYPES,
  type MetadataFieldType,
  deriveMetadataFieldKey,
  isReservedMetadataFieldKey,
} from '@documenso/lib/universal/metadata-fields';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * The org's own fields on a metadata record.
 *
 * Scoped to one category at a time, because a field only makes sense for some of
 * them: a GL account belongs to a vendor, a job title to a signee. The category
 * shown follows the form above, so defining a field lands it exactly where the
 * person was already working.
 */

export type MetadataFieldDefinition = {
  id: string;
  category: string;
  key: string;
  label: string;
  type: MetadataFieldType;
  options: string[];
  helpText: string | null;
  required: boolean;
  order: number;
};

const TYPE_LABELS: Record<MetadataFieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Yes / no',
  SELECT: 'Dropdown',
};

const inputClass = 'h-8 border-border bg-card text-[13px]';
const labelClass = 'mb-1 block text-[11px] font-medium text-muted-foreground';

export function CustomFieldsManager({
  category,
  fields,
}: {
  category: string;
  fields: MetadataFieldDefinition[];
}) {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<MetadataFieldType>('TEXT');
  const [options, setOptions] = useState('');
  const [helpText, setHelpText] = useState('');
  const [required, setRequired] = useState(false);

  const normalizedCategory = category.trim().toLowerCase() || 'vendor';
  const forCategory = fields.filter((field) => field.category === normalizedCategory);

  const reset = () => {
    setEditingId(null);
    setLabel('');
    setType('TEXT');
    setOptions('');
    setHelpText('');
    setRequired(false);
  };

  const onDone = (title: string) => {
    void utils.metadata.listFields.invalidate();
    void utils.metadata.list.invalidate();
    reset();
    toast({ title });
  };

  const onError = (e: { message: string }) =>
    toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' });

  const upsertField = trpc.metadata.upsertField.useMutation({
    onSuccess: () => onDone(editingId ? _(msg`Field updated`) : _(msg`Field added`)),
    onError,
  });

  const deleteField = trpc.metadata.deleteField.useMutation({
    onSuccess: () => onDone(_(msg`Field removed`)),
    onError,
  });

  const startEdit = (field: MetadataFieldDefinition) => {
    setEditingId(field.id);
    setLabel(field.label);
    setType(field.type);
    setOptions(field.options.join(', '));
    setHelpText(field.helpText ?? '');
    setRequired(field.required);
  };

  // Shown while typing a new field, so the template placeholder is known before
  // the field is created rather than having to be looked up afterwards.
  const derivedKey = deriveMetadataFieldKey(label);
  const reserved = derivedKey !== '' && isReservedMetadataFieldKey(derivedKey);
  const duplicate =
    !editingId && derivedKey !== '' && forCategory.some((field) => field.key === derivedKey);

  const canSave =
    label.trim() !== '' &&
    derivedKey !== '' &&
    !reserved &&
    !duplicate &&
    (type !== 'SELECT' || options.split(',').some((option) => option.trim()));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <SlidersHorizontalIcon className="mr-1.5 h-3.5 w-3.5" />
          <Trans>Custom fields</Trans>
          {forCategory.length > 0 && (
            <span className="ml-1.5 rounded bg-primary/10 px-1.5 text-[10px] text-primary">
              {forCategory.length}
            </span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            <Trans>Custom fields for {normalizedCategory}</Trans>
          </DialogTitle>
        </DialogHeader>

        <p className="text-[12px] text-muted-foreground">
          {/*
            The `{{vars…}}` sample is deliberately outside <Trans>: its braces read
            as placeholders to the lingui macro, which made the whole sentence
            render as its own source text.
          */}
          <Trans>
            Fields you add here appear on every {normalizedCategory} record, in the spreadsheet
            template, and in workflows as
          </Trans>{' '}
          <code className="rounded bg-muted px-1">{'{{vars.<step>.<field>}}'}</code>
        </p>

        {forCategory.length > 0 && (
          <div className="rounded-[var(--r-sm)] border border-border">
            <table className="w-full">
              <tbody>
                {forCategory.map((field) => (
                  <tr key={field.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <p className="text-[13px] font-medium">
                        {field.label}
                        {field.required && <span className="ml-1 text-destructive">*</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {TYPE_LABELS[field.type]} · {field.key}
                        {field.options.length > 0 ? ` · ${field.options.join(', ')}` : ''}
                      </p>
                      {field.helpText && (
                        <p className="text-[10px] text-muted-foreground">{field.helpText}</p>
                      )}
                    </td>
                    <td className="w-[90px] px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          title={_(msg`Edit`)}
                          onClick={() => startEdit(field)}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive"
                          title={_(msg`Remove this field. Values already saved are kept.`)}
                          disabled={deleteField.isPending}
                          onClick={() => deleteField.mutate({ id: field.id })}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded-[var(--r-sm)] border border-border bg-muted/20 p-3">
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            {editingId ? <Trans>Edit field</Trans> : <Trans>Add a field</Trans>}
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className={labelClass}>
                <Trans>Field name</Trans>
              </label>
              <Input
                className={inputClass}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={_(msg`e.g. GL account`)}
              />
            </div>

            <div className="w-[130px]">
              <label className={labelClass}>
                <Trans>Type</Trans>
              </label>
              <select
                className="h-8 w-full rounded-md border border-border bg-card px-2 text-[13px]"
                value={type}
                // Frozen while editing: a TEXT value already saved is not a
                // number, and switching the type would make every existing
                // record invalid with no way to see which ones.
                disabled={Boolean(editingId)}
                onChange={(e) => setType(e.target.value as MetadataFieldType)}
              >
                {METADATA_FIELD_TYPES.map((fieldType) => (
                  <option key={fieldType} value={fieldType}>
                    {TYPE_LABELS[fieldType]}
                  </option>
                ))}
              </select>
            </div>

            {type === 'SELECT' && (
              <div className="min-w-[200px] flex-1">
                <label className={labelClass}>
                  <Trans>Options (comma-separated)</Trans>
                </label>
                <Input
                  className={inputClass}
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder={_(msg`e.g. Approved, Pending, Blocked`)}
                />
              </div>
            )}

            <div className="min-w-[180px] flex-1">
              <label className={labelClass}>
                <Trans>Hint (optional)</Trans>
              </label>
              <Input
                className={inputClass}
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder={_(msg`Shown under the field`)}
              />
            </div>

            <label className="flex h-8 items-center gap-1.5 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              <Trans>Required</Trans>
            </label>

            <Button
              size="sm"
              disabled={!canSave || upsertField.isPending}
              onClick={() =>
                upsertField.mutate({
                  id: editingId ?? undefined,
                  category: normalizedCategory,
                  label: label.trim(),
                  type,
                  options:
                    type === 'SELECT'
                      ? options
                          .split(',')
                          .map((option) => option.trim())
                          .filter(Boolean)
                      : undefined,
                  helpText: helpText.trim() || null,
                  required,
                  // Newest last, so the form's order matches the order they were
                  // added rather than shuffling on every save.
                  order: editingId
                    ? (forCategory.find((field) => field.id === editingId)?.order ?? 0)
                    : forCategory.length,
                })
              }
            >
              <PlusIcon className="mr-1 h-3.5 w-3.5" />
              {editingId ? <Trans>Update</Trans> : <Trans>Add</Trans>}
            </Button>

            {editingId && (
              <Button size="sm" variant="ghost" onClick={reset}>
                <XIcon className="mr-1 h-3.5 w-3.5" />
                <Trans>Cancel</Trans>
              </Button>
            )}
          </div>

          {reserved && (
            <p className="mt-2 text-[11px] text-destructive">
              <Trans>
                That name is already a built-in field on this record. Pick another one.
              </Trans>
            </p>
          )}
          {duplicate && (
            <p className="mt-2 text-[11px] text-destructive">
              <Trans>A field with that name already exists for {normalizedCategory}.</Trans>
            </p>
          )}
          {!reserved && !duplicate && derivedKey !== '' && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              <Trans>Workflows will read this as</Trans>{' '}
              <code className="rounded bg-muted px-1">{`{{vars.<step>.${derivedKey}}}`}</code>
              {editingId && (
                <>
                  {' · '}
                  <Trans>Renaming the field keeps this the same.</Trans>
                </>
              )}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
