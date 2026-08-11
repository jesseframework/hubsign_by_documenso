import { useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CheckIcon, PencilIcon, PlusIcon, ScanLineIcon, UserCogIcon, XIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * The extracted fields, with the ability to correct them.
 *
 * Until now `extractedData` had exactly one writer — the OCR job — so a misread
 * value could not be fixed by anyone, and a business rule reading that value
 * refused signing forever. The PO number is the case that surfaced it: in this
 * deployment every extracted `po_number` is noise, so the rule that requires
 * one can never be satisfied from OCR alone.
 *
 * A corrected value is marked as such and loses its confidence score. A figure
 * a person typed and a figure the extractor read are different kinds of
 * evidence, and showing "90%" beside something a human entered would be a
 * fabrication.
 */

export type FieldExtraction = {
  field_name: string;
  extracted_value: unknown;
  confidence_score: number;
  requires_review?: boolean;
  extraction_method?: string;
  ai_fallback_used?: boolean;
};

type FieldEdit = {
  field: string;
  newValue: string | null;
  editedAt: Date | string;
  /** 'HUMAN' when somebody typed it, 'ATTACHMENT_OCR' when read from a file. */
  source: string;
  sourceDetail: string | null;
  editedBy: { name: string | null; email: string } | null;
};

/** Offered in the "add a field" picker. The extractor's own common names. */
const COMMON_FIELDS = [
  'po_number',
  'invoice_number',
  'invoice_date',
  'due_date',
  'vendor_name',
  'vendor_email',
  'customer_name',
  'currency',
  'total_amount',
  'tax_amount',
  'subtotal',
];

const pct = (value: number) => Math.round(value * 100);

export function ExtractedFields({
  inboxItemId,
  fields,
  extractedData,
  fieldEdits,
  templateName,
  readOnly,
}: {
  inboxItemId: string;
  fields: FieldExtraction[];
  extractedData: Record<string, unknown>;
  fieldEdits: FieldEdit[];
  templateName?: string | null;
  readOnly: boolean;
}) {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');

  const update = trpc.inbox.updateExtractedField.useMutation({
    onSuccess: async () => {
      await utils.inbox.get.invalidate({ id: inboxItemId });
      await utils.inbox.timeline.invalidate({ inboxItemId });
      void utils.inbox.list.invalidate();
    },
    onError: (e) => toast({ title: _(msg`Could not save`), description: e.message, variant: 'destructive' }),
  });

  /** Most recent edit per field, for the "edited by" marker. */
  const editedBy = useMemo(() => {
    const map = new Map<string, FieldEdit>();
    for (const edit of fieldEdits) {
      if (!map.has(edit.field)) map.set(edit.field, edit);
    }
    return map;
  }, [fieldEdits]);

  /**
   * The rows to show: everything the extractor reported, plus any key that only
   * exists because someone added it. A field typed in by hand must appear even
   * though OCR never produced it — that is the entire point.
   */
  const rows = useMemo(() => {
    const seen = new Set(fields.map((f) => f.field_name));
    const extra = Object.keys(extractedData)
      .filter((key) => !seen.has(key))
      .sort()
      .map<FieldExtraction>((key) => ({
        field_name: key,
        extracted_value: extractedData[key],
        confidence_score: -1, // no OCR confidence — this value did not come from OCR
      }));

    return [...fields, ...extra];
  }, [fields, extractedData]);

  const save = async (field: string, value: string) => {
    setEditing(null);
    await update.mutateAsync({ id: inboxItemId, field, value });
  };

  const currentValue = (row: FieldExtraction) => {
    // `extractedData` is what rules read, so it is the truth on screen too.
    // The extractor's own reported value is only a fallback for a key that was
    // reported but never made it into the flat map.
    if (row.field_name in extractedData) {
      const value = extractedData[row.field_name];
      return value === null || value === undefined ? '' : String(value);
    }
    return row.extracted_value != null ? String(row.extracted_value) : '';
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">
          <Trans>Extracted fields</Trans>
        </span>
        {templateName && (
          <span className="text-[10px] text-muted-foreground">Template: {templateName}</span>
        )}
      </div>

      <div className="mt-1.5 space-y-1">
        {rows.map((row, i) => {
          const value = currentValue(row);
          const edit = editedBy.get(row.field_name);
          const wasEdited = Boolean(edit);
          const isLow = !wasEdited && row.confidence_score >= 0 && row.confidence_score < 0.5;
          const needsReview = !wasEdited && (row.requires_review || isLow || value === '');
          const isEditing = editing === row.field_name;

          return (
            <div
              key={`${row.field_name}-${i}`}
              className={`flex items-center gap-2 rounded border px-2.5 py-1.5 ${
                wasEdited
                  ? 'border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/30'
                  : needsReview
                    ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30'
                    : 'border-border bg-muted/20'
              }`}
            >
              {wasEdited ? (
                edit?.source === 'ATTACHMENT_OCR' ? (
                  <ScanLineIcon
                    className="h-3 w-3 flex-shrink-0 text-sky-600 dark:text-sky-400"
                    aria-label="Read from an attachment"
                  />
                ) : (
                  <UserCogIcon
                    className="h-3 w-3 flex-shrink-0 text-sky-600 dark:text-sky-400"
                    aria-label="Entered by a person"
                  />
                )
              ) : (
                <div
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    row.confidence_score < 0
                      ? 'bg-muted-foreground/40'
                      : row.confidence_score >= 0.7
                        ? 'bg-green-500'
                        : row.confidence_score >= 0.4
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                  }`}
                  title={row.confidence_score >= 0 ? `${pct(row.confidence_score)}% confidence` : undefined}
                />
              )}

              <span className="min-w-[100px] text-[11px] font-medium capitalize text-muted-foreground">
                {row.field_name.replace(/_/g, ' ')}
              </span>

              {isEditing ? (
                <>
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void save(row.field_name, draft);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="h-6 flex-1 text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => void save(row.field_name, draft)}
                    className="rounded p-0.5 text-emerald-600 hover:bg-muted"
                    aria-label="Save"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                    aria-label="Cancel"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[12px] font-medium">{value || '—'}</span>

                  {wasEdited ? (
                    edit?.source === 'ATTACHMENT_OCR' ? (
                      <span
                        className="text-[9px] text-sky-700 dark:text-sky-300"
                        title={`Read from the attached ${edit.sourceDetail ?? 'file'} on ${new Date(edit.editedAt).toLocaleString()}`}
                      >
                        <Trans>from attachment</Trans>
                      </span>
                    ) : (
                      <span
                        className="text-[9px] text-sky-700 dark:text-sky-300"
                        title={`Entered by ${edit?.editedBy?.name || edit?.editedBy?.email || 'a user'} on ${new Date(edit!.editedAt).toLocaleString()}`}
                      >
                        <Trans>entered</Trans>
                      </span>
                    )
                  ) : (
                    row.confidence_score >= 0 && (
                      <span className="text-[9px] text-muted-foreground">
                        {pct(row.confidence_score)}%
                        {row.extraction_method === 'ml+ai' || row.ai_fallback_used ? ' · AI' : ''}
                      </span>
                    )
                  )}

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(row.field_name);
                        setDraft(value);
                      }}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Correct ${row.field_name}`}
                    >
                      <PencilIcon className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="mt-2">
          {adding ? (
            <div className="flex items-center gap-1.5">
              <Input
                list="inbox-common-fields"
                autoFocus
                value={newField}
                onChange={(e) => setNewField(e.target.value)}
                placeholder={_(msg`Field name, e.g. po_number`)}
                className="h-7 flex-1 text-[12px]"
              />
              <datalist id="inbox-common-fields">
                {COMMON_FIELDS.filter((f) => !(f in extractedData)).map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newField.trim()) {
                    void save(newField.trim(), newValue).then(() => {
                      setAdding(false);
                      setNewField('');
                      setNewValue('');
                    });
                  }
                }}
                placeholder={_(msg`Value`)}
                className="h-7 flex-1 text-[12px]"
              />
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={!newField.trim() || update.isPending}
                onClick={() =>
                  void save(newField.trim(), newValue).then(() => {
                    setAdding(false);
                    setNewField('');
                    setNewValue('');
                  })
                }
              >
                <Trans>Add</Trans>
              </Button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Cancel"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <PlusIcon className="h-3 w-3" />
              <Trans>Correct or add a field</Trans>
            </button>
          )}
        </div>
      )}

      {readOnly && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          <Trans>
            This document is complete, so its extracted data can no longer be changed.
          </Trans>
        </p>
      )}
    </div>
  );
}
